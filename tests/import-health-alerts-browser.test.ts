import '../server/tests/setup';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

test('organizers opt into safe alerts, deduplicate continuing failures, and receive a fresh alert after recovery', { timeout: 90_000 }, async () => {
  const { apiRouter } = await import('../server/routes');
  const { MemoryStore } = await import('../server/store');
  const { feedImportHealthRecorder } = await import('../server/import-health');
  const store = new MemoryStore();
  let at = Date.now();
  async function failure(category: 'request_failed' | 'invalid_feed' | 'event_save_failed') {
    const recorder = feedImportHealthRecorder(store, 'engagesc', new Date(at++));
    if (category === 'event_save_failed') { recorder.fetchSucceeded(); recorder.saveFailed(); }
    else recorder.fetchFailed(category);
    await recorder.save();
  }
  async function recovered() {
    const recorder = feedImportHealthRecorder(store, 'engagesc', new Date(at++));
    recorder.fetchSucceeded(); recorder.completed();
    await recorder.save();
  }
  await failure('request_failed');
  await failure('request_failed');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter(store));
  const api = app.listen(0, '127.0.0.1');
  await once(api, 'listening');
  const apiAddress = api.address();
  assert.ok(apiAddress && typeof apiAddress !== 'string');
  const vite = await createServer({
    configFile: 'vite.config.ts',
    server: { host: '127.0.0.1', port: 0, strictPort: false, proxy: { '/api': `http://127.0.0.1:${apiAddress.port}` } },
  });
  let browser;
  try {
    await vite.listen();
    const address = vite.httpServer?.address();
    assert.ok(address && typeof address !== 'string');
    browser = await chromium.launch({
      headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/repl/tools/bin/chromium', args: ['--no-sandbox'],
    });
    const context = await browser.newContext({ permissions: ['notifications'] });
    await context.addInitScript(() => {
      const notifications: { title: string; body: string; tag: string }[] = [];
      Object.defineProperty(window, '__feedNotifications', { value: notifications, configurable: true });
      class BrowserTestNotification {
        static permission = 'granted';
        static requestPermission = async () => 'granted';
        onclick: ((event: Event) => void) | null = null;
        constructor(public title: string, public options: NotificationOptions = {}) {
          notifications.push({ title, body: options.body ?? '', tag: options.tag ?? '' });
        }
        close() {}
      }
      Object.defineProperty(window, 'Notification', { value: BrowserTestNotification, configurable: true });
    });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/#/organizer`);
    await page.getByLabel('Organization access code').fill('code-a');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'Calendar import health' }).waitFor();
    await page.getByText('Consecutive failed imports: 2').waitFor();
    await page.getByRole('button', { name: 'Enable browser alerts' }).click();
    const count = () => page.evaluate(() => (window as unknown as { __feedNotifications: unknown[] }).__feedNotifications.length);
    try { await page.waitForFunction(() => (window as unknown as { __feedNotifications: unknown[] }).__feedNotifications.length === 1, { timeout: 5_000 }); }
    catch { throw new Error(`Notification was not created: ${await page.locator('body').innerText()} ${JSON.stringify(await page.evaluate(() => ({ permission: Notification.permission, alerts: (window as unknown as { __feedNotifications: unknown[] }).__feedNotifications, pref: localStorage.getItem('signalsc-feed-alerts:v1:test-org-a') })))}`); }
    let records = await page.evaluate(() => (window as unknown as { __feedNotifications: { title: string; body: string; tag: string }[] }).__feedNotifications);
    assert.deepEqual(records[0], {
      title: 'EngageSC calendar needs attention',
      body: 'Feed request failed',
      tag: 'signalsc-feed-alert:test-org-a:engagesc',
    });
    await page.getByRole('button', { name: 'Refresh status' }).click();
    await page.waitForTimeout(100);
    assert.equal(await count(), 1, 'a continuing failure must not alert twice');

    await failure('invalid_feed');
    await page.getByRole('button', { name: 'Refresh status' }).click();
    await page.getByText('Consecutive failed imports: 3').waitFor();
    assert.equal(await count(), 1, 'changing safe failure category within the outage must not alert again');

    await recovered();
    await page.getByRole('button', { name: 'Refresh status' }).click();
    await page.getByText('Consecutive failed imports: 0').waitFor();
    assert.equal(await count(), 1);

    await failure('event_save_failed');
    await failure('event_save_failed');
    await page.getByRole('button', { name: 'Refresh status' }).click();
    await page.getByText('Consecutive failed imports: 2').waitFor();
    await page.waitForFunction(() => (window as unknown as { __feedNotifications: unknown[] }).__feedNotifications.length === 2);
    records = await page.evaluate(() => (window as unknown as { __feedNotifications: { title: string; body: string; tag: string }[] }).__feedNotifications);
    assert.equal(records[1].body, 'Event records could not be saved');

    await page.getByRole('button', { name: 'Turn off alerts' }).click();
    await failure('request_failed');
    await failure('request_failed');
    await page.getByRole('button', { name: 'Refresh status' }).click();
    await page.waitForTimeout(100);
    assert.equal(await count(), 2, 'disabled notifications must remain quiet');
    await page.getByRole('button', { name: 'Sign out' }).click();
    assert.deepEqual(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await context.close();
  } finally {
    await browser?.close();
    await vite.close();
    api.closeAllConnections();
    await new Promise<void>(resolve => api.close(() => resolve()));
  }
});
