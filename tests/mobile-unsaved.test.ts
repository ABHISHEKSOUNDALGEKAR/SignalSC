import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import express from 'express';
import { firefox, type Browser } from 'playwright-core';
import { createServer as createViteServer, type ViteDevServer } from 'vite';

const FIXTURE_EXTRACTION = {
  title: 'Mobile Warning Fixture',
  description: 'A deterministic event used only by the mobile browser regression suite.',
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
  evidence: [{ field: 'title', excerpt: 'Mobile Warning Fixture' }],
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

test('Firefox narrow viewport preserves unsaved announcement and review input', {
  skip: existsSync(firefox.executablePath()) ? false : 'Install Playwright Firefox to run the mobile-engine regression.',
}, async () => {
  process.env.NODE_ENV = 'development';
  process.env.ORGANIZER_ACCESS_CODES = 'Mobile Test Org=mobile-test-code';
  process.env.SESSION_SECRET = 'mobile-warning-test-session-secret';
  process.env.MODEL_API_KEY = 'mobile-warning-fixture-key';
  process.env.MODEL_BASE_URL = 'https://model.test/v1';
  process.env.MODEL_NAME = 'mobile-warning-fixture';
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

    browser = await firefox.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      hasTouch: true,
    });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto(`${webUrl}/#/organizer`);
    await page.getByRole('heading', { name: 'Organizer sign in' }).waitFor();
    await page.getByLabel('Organization access code').fill('mobile-test-code');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: /Good to see you, Mobile Test Org/ }).waitFor();

    const assertNoBrowserStorage = async () => {
      assert.deepEqual(
        await page.evaluate(() => [localStorage.length, sessionStorage.length]),
        [0, 0],
        'review text, flyer data, and organization access codes must not be stored in browser storage',
      );
    };

    await page.getByLabel('Or paste announcement text').fill('Mobile unsaved announcement marker.');
    await page.getByLabel('Source link (optional)').fill('https://example.test/mobile-flyer');
    await page.locator('#flyer-file').setInputFiles({
      name: 'mobile-unsaved-flyer.png',
      mimeType: 'image/png',
      buffer: Buffer.from('mobile flyer fixture bytes'),
    });
    await assertNoBrowserStorage();

    const announcementReload = page.reload({ timeout: 5000 }).catch(() => undefined);
    const announcementReloadDialog = await page.waitForEvent('dialog');
    assert.equal(announcementReloadDialog.type(), 'beforeunload');
    await announcementReloadDialog.dismiss();
    await announcementReload;
    assert.equal(await page.getByLabel('Or paste announcement text').inputValue(), 'Mobile unsaved announcement marker.');
    assert.equal(await page.getByLabel('Source link (optional)').inputValue(), 'https://example.test/mobile-flyer');
    await page.getByText('Selected: mobile-unsaved-flyer.png').waitFor();

    const announcementRouteDialog = page.waitForEvent('dialog');
    const announcementRouteClick = page.getByRole('link', { name: 'Saved', exact: true }).click();
    const routeWarning = await announcementRouteDialog;
    assert.equal(routeWarning.type(), 'confirm');
    assert.match(routeWarning.message(), /unsaved.*announcement/i);
    await routeWarning.dismiss();
    await announcementRouteClick;
    await page.getByRole('heading', { name: /Good to see you, Mobile Test Org/ }).waitFor();
    assert.equal(await page.getByLabel('Or paste announcement text').inputValue(), 'Mobile unsaved announcement marker.');
    await page.getByText('Selected: mobile-unsaved-flyer.png').waitFor();

    const announcementSignOutDialog = page.waitForEvent('dialog');
    const announcementSignOutClick = page.getByRole('button', { name: 'Sign out' }).click();
    const signOutWarning = await announcementSignOutDialog;
    assert.equal(signOutWarning.type(), 'confirm');
    assert.match(signOutWarning.message(), /unsaved.*announcement/i);
    await signOutWarning.dismiss();
    await announcementSignOutClick;
    assert.equal(await page.getByLabel('Or paste announcement text').inputValue(), 'Mobile unsaved announcement marker.');

    await page.getByLabel('Or paste announcement text').fill('Create the mobile review fixture.');
    await page.getByLabel('Source link (optional)').fill('');
    await page.locator('#flyer-file').setInputFiles([]);
    const createdResponse = page.waitForResponse(response =>
      response.url().endsWith('/api/organizer/drafts') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create review draft' }).click();
    assert.equal((await createdResponse).status(), 201);
    await page.getByRole('heading', { name: 'Check every detail.' }).waitFor();

    await page.getByLabel('Description').fill('Mobile unsaved review marker.');
    await assertNoBrowserStorage();
    const reviewReload = page.reload({ timeout: 5000 }).catch(() => undefined);
    const reviewReloadDialog = await page.waitForEvent('dialog');
    assert.equal(reviewReloadDialog.type(), 'beforeunload');
    await reviewReloadDialog.dismiss();
    await reviewReload;
    assert.equal(await page.getByLabel('Description').inputValue(), 'Mobile unsaved review marker.');

    const reviewRouteDialog = page.waitForEvent('dialog');
    const reviewRouteClick = page.getByRole('link', { name: 'Saved', exact: true }).click();
    const reviewRouteWarning = await reviewRouteDialog;
    assert.equal(reviewRouteWarning.type(), 'confirm');
    assert.match(reviewRouteWarning.message(), /unsaved.*review field changes/i);
    await reviewRouteWarning.dismiss();
    await reviewRouteClick;
    await page.getByRole('heading', { name: 'Check every detail.' }).waitFor();
    assert.equal(await page.getByLabel('Description').inputValue(), 'Mobile unsaved review marker.');

    const reviewSignOutDialog = page.waitForEvent('dialog');
    const reviewSignOutClick = page.getByRole('button', { name: 'Sign out' }).click();
    const reviewSignOutWarning = await reviewSignOutDialog;
    assert.equal(reviewSignOutWarning.type(), 'confirm');
    assert.match(reviewSignOutWarning.message(), /unsaved.*review field changes/i);
    await reviewSignOutWarning.dismiss();
    await reviewSignOutClick;
    assert.equal(await page.getByLabel('Description').inputValue(), 'Mobile unsaved review marker.');
    await assertNoBrowserStorage();
    assert.deepEqual(pageErrors, [], `Firefox browser errors: ${pageErrors.join('; ')}`);
    await context.close();
  } finally {
    await browser?.close();
    await vite?.close();
    globalThis.fetch = originalFetch;
    apiServer.closeAllConnections();
    await new Promise<void>(resolve => apiServer.close(() => resolve()));
  }
});
