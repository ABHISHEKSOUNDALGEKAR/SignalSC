import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import type { SearchRequest } from '../shared/api';

process.env.MODEL_API_KEY = 'isolated-browser-refinement';
process.env.MODEL_BASE_URL = 'https://model.test/v1';
process.env.MODEL_NAME = 'refinement-fixture';
const { search } = await import('../server/search');
const { emptyDraft } = await import('../server/extract');

test('students refine, edit, recover and reset searches on desktop and phone without saved conversation', { timeout: 90_000 }, async () => {
  const now = new Date('2026-11-15T01:00:00-08:00');
  const event = {
    ...emptyDraft(null), id: 'refine-fixture', title: 'Robotics Dinner', description: 'Robotics and food.',
    startsAt: '2026-11-17T20:00:00-08:00', endsAt: null, status: 'published' as const,
    food: 'advertised' as const, costCents: 0, beginnerFriendly: true, organizationName: 'Fixture Org',
    flyerUrl: null, publishedAt: now.toISOString(), updatedAt: now.toISOString(),
  };
  const originalFetch = globalThis.fetch;
  let providerOutage = false;
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('https://model.test/')) return originalFetch(url, init);
    if (providerOutage) throw new Error('Simulated model outage');
    const body = JSON.parse(String(init?.body));
    const system = body.messages[0].content as string;
    let content: unknown = { answer: 'Explore these events.', reasons: [], rankedIds: [] };
    if (system.startsWith('Update a USC')) {
      const { request } = JSON.parse(body.messages[1].content);
      content = request.includes('week') ? { from: '2026-11-16T00:00:00-08:00', to: '2026-11-23T00:00:00-08:00' }
        : request.includes('food') ? { foodAdvertisedOnly: true } : { afterMinutes: 1140 };
    } else if (system.startsWith('Turn a USC')) content = { keywords: ['robotics'] };
    return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
  };
  const vite = await createServer({ configFile: 'vite.config.ts', server: { host: '127.0.0.1', port: 0, strictPort: false } });
  let browser;
  try {
    await vite.listen();
    const address = vite.httpServer?.address();
    assert.ok(address && typeof address !== 'string');
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/repl/tools/bin/chromium', args: ['--no-sandbox'] });
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      providerOutage = false;
      const page = await browser.newPage({ viewport });
      const errors: string[] = [];
      const bodies: SearchRequest[] = [];
      let httpFailure = false;
      let delay = false;
      let release: (() => void) | undefined;
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', async route => {
        if (new URL(route.request().url()).pathname !== '/api/search') {
          await route.fulfill({ json: { status: 'ok', mode: 'live', modelConfigured: true, events: [] } });
          return;
        }
        const body = route.request().postDataJSON() as SearchRequest;
        bodies.push(body);
        if (delay) await new Promise<void>(resolve => { release = resolve; });
        if (httpFailure) { await route.fulfill({ status: 503, json: { error: 'Simulated network failure' } }); return; }
        await route.fulfill({ json: await search(body.query, [event], now, body) });
      });
      const home = `http://127.0.0.1:${address.port}/#/ask`;
      await page.goto(home);
      const input = page.getByRole('textbox', { name: 'Ask about campus events' });
      await input.fill('robotics tonight after 5');
      await input.press('Enter');
      await page.getByRole('heading', { name: 'Related events to explore' }).waitFor();
      const follow = page.locator('#ask-follow-up');
      const submit = page.getByRole('button', { name: 'Refine search', exact: true });
      await follow.fill('next week instead');
      await submit.click();
      await page.getByRole('heading', { name: 'Worth a look' }).waitFor();
      assert.equal(await page.locator('#filter-from').inputValue(), '2026-11-16T00:00');
      assert.deepEqual(bodies.at(-1)?.context?.keywords, ['robotics']);
      await follow.fill('later in the evening');
      await follow.press('Enter');
      await page.waitForFunction(() => (document.querySelector('#filter-after') as HTMLInputElement)?.value === '19:00');
      await follow.fill('only the ones with food');
      await submit.click();
      await page.waitForFunction(() => (document.querySelector('.filter-toggle-list input:nth-child(1)') !== null)
        && (document.querySelectorAll('.filter-toggle-list input')[1] as HTMLInputElement).checked);
      assert.equal(await page.getByText('1 exact matches', { exact: true }).count(), 1);
      const beforeOutage = bodies.at(-1)!.context!;
      providerOutage = true;
      await follow.fill('next week instead');
      await submit.click();
      await page.getByText(/Your search filters are unchanged/).waitFor();
      assert.equal(await page.getByRole('checkbox', { name: 'Food advertised only' }).isChecked(), true);
      providerOutage = false;
      httpFailure = true;
      await submit.click();
      await page.getByText('Simulated network failure', { exact: true }).waitFor();
      httpFailure = false;
      await page.getByRole('button', { name: /Try again/ }).click();
      await page.waitForFunction(() => !(document.querySelector('.ask-box') as HTMLElement)?.getAttribute('aria-busy')?.includes('true'));
      assert.ok(bodies.at(-1)?.context);
      assert.equal(beforeOutage.foodAdvertisedOnly, false); // This was the context before food was added.
      // Remove filters and replace the date range directly; no model needed.
      providerOutage = true;
      await page.getByRole('checkbox', { name: 'Food advertised only' }).uncheck();
      await page.locator('#filter-after').fill('');
      await page.locator('#filter-keywords').fill('');
      await page.locator('#filter-from').fill('2026-11-17T00:00');
      await page.locator('#filter-to').fill('2026-11-18T00:00');
      await page.getByRole('button', { name: 'Apply filters' }).click();
      await page.waitForFunction(() => !(document.querySelector('.ask-box') as HTMLElement)?.getAttribute('aria-busy')?.includes('true'));
      assert.equal(bodies.at(-1)?.query, '');
      assert.equal(bodies.at(-1)?.constraints?.afterMinutes, null);
      assert.equal(bodies.at(-1)?.constraints?.foodAdvertisedOnly, false);
      assert.deepEqual(bodies.at(-1)?.constraints?.keywords, []);
      await page.locator('#filter-to').fill('2026-11-16T00:00');
      await page.getByRole('button', { name: 'Apply filters' }).click();
      await page.getByRole('alert').filter({ hasText: 'Choose an end after the start' }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
      assert.doesNotMatch(storage, /robotics|later in the evening|next week instead|foodAdvertisedOnly/);
      // Reset while a request is pending: its eventual response must not restore the old session.
      providerOutage = false;
      delay = true;
      await follow.fill('only the ones with food');
      await submit.click();
      await page.waitForTimeout(100);
      assert.ok(release);
      await page.getByRole('button', { name: 'Start new search' }).click();
      release();
      delay = false;
      await page.waitForTimeout(150);
      assert.equal(await follow.count(), 0);
      assert.equal(await input.inputValue(), '');
      await input.fill('robotics');
      await page.getByRole('button', { name: 'Find events' }).click();
      await follow.waitFor();
      assert.equal(bodies.at(-1)?.context, undefined);
      await page.reload();
      assert.equal(await follow.count(), 0);
      await input.fill('robotics');
      await page.getByRole('button', { name: 'Find events' }).click();
      await follow.waitFor();
      await page.getByRole('link', { name: 'Discover', exact: true }).first().click();
      await page.getByRole('link', { name: 'Ask', exact: true }).first().click();
      assert.equal(await follow.count(), 0);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    globalThis.fetch = originalFetch;
    await browser?.close();
    await vite.close();
  }
});
