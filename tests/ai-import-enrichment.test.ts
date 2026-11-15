import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

// Synthetic credentials and provider only. Never load environment files or use
// the running application's database in these tests.
process.env.MODEL_API_KEY = 'synthetic-import-test';
process.env.MODEL_BASE_URL = 'https://model.test/v1';
process.env.MODEL_REQUEST_BUDGET = '3';
process.env.MODEL_BUDGET_WINDOW_MS = '1000';
process.env.MODEL_MAX_CONCURRENT = '1';
delete process.env.DATABASE_URL;
let clock = 10_000;
const realNow = Date.now;
Date.now = () => clock;
const { completeJson } = await import('../server/model');
Date.now = realNow;
const { groundImportedDetails, enrichImportedEvents, IMPORT_BATCH_SIZE } = await import('../server/import-enrichment');
const { importFeed, mapFeedEvent } = await import('../server/importer');
const { MemoryStore, PostgresStore } = await import('../server/store');
const { emptyDraft } = await import('../server/extract');
const { parseIcs } = await import('../server/ics');
const { campusTimeToDate } = await import('../server/time');
const originalFetch = globalThis.fetch;
const now = new Date('2035-01-01T00:00:00Z');
const feedUrl = 'https://feed.test/public.ics';
const source = 'Explore robotics. Complimentary ice cream is provided. No prior experience required. Admission: $12.50 USD. USC students only. RSVP https://events.test/join';
const empty = () => ({
  food: 'unknown', beginnerFriendly: null, topics: [], costCents: null,
  eligibility: null, registrationUrl: null, evidence: [], conflicts: [],
});
const recovered = () => ({
  food: 'advertised', beginnerFriendly: true, topics: ['robotics'], costCents: 1250,
  eligibility: 'USC students only', registrationUrl: 'https://events.test/join',
  evidence: [
    { field: 'food', excerpt: 'Complimentary ice cream is provided.' },
    { field: 'beginnerFriendly', excerpt: 'No prior experience required.' },
    { field: 'topics', excerpt: 'Explore robotics.' },
    { field: 'costCents', excerpt: 'Admission: $12.50 USD.' },
    { field: 'eligibility', excerpt: 'USC students only.' },
    { field: 'registrationUrl', excerpt: 'RSVP https://events.test/join' },
  ], conflicts: [],
});
function feed(descriptions: string[]) {
  return ['BEGIN:VCALENDAR', ...descriptions.flatMap((description, i) => [
    'BEGIN:VEVENT', `UID:synthetic-${i}`, `SUMMARY:Synthetic event ${i}`,
    'DTSTART:20350102T180000Z', 'DTEND:20350102T190000Z',
    'LOCATION:Sign in to download the location',
    `URL:https://engage.usc.edu/private/${i}`,
    `DESCRIPTION:${description.replace(/\n/g, '\\n')}`, 'END:VEVENT',
  ]), 'END:VCALENDAR'].join('\r\n');
}
const reply = (value: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] });
beforeEach(() => {
  clock += 1000;
  globalThis.fetch = async () => { throw new Error('Unexpected network request'); };
});
afterEach(() => { globalThis.fetch = originalFetch; });

test('batch imports enrich all requested details and preserve provenance without fetching private pages', async () => {
  let text = feed(Array.from({ length: IMPORT_BATCH_SIZE + 2 }, (_, i) => `${source} Session ${i}.`));
  const batches: number[] = [];
  globalThis.fetch = async (url, init) => {
    if (url === feedUrl) return new Response(text);
    assert.equal(url, 'https://model.test/v1/chat/completions');
    const request = JSON.parse(String(init?.body));
    const entries = JSON.parse(request.messages[1].content) as { id: number; source: string }[];
    assert.ok(entries.every(e => e.source.includes(source)));
    batches.push(entries.length);
    return reply({ events: entries.map(e => ({ id: e.id, ...recovered() })) });
  };
  const store = new MemoryStore();
  assert.equal((await importFeed(store, feedUrl, now)).inserted, 10);
  assert.deepEqual(batches, [8, 2]);
  const [record] = await store.list({ statuses: ['published'] });
  assert.equal(record.extractedBy, 'import');
  assert.equal(record.confirmation, 'source-imported');
  assert.equal(record.organizationId, null);
  assert.equal(record.data.sourceKind, 'engagesc');
  assert.equal(record.data.sourceUrl, 'https://engage.usc.edu/private/0');
  assert.equal(record.data.location, null);
  assert.match(record.data.uncertainties.join(' '), /sign-in/);
  assert.equal(record.data.food, 'advertised');
  assert.equal(record.data.costCents, 1250);
  assert.equal(record.data.beginnerFriendly, true);
  assert.deepEqual(record.data.topics, ['robotics']);
  assert.equal(record.data.eligibility, 'USC students only');
  assert.equal(record.data.registrationUrl, 'https://events.test/join');
  assert.ok(record.data.evidence.every(e => source.includes(e.excerpt)));
  // A new importer/store facade has no in-process queue/cache state.
  assert.equal((await importFeed(Object.create(store), feedUrl, now)).unchanged, 10);
  assert.deepEqual(batches, [8, 2]);
  text = text.replace('Session 0.', 'Session zero updated.');
  assert.equal((await importFeed(store, feedUrl, now)).updated, 1);
  assert.deepEqual(batches, [8, 2, 1]);
  const refreshed = await store.get(record.id);
  assert.equal(refreshed?.createdAt, record.createdAt);
  assert.equal(refreshed?.publishedAt, record.publishedAt);
});

