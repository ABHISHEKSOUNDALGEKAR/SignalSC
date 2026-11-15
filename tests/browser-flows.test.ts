import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import express from 'express';
import { chromium, type Browser } from 'playwright-core';
import { createServer as createViteServer, type ViteDevServer } from 'vite';

const FIXTURE_EXTRACTION = {
  title: 'Browser Flow Fixture',
  description: 'A deterministic event used only by the browser regression suite.',
  date: '2035-01-15',
  yearStated: true,
  startTime: '18:00',
  endTime: '20:00',
  location: 'Tutor Campus Court',
  eligibility: null,
  isFree: true,
  costDollars: null,
  food: 'advertised',
  beginnerFriendly: true,
  registrationUrl: null,
  registrationDeadlineDate: null,
  registrationDeadlineTime: null,
  evidence: [{ field: 'title', excerpt: 'Browser Flow Fixture' }],
  uncertainties: [],
};

function listen(server: ReturnType<express.Express['listen']>) {
  return new Promise<AddressInfo>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Expected a TCP address.'));
      resolve(address);
    });
  });
}

test('organizer publishing and device-local saved-event flows work in a browser', async () => {
  process.env.NODE_ENV = 'development';
  process.env.ORGANIZER_ACCESS_CODES = 'Browser Test Org=browser-test-code';
  process.env.SESSION_SECRET = 'browser-flow-test-session-secret';
  process.env.MODEL_API_KEY = 'browser-flow-fixture-key';
  process.env.MODEL_BASE_URL = 'https://model.test/v1';
  process.env.MODEL_NAME = 'browser-flow-fixture';
  delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  delete process.env.DATABASE_URL;

  const { apiRouter } = await import('../server/routes');
  const { createStore } = await import('../server/store');
  const store = createStore();
  await store.init();

  const app = express();
  app.use(express.json({ limit: '8mb' }));
  app.use('/api', apiRouter(store));
  const apiServer = app.listen(0, '127.0.0.1');
  const apiAddress = await once(apiServer, 'listening').then(() => apiServer.address() as AddressInfo);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input) === 'https://model.test/v1/chat/completions') {
      return Response.json({ choices: [{ message: { content: JSON.stringify(FIXTURE_EXTRACTION) } }] });
    }
    return originalFetch(input, init);
  };

  let vite: ViteDevServer | undefined;
  let browser: Browser | undefined;
  try {
    vite = await createViteServer({
      configFile: 'vite.config.ts',
      server: {
        host: '127.0.0.1',
        port: 0,
        strictPort: false,
        proxy: { '/api': `http://127.0.0.1:${apiAddress.port}` },
      },
    });
    await vite.listen();
    const viteAddress = vite.httpServer?.address();
    assert.ok(viteAddress && typeof viteAddress !== 'string');
    const webUrl = `http://127.0.0.1:${viteAddress.port}`;

    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH ?? '/repl/tools/bin/chromium',
      args: ['--no-sandbox'],
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto(`${webUrl}/#/organizer`);
    await page.getByRole('heading', { name: 'Organizer sign in' }).waitFor();

    await page.getByLabel('Organization access code').fill('not-the-code');
    await page.getByRole('button', { name: 'Continue' }).click();
    const accessError = page.getByRole('alert');
    await accessError.waitFor();
    assert.match((await accessError.textContent()) ?? '', /access code was not recognized/i);

    await page.getByLabel('Organization access code').fill('browser-test-code');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: /Good to see you, Browser Test Org/ }).waitFor();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel('Or paste announcement text').fill('Unsaved announcement input.');
    await page.locator('#flyer-file').setInputFiles({
      name: 'unsaved-flyer.png',
      mimeType: 'image/png',
      buffer: Buffer.from('test flyer'),
    });
    const announcementReloadGuard = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    assert.equal(announcementReloadGuard, true, 'unsaved announcement input must request a reload warning');
    const reloadDialogPromise = page.waitForEvent('dialog');
    const reloadAttempt = page.reload({ timeout: 5000 }).catch(() => undefined);
    const reloadDialog = await reloadDialogPromise;
    assert.equal(reloadDialog.type(), 'beforeunload');
    await reloadDialog.dismiss();
    await reloadAttempt;
    assert.equal(await page.getByLabel('Or paste announcement text').inputValue(), 'Unsaved announcement input.');
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('link', { name: 'Saved', exact: true }).click();
    await page.getByRole('heading', { name: /Good to see you, Browser Test Org/ }).waitFor();
    assert.equal(await page.getByLabel('Or paste announcement text').inputValue(), 'Unsaved announcement input.');
    await page.getByText('Selected: unsaved-flyer.png').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    let acceptedAnnouncementWarning = '';
    page.once('dialog', async dialog => {
      acceptedAnnouncementWarning = dialog.message();
      await dialog.accept();
    });
    await page.getByRole('link', { name: 'Saved', exact: true }).click();
    await page.getByRole('heading', { name: /Keep the plans/ }).waitFor();
    assert.match(acceptedAnnouncementWarning, /unsaved.*announcement/i);
    await page.getByRole('link', { name: 'Organizers' }).click();
    await page.getByRole('heading', { name: /Good to see you, Browser Test Org/ }).waitFor();

    await page.locator('#flyer-file').setInputFiles([]);
    await page.getByLabel('Or paste announcement text').fill('Fixed test fixture announcement.');
    const createdResponse = page.waitForResponse(response =>
      response.url().endsWith('/api/organizer/drafts') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create review draft' }).click();
    const created = await createdResponse;
    assert.equal(created.status(), 201);
    const { draft } = await created.json() as { draft: { id: string } };
    const eventId = draft.id;
    await page.getByRole('heading', { name: 'Check every detail.' }).waitFor();
    assert.equal(await page.getByLabel('Event title *').inputValue(), FIXTURE_EXTRACTION.title);
    await page.getByLabel('Description').fill('Unsaved review field change.');
    await page.getByText('Unsaved field changes · the saved server draft remains unchanged.').waitFor();
    const hasReloadGuard = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    assert.equal(hasReloadGuard, true, 'unsaved review changes must request a reload warning');
    await page.getByRole('link', { name: 'Saved', exact: true }).focus();
    page.once('dialog', dialog => dialog.dismiss());
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Check every detail.' }).waitFor();
    assert.equal(await page.getByLabel('Description').inputValue(), 'Unsaved review field change.');
    const backWarning = page.waitForEvent('dialog');
    await page.evaluate(() => window.history.back());
    const backDialog = await backWarning;
    assert.match(backDialog.message(), /unsaved.*review field changes/i);
    await backDialog.dismiss();
    await page.getByRole('heading', { name: 'Check every detail.' }).waitFor();
    assert.equal(await page.getByLabel('Description').inputValue(), 'Unsaved review field change.');

    await page.getByLabel('Starts at *').fill('');
    await page.getByLabel('Location').fill('');
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: 'Back to workspace' }).click();
    await page.getByRole('heading', { name: 'Check every detail.' }).waitFor();
    assert.equal(await page.getByLabel('Location').inputValue(), '');
    const rejectedPublish = page.waitForResponse(response =>
      response.url().endsWith(`/api/organizer/drafts/${eventId}/publish`) && response.status() === 422);
    await page.getByRole('button', { name: 'Save & publish' }).click();
    assert.equal((await rejectedPublish).status(), 422);
    const validation = page.getByRole('status');
    await validation.waitFor();
    assert.match((await validation.textContent()) ?? '', /Add the missing details before publishing/);
    assert.match((await validation.textContent()) ?? '', /Starts At/);
    assert.match((await validation.textContent()) ?? '', /Location/);

    await page.getByLabel('Starts at *').fill('2035-01-15T18:00');
    await page.getByLabel('Location').fill('Updated Tutor Campus Court');
    await page.getByLabel('Description').fill('Organizer reviewed and saved this fixture.');
    await page.getByRole('button', { name: 'Save review' }).click();
    await page.getByRole('status').filter({ hasText: 'Review saved.' }).waitFor();

    const publishedResponse = page.waitForResponse(response =>
      response.url().endsWith(`/api/organizer/drafts/${eventId}/publish`) && response.status() === 200);
    await page.getByRole('button', { name: 'Save & publish' }).click();
    assert.equal((await publishedResponse).status(), 200);
    await page.getByRole('heading', { name: 'Your events' }).waitFor();
    await page.getByText('Browser Flow Fixture', { exact: true }).waitFor();

    await page.goto(`${webUrl}/#/event/${encodeURIComponent(eventId)}`);
    await page.getByRole('heading', { name: 'Browser Flow Fixture' }).waitFor();
    const saveButton = page.getByRole('button', { name: 'Save event' });
    await saveButton.click();
    assert.equal(await page.getByRole('button', { name: 'Saved' }).getAttribute('aria-pressed'), 'true');
    await page.reload();
    await page.getByRole('heading', { name: 'Browser Flow Fixture' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Saved' }).getAttribute('aria-pressed'), 'true');

    await page.getByRole('link', { name: 'Organizers' }).click();
    await page.getByRole('heading', { name: 'Your events' }).waitFor();
    const eventRow = page.locator('.draft-row').filter({ hasText: 'Browser Flow Fixture' });
    await eventRow.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('heading', { name: 'Edit event details.' }).waitFor();
    await page.getByLabel('Description').fill('Edited in the organizer workspace.');
    await page.getByRole('button', { name: 'Save review' }).click();
    await page.getByRole('status').filter({ hasText: 'Event details updated.' }).waitFor();
    await page.getByRole('button', { name: 'Back to workspace' }).click();
    await page.getByRole('heading', { name: 'Your events' }).waitFor();

    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.locator('.draft-row').filter({ hasText: 'Browser Flow Fixture' }).getByText('cancelled', { exact: true }).waitFor();

    await page.getByRole('link', { name: 'Saved', exact: true }).click();
    const savedEvent = page.getByRole('link', { name: /Browser Flow Fixture/ });
    await savedEvent.waitFor();
    await savedEvent.click();
    await page.getByRole('heading', { name: 'Browser Flow Fixture' }).waitFor();
    await page.getByText('This event has been cancelled.').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Saved' }).getAttribute('aria-pressed'), 'true');

    await page.getByRole('link', { name: 'Organizers' }).click();
    await eventRow.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Description').fill('Unsaved change before sign out.');
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('heading', { name: 'Edit event details.' }).waitFor();
    assert.equal(await page.getByLabel('Description').inputValue(), 'Unsaved change before sign out.');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('heading', { name: 'Organizer sign in' }).waitFor();
    assert.deepEqual(pageErrors, [], `Browser console errors: ${pageErrors.join('; ')}`);
    await context.close();
  } finally {
    await browser?.close();
    await vite?.close();
    globalThis.fetch = originalFetch;
    apiServer.closeAllConnections();
    await new Promise<void>(resolve => apiServer.close(() => resolve()));
  }
});
