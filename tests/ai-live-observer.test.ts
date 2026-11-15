import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  createLiveFetchObserver,
  runObservedLiveCheck,
  type LiveObservationStats,
} from '../scripts/live-ai-observer';

const endpoint = 'https://provider.example/v1/chat/completions';
const privateMarkers = [
  'PRIVATE_PROVIDER_BODY_91',
  'PRIVATE_MODEL_REASONING_82',
  'PRIVATE_CREDENTIAL_73',
  'PRIVATE_FLYER_SOURCE_64',
];

function response(content = '{"ok":true}') {
  return Response.json({
    choices: [{ finish_reason: 'stop', message: { content } }],
  });
}

function errorMessage(run: () => Promise<unknown>) {
  return run().then(
    () => { throw new Error('Expected the operation to fail.'); },
    error => error instanceof Error ? error.message : String(error),
  );
}

test('live observer retries timeouts and transport errors, counting every attempt', async () => {
  const logs: string[] = [];
  let calls = 0;
  let retryAdmissions = 0;
  let liveSignal: AbortSignal | null | undefined;
  const originalSignal = new AbortController().signal;
  const observer = createLiveFetchObserver({
    fetcher: async (_input, init) => {
      calls++;
      liveSignal = init?.signal;
      if (calls === 1) throw new DOMException(`timeout ${privateMarkers[1]}`, 'TimeoutError');
      if (calls === 2) throw new Error(`network ${privateMarkers[2]}`);
      return response(JSON.stringify({ result: privateMarkers[0], source: privateMarkers[3] }));
    },
    maxNetworkAttempts: 3,
    admitRetry: () => { retryAdmissions++; },
    timeoutMs: 180_000,
    logger: line => logs.push(line),
    sleep: async () => {},
  });

  await observer.fetch(endpoint, { signal: originalSignal });
  assert.equal(calls, 3);
  assert.equal(observer.stats.attempts, 3);
  assert.equal(retryAdmissions, 2);
  assert.equal(observer.stats.completions, 1);
  assert.notEqual(liveSignal, originalSignal);
  assert.equal(typeof liveSignal?.aborted, 'boolean');
  assert.equal(logs.length, 2);
  assert.match(logs.join('\n'), /RETRY live provider transport failure/);
  assert.doesNotMatch(logs.join('\n'), new RegExp(privateMarkers.join('|')));
});

test('rate-limit responses retry after a bounded delay and count both attempts', async () => {
  const logs: string[] = [];
  const delays: number[] = [];
  let calls = 0;
  let retryAdmissions = 0;
  const observer = createLiveFetchObserver({
    fetcher: async () => {
      calls++;
      if (calls === 1) return new Response(privateMarkers.join(' '), {
        status: 429,
        headers: { 'retry-after': '1' },
      });
      return response();
    },
    maxNetworkAttempts: 3,
    admitRetry: () => { retryAdmissions++; },
    logger: line => logs.push(line),
    sleep: async milliseconds => { delays.push(milliseconds); },
  });

  await observer.fetch(endpoint);
  assert.equal(calls, 2);
  assert.equal(observer.stats.attempts, 2);
  assert.equal(retryAdmissions, 1);
  assert.equal(observer.stats.completions, 1);
  assert.deepEqual(delays, [65_000]);
  assert.match(logs.join('\n'), /waiting 65 seconds/);
  assert.doesNotMatch(logs.join('\n'), new RegExp(privateMarkers.join('|')));
});

test('exhausted timeout retries are reported with failed attempt counts only', async () => {
  const logs: string[] = [];
  const failedChecks: string[] = [];
  const observer = createLiveFetchObserver({
    fetcher: async () => { throw new DOMException(`private ${privateMarkers.join(' ')}`, 'TimeoutError'); },
    maxNetworkAttempts: 3,
    logger: line => logs.push(line),
    sleep: async () => {},
  });

  await runObservedLiveCheck(
    'baseline extraction',
    async () => { await observer.fetch(endpoint); },
    observer.stats,
    failedChecks,
    line => logs.push(line),
  );

  assert.deepEqual(failedChecks, ['baseline extraction']);
  assert.equal(observer.stats.attempts, 3);
  assert.equal(observer.stats.completions, 0);
  assert.match(logs.at(-1) ?? '', /0 JSON completions observed, 3 outbound attempts/);
  assert.doesNotMatch(logs.join('\n'), new RegExp(privateMarkers.join('|')));
});

test('a rejected retry admission prevents another provider request', async () => {
  const logs: string[] = [];
  const failedChecks: string[] = [];
  let calls = 0;
  const observer = createLiveFetchObserver({
    fetcher: async () => {
      calls++;
      throw new Error(`network ${privateMarkers.join(' ')}`);
    },
    admitRetry: () => { throw new Error('model request budget is exhausted'); },
    maxNetworkAttempts: 3,
    logger: line => logs.push(line),
    sleep: async () => {},
  });

  await runObservedLiveCheck(
    'budget-limited retry',
    async () => { await observer.fetch(endpoint); },
    observer.stats,
    failedChecks,
    line => logs.push(line),
  );

  assert.equal(calls, 1);
  assert.equal(observer.stats.attempts, 1);
  assert.equal(observer.stats.completions, 0);
  assert.deepEqual(failedChecks, ['budget-limited retry']);
  assert.match(logs.at(-1) ?? '', /1 outbound attempts/);
  assert.doesNotMatch(logs.join('\n'), new RegExp(privateMarkers.join('|')));
});