test('only exact quotes and literal topics survive; missing evidence or malformed responses remain unknown', () => {
  assert.deepEqual(groundImportedDetails(recovered(), source), recovered());
  const invented = recovered();
  invented.evidence = invented.evidence.map(e => ({ ...e, excerpt: e.excerpt.toUpperCase() }));
  const result = groundImportedDetails(invented, source);
  assert.equal(result.food, 'unknown');
  assert.equal(result.costCents, null);
  assert.equal(result.beginnerFriendly, null);
  assert.deepEqual(result.topics, []);
  assert.equal(result.eligibility, null);
  assert.equal(result.registrationUrl, null);
  assert.deepEqual(result.evidence, []);
  assert.deepEqual(groundImportedDetails({ food: 'advertised' }, source), empty());
  assert.deepEqual(groundImportedDetails(null, source), empty());
  assert.deepEqual(groundImportedDetails({ ...recovered(), topics: ['computer science'] }, source).topics, []);
});

test('food is not free admission, absence is unknown, and negated offers are not advertised', () => {
  const food = 'Free food. Admission is not listed.';
  const result = groundImportedDetails({
    ...empty(), food: 'advertised', costCents: 0, evidence: [
      { field: 'food', excerpt: 'Free food.' }, { field: 'costCents', excerpt: 'Free food.' },
    ],
  }, food);
  assert.equal(result.food, 'advertised');
  assert.equal(result.costCents, null);
  assert.equal(groundImportedDetails({ ...empty(), food: 'not-advertised' }, 'A lecture.').food, 'unknown');
  const negative = { ...empty(), food: 'advertised', evidence: [{ field: 'food', excerpt: 'No food will be provided.' }] };
  assert.equal(groundImportedDetails(negative, 'No food will be provided.').food, 'unknown');
  assert.equal(groundImportedDetails({ ...negative, food: 'not-advertised' }, 'No food will be provided.').food, 'not-advertised');
});

test('conflicting and conditional claims remain unknown even with an exact supporting excerpt', () => {
  const result = groundImportedDetails({ ...recovered(), conflicts: ['food', 'beginnerFriendly', 'topics', 'eligibility', 'registrationUrl', 'costCents'] }, source);
  assert.deepEqual(result.evidence, []);
  assert.equal(result.costCents, null);
  assert.equal(result.food, 'unknown');
  const conflicting = 'Free admission. Tickets $10. Food is provided. No food will be provided.';
  const local = groundImportedDetails({
    ...empty(), costCents: 0, food: 'advertised', evidence: [
      { field: 'costCents', excerpt: 'Free admission.' },
      { field: 'food', excerpt: 'Food is provided.' },
    ],
  }, conflicting);
  assert.equal(local.costCents, null);
  assert.equal(local.food, 'unknown');
  assert.ok(local.conflicts.includes('costCents'));
  for (const excerpt of ['Admission: $15 CAD', 'Free registration', 'Tickets $10 or $20', 'Tickets $10-20', 'Admission $10 for members', 'Meal tickets $10']) {
    assert.equal(groundImportedDetails({
      ...empty(), costCents: excerpt === 'Free registration' ? 0 : 1000,
      evidence: [{ field: 'costCents', excerpt }],
    }, excerpt).costCents, null);
  }
});

