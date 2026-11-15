import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { apiRequest, ApiError, errorMessage, getEvents } from '../src/lib/api';
import { startResource, type ResourceState } from '../src/lib/resource';
import { eventHref, readRoute } from '../src/lib/navigation';
import { EmptyState, ErrorState, FieldDisplay, LoadingState } from '../src/components/States';

test('API preserves method, JSON body, headers, signal and same-origin credentials', async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (path: string, init: RequestInit) => {
    assert.equal(path, '/api/search');
    assert.equal(init.method, 'POST');
    assert.equal(init.body, JSON.stringify({ query: 'campus' }));
    assert.equal(init.credentials, 'same-origin');
    assert.equal(new Headers(init.headers).get('Content-Type'), 'application/json');
    assert.equal(new Headers(init.headers).get('Accept'), 'application/json');
    assert.equal(init.signal, controller.signal);
    return Response.json({ answer: 'response' });
  });
  assert.deepEqual(await apiRequest('/api/search', { method: 'POST', json: { query: 'campus' }, signal: controller.signal }), { answer: 'response' });
});

test('API GET sends no accidental body', async t => {
  t.mock.method(globalThis, 'fetch', async (_path: string, init: RequestInit) => {
    assert.equal(init.body, undefined);
    return Response.json({ events: [], mode: 'live' });
  });
  assert.deepEqual(await apiRequest('/api/events'), { events: [], mode: 'live' });
});

test('204 organizer sign-out is a successful empty response', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));
  assert.equal(await apiRequest<void>('/api/organizer/session', { method: 'DELETE' }), undefined);
});

test('invalid event response shapes fail gracefully before the view renders', async t => {
  for (const value of [null, {}, { events: null }, { events: 'invalid' }]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json(value));
    await assert.rejects(getEvents(new AbortController().signal), error => error instanceof ApiError && /event list/.test(error.message));
  }
});

for (const status of [401, 403, 404, 422, 503]) {
  test(`structured ${status} errors preserve status, message and missing fields`, async t => {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Review these fields', missing: ['location', 'startsAt', 7] }, { status }));
    await assert.rejects(apiRequest('/api/organizer/drafts/test/publish'), error => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, status);
      assert.equal(error.message, 'Review these fields');
      assert.deepEqual(error.missing, ['location', 'startsAt']);
      return true;
    });
  });
}

test('non-JSON and malformed error bodies preserve HTTP status with a useful fallback', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>proxy error</html>', { status: 503 }));
  await assert.rejects(apiRequest('/api/events'), error => error instanceof ApiError && error.status === 503 && /try again/i.test(error.message));
});

test('unreadable success is an error instead of a false success', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('broken JSON'));
  await assert.rejects(apiRequest('/api/events'), error => error instanceof ApiError && /unreadable/.test(error.message));
});

test('network and cancellation propagate; raw network details are not displayed', async t => {
  const networkError = new TypeError('internal transport detail');
  t.mock.method(globalThis, 'fetch', async () => { throw networkError; });
  await assert.rejects(apiRequest('/api/events'), error => error === networkError);
  assert.match(errorMessage(networkError), /Unable to connect/);
  const aborted = new DOMException('Aborted', 'AbortError');
  t.mock.method(globalThis, 'fetch', async () => { throw aborted; });
  await assert.rejects(apiRequest('/api/events'), error => error === aborted);
});

const settle = () => new Promise(resolve => setImmediate(resolve));

test('new resource wins even if an old transport ignores abort; cleanup stops post-unmount updates', async () => {
  const states: ResourceState<string>[] = [];
  let finishOld!: (value: string) => void;
  let oldSignal!: AbortSignal;
  const stopOld = startResource(signal => {
    oldSignal = signal;
    return new Promise<string>(resolve => { finishOld = resolve; });
  }, state => states.push(state));
  await settle();
  stopOld();
  assert.equal(oldSignal.aborted, true);
  const stopNew = startResource(async () => 'new', state => states.push(state));
  await settle();
  finishOld('old');
  await settle();
  assert.deepEqual(states, [{ status: 'loading' }, { status: 'loading' }, { status: 'success', data: 'new' }]);
  stopNew();
});

test('resource errors recover on retry and aborts do not show an error', async () => {
  const states: ResourceState<number>[] = [];
  let calls = 0;
  const loader = async () => { if (++calls === 1) throw new Error('offline'); return 4; };
  const update = (state: ResourceState<number>) => states.push(state);
  const stop = startResource(loader, update);
  await settle();
  assert.equal(states.at(-1)?.status, 'error');
  stop();
  const retryStop = startResource(loader, update);
  await settle();
  assert.equal(calls, 2);
  assert.deepEqual(states.at(-1), { status: 'success', data: 4 });
  retryStop();
  const cancelled: ResourceState<never>[] = [];
  const cancel = startResource(async () => { throw new DOMException('Aborted', 'AbortError'); }, state => cancelled.push(state));
  await settle();
  assert.deepEqual(cancelled, [{ status: 'loading' }]);
  cancel();
});

test('navigation handles direct detail URLs, encoded IDs, missing and malformed routes', () => {
  for (const page of ['discover', 'ask', 'saved', 'organizer']) assert.deepEqual(readRoute(`#${page}`), { page });
  assert.deepEqual(readRoute(eventHref('event/with spaces')), { page: 'event', id: 'event/with spaces' });
  assert.deepEqual(readRoute('#event'), { page: 'event' });
  assert.deepEqual(readRoute('#event/%ZZ'), { page: 'event' });
  assert.deepEqual(readRoute('#unknown'), { page: 'discover' });
});

test('shared states render accessible status/error messages, retry, missing fields and safe text', () => {
  assert.match(renderToStaticMarkup(<LoadingState />), /role="status"/);
  assert.match(renderToStaticMarkup(<EmptyState title="No events">Try later</EmptyState>), /No events/);
  const html = renderToStaticMarkup(<ErrorState error={new ApiError(422, '<script>bad()</script>', ['location'])} onRetry={() => {}} />);
  assert.match(html, /role="alert"/);
  assert.match(html, /<button[^>]*>Try again<\/button>/);
  assert.match(html, /<li>location<\/li>/);
  assert.ok(!html.includes('<script>'));
});

test('field display preserves zero and false rather than changing them to unknown', () => {
  assert.match(renderToStaticMarkup(<FieldDisplay label="Cost" value={0} />), /<dd>0<\/dd>/);
  assert.match(renderToStaticMarkup(<FieldDisplay label="Beginner" value={false} />), /<dd>No<\/dd>/);
  assert.match(renderToStaticMarkup(<FieldDisplay label="Location" value={null} />), /<dd>Unknown<\/dd>/);
});
