import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, type Page } from 'playwright-core';
import { createServer } from 'vite';

test('registration return prompt follows the student across tabs and keeps a separate Registered list', { timeout: 120_000 }, async () => {
  const vite = await createServer({ configFile: 'vite.config.ts', server: { host: '127.0.0.1', port: 0, strictPort: false } });
  let browser;
  try {
    await vite.listen();
    const address = vite.httpServer?.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({
      headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/repl/tools/bin/chromium', args: ['--no-sandbox'],
    });
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const fixture = {
        id: 'registration-fixture', title: 'Campus Registration Night', description: 'An isolated browser fixture.',
        startsAt: '2035-11-20T18:00:00-08:00', endsAt: '2035-11-20T20:00:00-08:00',
        timezone: 'America/Los_Angeles', location: 'Campus Center', eligibility: null, costCents: null,
        food: 'unknown', beginnerFriendly: null, registrationUrl: 'https://engage.usc.edu/rsvp?id=1',
        registrationDeadline: null, sourceUrl: 'https://engage.usc.edu/rsvp?id=1', sourceKind: 'engagesc',
        evidence: [], uncertainties: [], status: 'published', organizationName: 'Campus Org',
        confirmation: 'source-imported', flyerUrl: null, publishedAt: '2026-11-15T12:00:00Z', updatedAt: '2026-11-15T12:00:00Z',
      };
      await context.route('https://engage.usc.edu/**', route => route.fulfill({ contentType: 'text/html', body: '<title>External event fixture</title><h1>Event registration</h1>' }));
      await context.route('**/api/**', route => {
        const path = new URL(route.request().url()).pathname;
        return route.fulfill({ json: path.includes('/feedback/') ? { count: 0 }
          : path === '/api/events/registration-fixture' ? { event: fixture }
          : path === '/api/events' ? { events: [fixture], mode: 'live' }
          : { status: 'ok', mode: 'live', modelConfigured: false } });
      });
      const source = await context.newPage();
      const errors: string[] = [];
      context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
      source.on('pageerror', error => errors.push(error.message));
      await source.goto(`${base}/#/event/${fixture.id}`);
      try { await source.getByRole('button', { name: 'Save event', exact: true }).click({ timeout: 10_000 }); }
      catch { throw new Error(`Registration fixture failed to render: ${errors.join('; ')} ${await source.locator('body').innerText()}`); }
      const leave = async (page: Page) => {
        await page.bringToFront();
        const popupPromise = context.waitForEvent('page');
        await page.getByRole('link', { name: 'View on EngageSC' }).click();
        const popup = await popupPromise;
        await popup.waitForLoadState();
        await popup.bringToFront();
        // Headless engines do not consistently deliver OS focus transitions.
        // The real popup is opened above; explicitly deliver the browser leave event too.
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
        return popup;
      };
      const popup = await leave(source);
      const home = await context.newPage();
      await home.goto(`${base}/#/ask`);
      await home.bringToFront();
      await home.evaluate(() => window.dispatchEvent(new Event('focus')));
      const dialog = home.getByRole('dialog', { name: 'Did you register for this event?' });
      await dialog.waitFor();
      await home.screenshot({ path: `/tmp/signalsc-registration-prompt-${width}.png`, fullPage: true });
      await home.getByRole('button', { name: 'Yes, I registered' }).click();
      await dialog.waitFor({ state: 'hidden' });
      await home.getByRole('link', { name: 'Saved', exact: true }).click();
      await home.getByRole('tab', { name: 'Registered (1)', exact: true }).click();
      await home.getByRole('link').filter({ hasText: fixture.title }).waitFor();
      await home.screenshot({ path: `/tmp/signalsc-registered-${width}.png`, fullPage: true });
      await home.reload();
      await home.getByRole('tab', { name: 'Registered (1)', exact: true }).click();
      await home.getByRole('link').filter({ hasText: fixture.title }).waitFor();
      await home.getByRole('tab', { name: 'Saved (0)', exact: true }).click();
      assert.equal(await home.getByRole('link').filter({ hasText: fixture.title }).count(), 0);
      await home.getByRole('tab', { name: 'Registered (1)', exact: true }).click();
      await home.getByRole('button', { name: `Move ${fixture.title} to Saved`, exact: true }).click();
      await home.getByRole('tab', { name: 'Saved (1)', exact: true }).click();
      await home.getByRole('link').filter({ hasText: fixture.title }).waitFor();
      await home.reload();
      await home.getByRole('link').filter({ hasText: fixture.title }).waitFor();
      await popup.close();

      // A declined answer leaves the item Saved and does not reappear on focus.
      const secondPopup = await leave(source);
      await source.bringToFront();
      await source.evaluate(() => window.dispatchEvent(new Event('focus')));
      await source.getByRole('dialog').waitFor();
      await source.getByRole('button', { name: 'Not yet', exact: true }).click();
      await source.evaluate(() => window.dispatchEvent(new Event('focus')));
      assert.equal(await source.getByRole('dialog').isVisible(), false);
      await secondPopup.close();

      // Deferral is also persistent and does not falsely register the student.
      const thirdPopup = await leave(source);
      await source.bringToFront();
      await source.evaluate(() => window.dispatchEvent(new Event('focus')));
      await source.getByRole('dialog').waitFor();
      await source.getByRole('button', { name: 'Not now', exact: true }).click();
      await source.evaluate(() => window.dispatchEvent(new Event('focus')));
      assert.equal(await source.getByRole('dialog').isVisible(), false);
      await thirdPopup.close();
      await source.getByRole('button', { name: 'Mark as registered', exact: true }).click();
      await source.getByRole('button', { name: 'Registered · Undo', exact: true }).click();
      assert.equal(await source.getByRole('button', { name: 'Saved', exact: true }).getAttribute('aria-pressed'), 'true');
      assert.equal(await source.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      assert.deepEqual(errors, []);
      await context.close();
    }
    const blocked = await browser.newContext();
    await blocked.addInitScript(() => Object.defineProperty(Storage.prototype, 'setItem', { value: () => { throw new Error('Storage blocked'); } }));
    await blocked.route('**/api/**', route => route.fulfill({ json: { status: 'ok', mode: 'live', modelConfigured: false } }));
    const page = await blocked.newPage();
    await page.goto(base);
    await page.getByRole('link', { name: 'Saved', exact: true }).click();
    // Blocked writes must not prevent browsing the list or navigating away.
    await page.getByRole('tab', { name: 'Registered (0)', exact: true }).click();
    await page.getByRole('heading', { name: 'No registered events yet' }).waitFor();
    await blocked.close();
  } finally {
    await browser?.close();
    await vite.close();
  }
});