test('successful unknown results and duplicate source content are cached, including overlapping refreshes', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return reply({ events: [{ id: 0, ...empty() }] });
  };
  const store = new MemoryStore();
  const input = () => ({ draft: { ...emptyDraft(null), title: 'Synthetic event', description: 'A gathering.' } });
  const first = [input(), input()];
  await Promise.all([enrichImportedEvents(store, first, now), enrichImportedEvents(store, [input()], now)]);
  assert.equal(calls, 1);
  await enrichImportedEvents(Object.create(store), [input()], now);
  assert.equal(calls, 1);
});

test('bad ids, duplicate ids, and invented quotes cannot cross-contaminate events', async () => {
  const store = new MemoryStore();
  const inputs = Array.from({ length: 3 }, (_, i) => ({ draft: {
    ...emptyDraft(null), title: `Synthetic ${i}`, description: i === 0 ? source : 'A different gathering.',
  } }));
  globalThis.fetch = async () => reply({ events: [
    { id: 0, ...recovered() }, { id: 0, ...recovered() },
    { id: 1, ...recovered() }, { id: 99, ...recovered() },
  ] });
  await enrichImportedEvents(store, inputs, now);
  for (const { draft } of inputs) {
    assert.equal(draft.costCents, null);
    assert.equal(draft.beginnerFriendly, null);
    assert.deepEqual(draft.topics, []);
  }
});

test('provider errors and invalid JSON spend attempts but use a persistent retry cooldown', async t => {
  const logs: string[] = [];
  t.mock.method(console, 'warn', (...args: unknown[]) => { logs.push(args.join(' ')); });
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('private-provider-body', { status: 503 });
  };
  const store = new MemoryStore();
  const input = () => ({ draft: { ...emptyDraft(null), title: 'private-source', description: source } });
  await enrichImportedEvents(store, [input()], now);
  await enrichImportedEvents(Object.create(store), [input()], new Date(now.getTime() + 3_600_000));
  assert.equal(calls, 1);
  await enrichImportedEvents(store, [input()], new Date(now.getTime() + 86_400_000));
  assert.equal(calls, 2);
  assert.doesNotMatch(logs.join(' '), /private-provider-body|private-source|synthetic-import-test/);
  globalThis.fetch = async () => { calls++; return reply({ unexpected: 'shape' }); };
  const invalid = new MemoryStore();
  await enrichImportedEvents(invalid, [input()], now);
  await enrichImportedEvents(Object.create(invalid), [input()], now);
  assert.equal(calls, 3);
  await assert.rejects(completeJson([]), /budget/);
});

test('shared budget exhaustion never prevents source records importing and retries without paying after reset', async () => {
  let calls = 0;
  globalThis.fetch = async url => {
    if (url === feedUrl) return new Response(feed(['No details stated.']));
    calls++;
    return reply({ events: [{ id: 0, ...empty() }] });
  };
  await completeJson([]); await completeJson([]); await completeJson([]);
  const store = new MemoryStore();
  assert.equal((await importFeed(store, feedUrl, now)).inserted, 1);
  assert.equal(calls, 3);
  clock += 1000;
  await importFeed(store, feedUrl, now);
  assert.equal(calls, 4);
});

test('oversized source is never partially extracted and past/cancelled events never consume calls', async () => {
  const store = new MemoryStore();
  const input = { draft: { ...emptyDraft(null), title: 'Synthetic', description: 'Free admission.' },
    sourceText: `Free admission.${'x'.repeat(12_000)} Tickets $10.` };
  await enrichImportedEvents(store, [input], now);
  assert.equal(input.draft.costCents, null);
  assert.match(input.draft.uncertainties.join(' '), /too long/);
  globalThis.fetch = async url => {
    assert.equal(url, feedUrl);
    return new Response(feed(['A gathering.']).replace('END:VEVENT', 'STATUS:CANCELLED\r\nEND:VEVENT'));
  };
  assert.equal((await importFeed(store, feedUrl, now)).skipped, 1);
});

