import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

test('home search renders food matches and honest related suggestions on desktop and phone', { timeout: 90_000 }, async () => {
  delete process.env.MODEL_API_KEY;
  delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const { search } = await import('../server/search');
  const { emptyDraft } = await import('../server/extract');
  const now = new Date('2026-11-15T01:00:00-08:00');
  const event = {
    ...emptyDraft(null), id: 'search-browser-fixture', title: 'Campus Community Dinner',
    description: 'Food advertised by the organization. Check the source for details.',
    startsAt: '2026-11-17T18:00:00-08:00', endsAt: '2026-11-17T20:00:00-08:00',
    status: 'published' as const, food: 'advertised' as const, costCents: null, beginnerFriendly: null,
    organizationName: 'Community Org', flyerUrl: null, publishedAt: now.toISOString(), updatedAt: now.toISOString(),
  };
  const vite = await createServer({
    configFile: 'vite.config.ts', server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  let browser;
  try {
    await vite.listen();
    const address = vite.httpServer?.address();
    assert.ok(address && typeof address !== 'string');
    browser = await chromium.launch({
      headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/repl/tools/bin/chromium', args: ['--no-sandbox'],
    });
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/api/search') {
          const body = route.request().postDataJSON();
          await route.fulfill({ json: await search(body.query, [event], now) });
        } else await route.fulfill({ json: { status: 'ok', mode: 'live', modelConfigured: false } });
      });
      await page.goto(`http://127.0.0.1:${address.port}/`);
      const input = page.getByRole('textbox', { name: 'Ask about campus events' });
      await input.fill('free food next week');
      await page.getByRole('button', { name: 'Find events' }).click();
      await page.getByRole('heading', { name: 'Worth a look' }).waitFor();
      assert.equal(await page.getByRole('link').filter({ hasText: 'Campus Community Dinner' }).count(), 1);
      assert.equal(await page.getByText('free only', { exact: true }).count(), 0);
      await input.fill('Beginner-friendly events');
      await page.getByRole('button', { name: 'Find events' }).click();
      await page.getByRole('heading', { name: 'Related events to explore' }).waitFor();
      await page.getByText('Beginner suitability not listed', { exact: true }).waitFor();
      assert.equal(await page.getByRole('link').filter({ hasText: 'Campus Community Dinner' }).count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `/tmp/signalsc-search-${viewport.width}.png`, fullPage: true });
      await page.close();
    }
  } finally {
    await browser?.close();
    await vite.close();
  }
});
