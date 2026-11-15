import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

test('Discover searches past titles, clears back to upcoming events, and submits feedback', { timeout: 90_000 }, async () => {
  process.env.NODE_ENV = 'development';
  delete process.env.REPLIT_DEPLOYMENT;
  delete process.env.DATABASE_URL;
  delete process.env.MODEL_API_KEY;
  delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const { MemoryStore } = await import('../server/store');
  const { emptyDraft } = await import('../server/extract');
  const { apiRouter } = await import('../server/routes');
  const store = new MemoryStore();
  const now = Date.now();
  for (const [id, title, days] of [
    ['upcoming', 'Upcoming Campus Meetup', 2],
    ['past', 'Historic BSA Feedback Session', -2],
  ] as const) {
    await store.insert({
      id, status: 'published', organizationId: null, organizationName: 'Campus Org',
      data: {
        ...emptyDraft(null), title,
        startsAt: new Date(now + days * 86_400_000).toISOString(),
        endsAt: new Date(now + days * 86_400_000 + 3_600_000).toISOString(),
      },
      flyerId: null, extractedBy: 'manual', confirmation: 'source-imported', externalId: null,
      createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), publishedAt: new Date(now).toISOString(),
    });
  }
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter(store));
  const api = app.listen(0, '127.0.0.1');
  await once(api, 'listening');
  const address = api.address();
  assert.ok(address && typeof address !== 'string');
  const vite = await createServer({
    configFile: 'vite.config.ts',
    server: { host: '127.0.0.1', port: 0, strictPort: false, proxy: { '/api': `http://127.0.0.1:${address.port}` } },
  });
  let browser;
  try {
    await vite.listen();
    const web = vite.httpServer?.address();
    assert.ok(web && typeof web !== 'string');
    browser = await chromium.launch({
      headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/repl/tools/bin/chromium', args: ['--no-sandbox'],
    });
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${web.port}/#/discover`);
      await page.getByRole('link').filter({ hasText: 'Upcoming Campus Meetup' }).waitFor();
      assert.equal(await page.getByRole('link').filter({ hasText: 'Historic BSA Feedback Session' }).count(), 0);
      const title = page.getByRole('searchbox', { name: 'Find an event by title' });
      await title.fill('BSA Historic');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await page.getByRole('heading', { name: 'Past events · Leave feedback' }).waitFor();
      assert.equal(await page.getByRole('link').filter({ hasText: 'Upcoming Campus Meetup' }).count(), 0);
      await page.getByRole('button', { name: 'Clear search' }).click();
      await page.getByRole('link').filter({ hasText: 'Upcoming Campus Meetup' }).waitFor();
      assert.equal(await page.getByRole('link').filter({ hasText: 'Historic BSA Feedback Session' }).count(), 0);
      await title.fill('Historic Feedback');
      await title.press('Enter');
      await page.getByRole('link').filter({ hasText: 'Historic BSA Feedback Session' }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.screenshot({ path: `/tmp/signalsc-archive-${viewport.width}.png`, fullPage: true });
      await page.getByRole('link').filter({ hasText: 'Historic BSA Feedback Session' }).click();
      await page.getByRole('heading', { name: 'Historic BSA Feedback Session' }).waitFor();
      await page.getByRole('button', { name: '5 out of 5' }).click();
      await page.getByLabel('Comment (optional)').fill('Enjoyed the discussion.');
      await page.getByRole('button', { name: 'Send feedback' }).click();
      await page.getByText('Thanks, your feedback was sent to the organizer.', { exact: true }).waitFor();
      assert.deepEqual(errors, []);
      await page.close();
    }
    assert.equal((await store.listFeedback('past')).length, 2);
  } finally {
    await browser?.close();
    await vite.close();
    api.closeAllConnections();
    await new Promise<void>(resolve => api.close(() => resolve()));
  }
});