test('full untruncated source and exact multiline evidence are available for grounding', async () => {
  const description = `${'Background. '.repeat(450)}\nNo prior experience required.\nAdmission: $12.50 USD.`;
  const [parsed] = parseIcs(feed([description]), campusTimeToDate);
  const mapped = mapFeedEvent(parsed, 'engagesc', now)!;
  assert.ok(mapped.draft.description.length <= 5000);
  assert.ok(mapped.sourceText.length > 5000);
  globalThis.fetch = async (_url, init) => {
    assert.match(String(init?.body), /No prior experience required/);
    return reply({ events: [{ id: 0, ...empty(), beginnerFriendly: true,
      evidence: [{ field: 'beginnerFriendly', excerpt: 'No prior experience required.\nAdmission: $12.50 USD.' }] }] });
  };
  await enrichImportedEvents(new MemoryStore(), [mapped], now);
  assert.equal(mapped.draft.beginnerFriendly, true);
  assert.ok(mapped.sourceText.includes(mapped.draft.evidence[0].excerpt));
});

test('persistent enrichment cache uses existing PostgreSQL metadata operations', async () => {
  const values = new Map<string, string>();
  const store = () => new PostgresStore({ async query(sql, params = []) {
    if (sql.startsWith('SELECT (SELECT value')) return { rows: [{ value: values.get(String(params[0])) ?? null, now: now.getTime() }] };
    if (sql.startsWith('INSERT INTO ts_meta')) {
      const key = String(params[0]);
      if (values.has(key)) return { rows: [] };
      values.set(key, String(params[1]));
      return { rows: [{ key }] };
    }
    if (sql.startsWith('UPDATE ts_meta')) {
      const key = String(params[0]);
      if (values.get(key) !== params[1]) return { rows: [] };
      values.set(key, String(params[2]));
      return { rows: [{ key }] };
    }
    if (sql.startsWith('SELECT value')) return { rows: values.has(String(params[0])) ? [{ value: values.get(String(params[0])) }] : [] };
    return { rows: [] };
  } });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return reply({ events: [{ id: 0, ...recovered() }] }); };
  const input = () => ({ draft: { ...emptyDraft(null), title: 'Synthetic', description: source } });
  await enrichImportedEvents(store(), [input()], now);
  const second = input();
  await enrichImportedEvents(store(), [second], now);
  assert.equal(calls, 1);
  assert.equal(second.draft.costCents, 1250);
});

test('AI enrichment coexists with the archive and cached public food details', async () => {
  const ics = feed([source, 'Historic gathering.'])
    .replace('https://engage.usc.edu/private/0', 'https://engage.usc.edu/rsvp?id=100')
    .replace('https://engage.usc.edu/private/1', 'https://engage.usc.edu/rsvp?id=101')
    .replace(/(UID:synthetic-1[\s\S]*?)20350102T180000Z/, '$120340102T180000Z')
    .replace(/(UID:synthetic-1[\s\S]*?)20350102T190000Z/, '$120340102T190000Z');
  let modelCalls = 0;
  let publicCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (url === feedUrl) return new Response(ics);
    if (url === 'https://model.test/v1/chat/completions') {
      modelCalls++;
      const entries = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
      assert.equal(entries.length, 1);
      assert.ok(entries[0].source.includes(source));
      return reply({ events: [{ id: 0, ...recovered() }] });
    }
    assert.equal(url, 'https://engage.usc.edu/api/v2/graphql');
    publicCalls++;
    const query = JSON.parse(String(init?.body)).query;
    assert.ok(query.includes(Buffer.from('usc:Event:100').toString('base64')));
    assert.ok(!query.includes(Buffer.from('usc:Event:101').toString('base64')));
    return Response.json({ data: { e0: {
      id: Buffer.from('usc:Event:100').toString('base64'), name: 'Synthetic event 0',
      isFoodIncluded: true, foodDetails: 'Ice cream',
    } } });
  };
  const store = new MemoryStore();
  assert.equal((await importFeed(store, feedUrl, now)).inserted, 2);
  const records = await store.list({ statuses: ['published'] });
  const upcoming = records.find(r => r.externalId === 'engagesc:synthetic-0')!;
  const past = records.find(r => r.externalId === 'engagesc:synthetic-1')!;
  assert.equal(upcoming.data.costCents, 1250);
  assert.equal(upcoming.data.beginnerFriendly, true);
  assert.deepEqual(upcoming.data.topics, ['robotics']);
  assert.equal(upcoming.data.food, 'advertised');
  assert.match(upcoming.data.evidence.find(e => e.field === 'food')!.excerpt, /Food Provided/);
  assert.equal(past.data.food, 'unknown');
  assert.equal((await importFeed(store, feedUrl, now)).unchanged, 2);
  assert.equal(modelCalls, 1);
  assert.equal(publicCalls, 1);
});