test('non-200 provider responses fail without logging response bodies', async () => {
  const logs: string[] = [];
  const observer = createLiveFetchObserver({
    fetcher: async () => new Response(privateMarkers.join(' '), { status: 503 }),
    logger: line => logs.push(line),
  });

  assert.equal(await errorMessage(() => observer.fetch(endpoint)), 'Live provider returned HTTP 503.');
  assert.equal(observer.stats.attempts, 1);
  assert.equal(observer.stats.completions, 0);
  assert.match(logs.join('\n'), /HTTP 503/);
  assert.doesNotMatch(logs.join('\n'), new RegExp(privateMarkers.join('|')));
});

test('authorization failures block later live checks without another provider request', async () => {
  const logs: string[] = [];
  const failedChecks: string[] = [];
  let calls = 0;
  const observer = createLiveFetchObserver({
    fetcher: async () => {
      calls++;
      return new Response(privateMarkers.join(' '), { status: 401 });
    },
    logger: line => logs.push(line),
  });

  await runObservedLiveCheck(
    'authentication case',
    async () => { await observer.fetch(endpoint); },
    observer.stats,
    failedChecks,
    line => logs.push(line),
  );
  await runObservedLiveCheck(
    'later case',
    async () => { await observer.fetch(endpoint); },
    observer.stats,
    failedChecks,
    line => logs.push(line),
  );

  assert.equal(observer.stats.accessDenied, true);
  assert.equal(calls, 1);
  assert.deepEqual(failedChecks, ['authentication case', 'later case']);
  assert.match(logs.at(-1) ?? '', /BLOCKED live later case/);
  assert.doesNotMatch(logs.join('\n'), new RegExp(privateMarkers.join('|')));
});

test('truncated provider JSON is rejected without exposing the response', async () => {
  const logs: string[] = [];
  const observer = createLiveFetchObserver({
    fetcher: async () => new Response(`{"choices":[${privateMarkers.join(' ')}`, { status: 200 }),
    logger: line => logs.push(line),
  });

  assert.equal(await errorMessage(() => observer.fetch(endpoint)), 'Live provider returned malformed JSON.');
  assert.equal(observer.stats.attempts, 1);
  assert.equal(observer.stats.completions, 0);
  assert.doesNotMatch(logs.join('\n'), new RegExp(privateMarkers.join('|')));
});

test('malformed model JSON is rejected without exposing its content', async () => {
  const logs: string[] = [];
  const observer = createLiveFetchObserver({
    fetcher: async () => response(`${privateMarkers.join(' ')} {not json`),
    logger: line => logs.push(line),
  });

  assert.equal(await errorMessage(() => observer.fetch(endpoint)), 'Live provider completion was not valid JSON.');
  assert.equal(observer.stats.attempts, 1);
  assert.equal(observer.stats.completions, 0);
  assert.doesNotMatch(logs.join('\n'), new RegExp(privateMarkers.join('|')));
});

test('truncated model completions fail without logging reasoning or response data', async () => {
  const logs: string[] = [];
  const observer = createLiveFetchObserver({
    fetcher: async () => Response.json({
      choices: [{ finish_reason: 'length', message: { content: privateMarkers.join(' ') } }],
    }),
    logger: line => logs.push(line),
  });

  assert.equal(await errorMessage(() => observer.fetch(endpoint)), 'Live provider completion was incomplete.');
  assert.equal(observer.stats.attempts, 1);
  assert.equal(observer.stats.completions, 0);
  assert.doesNotMatch(logs.join('\n'), new RegExp(privateMarkers.join('|')));
});

test('assertion failures report only the controlled case and aggregate counts', async () => {
  const logs: string[] = [];
  const failedChecks: string[] = [];
  const stats: LiveObservationStats = { attempts: 4, completions: 2, accessDenied: false };
  await runObservedLiveCheck(
    'synthetic assertion',
    async () => assert.equal(privateMarkers[1], privateMarkers[0]),
    stats,
    failedChecks,
    line => logs.push(line),
  );

  assert.deepEqual(failedChecks, ['synthetic assertion']);
  assert.match(logs.join('\n'), /2 JSON completions observed, 4 outbound attempts/);
  assert.doesNotMatch(logs.join('\n'), new RegExp(privateMarkers.join('|')));
});

test('live timeout stays separate from app timeout, budget admission, and automatic validation', async () => {
  const model = await readFile(new URL('../server/model.ts', import.meta.url), 'utf8');
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const postMerge = await readFile(new URL('../scripts/post-merge.sh', import.meta.url), 'utf8');
  const replit = await readFile(new URL('../.replit', import.meta.url), 'utf8');

  assert.match(model, /const TIMEOUT_MS = 45_000/);
  assert.ok(model.indexOf('budget.acquire()') < model.indexOf('await fetch('));
  const liveScript = await readFile(new URL('../scripts/verify-ai-live.ts', import.meta.url), 'utf8');
  assert.match(liveScript, /timeoutMs: 180_000/);
  assert.match(liveScript, /admitRetry: reserveModelRetryAttempt/);
  assert.match(model, /budget\.recordAttempt\(\)/);
  assert.match(packageJson.scripts['test:ai'], /tests\/ai-\*\.test\.ts/);
  assert.doesNotMatch(packageJson.scripts['test:ai'], /verify-ai-live|test:ai:live/);
  assert.doesNotMatch(postMerge, /test:ai:live|verify-ai-live/);
  assert.doesNotMatch(replit, /test:ai:live|verify-ai-live/);
});
