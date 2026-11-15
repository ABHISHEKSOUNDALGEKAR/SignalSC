import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderWithSaves as renderToStaticMarkup } from './render-with-saves';
import type { SearchResponse } from '../../shared/api';
import { createSearchController, queryInput, searchEvents, starterPrompts, type SearchState } from '../src/lib/search';
import { ApiError } from '../src/lib/api';
import { Ask, SearchResults } from '../src/screens/Ask';
import { eventFixture } from './event-fixtures';

function response(overrides: Partial<SearchResponse> = {}): SearchResponse {
  return { answer: 'One synthetic event matches.', constraints: { keywords: [], from: '2026-11-14T12:00:00-08:00', to: '2026-11-21T12:00:00-08:00', afterMinutes: null, freeOnly: false, foodAdvertisedOnly: false, beginnerOnly: false },
    constraintSummary: ['This week', 'free only'], results: [{ event: eventFixture(), reason: 'Synthetic source advertises free admission.' }],
    excluded: [{ reason: 'cost is not stated', count: 2 }], noMatch: false, interpretedBy: 'rules', ...overrides };
}
const empty = () => response({ answer: 'No published event matches this question.', results: [], noMatch: true });
const settle = () => new Promise(resolve => setImmediate(resolve));

test('query validation trims input, accepts the 500-character boundary and rejects blank/over-limit', () => {
  assert.deepEqual(queryInput('  free events  '), { query: 'free events' });
  assert.equal(queryInput('x'.repeat(500)).query.length, 500);
  for (const query of ['', '  \n ', 'x'.repeat(501)]) assert.throws(() => queryInput(query), /1–500/);
  for (const prompt of starterPrompts) assert.equal(queryInput(prompt).query, prompt);
});

test('typed/starter queries POST only the intended query with same-origin credentials', async t => {
  const queries = ['  typed question  ', ...starterPrompts];
  let index = 0;
  t.mock.method(globalThis, 'fetch', async (path: string, init: RequestInit) => {
    assert.equal(path, '/api/search'); assert.equal(init.method, 'POST'); assert.equal(init.credentials, 'same-origin');
    assert.deepEqual(JSON.parse(String(init.body)), { query: queries[index++].trim() });
    return Response.json(response());
  });
  for (const query of queries) assert.deepEqual(await searchEvents(query, new AbortController().signal), response());
});

test('invalid input never reaches the network', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(response()));
  await assert.rejects(searchEvents(' ', new AbortController().signal));
  assert.equal(fetch.mock.callCount(), 0);
});

test('malformed, inconsistent or unpublished search responses fail without silently changing membership', async t => {
  for (const body of [null, {}, response({ results: [] }), response({ noMatch: true }), response({ results: [{ event: eventFixture({ status: 'cancelled' }), reason: 'wrong status' }] }), response({ excluded: [{ reason: 'bad count', count: -1 }] })]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json(body));
    await assert.rejects(searchEvents('events', new AbortController().signal), error => error instanceof ApiError && /could not be read/.test(error.message));
  }
});

test('success → no-match → error → exact-query retry clears earlier answers at every submission', async () => {
  const states: SearchState[] = []; const calls: string[] = [];
  const failure = new ApiError(503, 'Temporarily unavailable');
  const controller = createSearchController(async query => {
    calls.push(query);
    if (calls.length === 1) return response();
    if (calls.length === 2) return empty();
    if (calls.length === 3) throw failure;
    return response();
  }, state => states.push(state));
  controller.submit('match'); assert.deepEqual(states.at(-1), { status: 'loading', query: 'match' });
  await settle(); assert.equal(states.at(-1)?.status, 'success');
  controller.submit('strict query'); assert.deepEqual(states.at(-1), { status: 'loading', query: 'strict query' });
  await settle(); assert.deepEqual(states.at(-1), { status: 'success', query: 'strict query', response: empty() });
  controller.submit('retry this'); await settle();
  assert.deepEqual(states.at(-1), { status: 'error', query: 'retry this', error: failure });
  controller.submit('retry this'); await settle(); assert.equal(states.at(-1)?.status, 'success');
  assert.deepEqual(calls, ['match', 'strict query', 'retry this', 'retry this']); controller.cancel();
});

test('out-of-order search success cannot replace a newer no-match, even if transport ignores abort', async () => {
  const states: SearchState[] = []; const signals: AbortSignal[] = [];
  let finishOld!: (data: SearchResponse) => void;
  const controller = createSearchController(async (query, signal) => {
    signals.push(signal);
    return query === 'old' ? new Promise<SearchResponse>(resolve => { finishOld = resolve; }) : empty();
  }, state => states.push(state));
  controller.submit('old'); await settle(); controller.submit('new'); await settle();
  assert.equal(signals[0].aborted, true);
  finishOld(response()); await settle();
  assert.deepEqual(states.at(-1), { status: 'success', query: 'new', response: empty() }); controller.cancel();
});

test('late errors after cancel/reset cannot overwrite state; invalid submissions cancel pending work', async () => {
  const states: SearchState[] = []; let reject!: (error: Error) => void;
  const controller = createSearchController(() => new Promise<SearchResponse>((_resolve, fail) => { reject = fail; }), state => states.push(state));
  controller.submit('old'); await settle();
  assert.equal(controller.submit('  '), false);
  assert.equal(states.at(-1)?.status, 'invalid'); reject(new Error('Late network failure')); await settle();
  assert.equal(states.at(-1)?.status, 'invalid');
  controller.submit('again'); await settle(); controller.reset(); reject(new Error('Stale response after event edit')); await settle();
  assert.deepEqual(states.at(-1), { status: 'idle' }); controller.cancel();
});

test('result rendering preserves answer, chips, reasons, excluded counts and returned event IDs', () => {
  const data = response(); const html = renderToStaticMarkup(<SearchResults response={data} query="free events" />);
  for (const text of [data.answer, 'This week', 'free only', data.results[0].reason, 'cost is not stated', '<strong>2</strong>', 'Results for', '#event/synthetic-free']) assert.ok(html.includes(text), text);
  assert.ok(!html.includes('made-up-event'));
});

test('no-match shows the supplied answer plainly and never presents cards as matches', () => {
  const html = renderToStaticMarkup(<SearchResults response={empty()} query="strict question" />);
  assert.ok(html.includes('No matching events')); assert.ok(html.includes(empty().answer));
  assert.ok(!html.includes('href="#event/')); assert.ok(!html.includes('Matching events</h3>'));
  // Defensive rendering also avoids cards if a caller bypasses API validation.
  assert.ok(!renderToStaticMarkup(<SearchResults response={response({ noMatch: true })} query="strict" />).includes('href="#event/'));
});

test('answer, question, chips, reasons and exclusion notes render as safe text', () => {
  const unsafe = '<script>alert("synthetic")</script>';
  const data = response({ answer: unsafe, constraintSummary: [unsafe], excluded: [{ reason: unsafe, count: 1 }], results: [{ event: eventFixture({ title: unsafe }), reason: unsafe }] });
  const html = renderToStaticMarkup(<SearchResults response={data} query={unsafe} />);
  assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;script&gt;'));
});

test('Ask presents a labeled large input, query limit, starter prompts and no invented initial results', () => {
  const html = renderToStaticMarkup(<Ask />);
  assert.ok(html.includes('for="event-question"')); assert.ok(html.includes('maxLength="500"'));
  assert.ok(html.includes('Los Angeles time')); assert.ok(html.includes('Find events'));
  for (const prompt of starterPrompts) assert.ok(html.includes(prompt.replaceAll("'", '&#x27;')), prompt);
  assert.ok(!html.includes('href="#event/'));
});
