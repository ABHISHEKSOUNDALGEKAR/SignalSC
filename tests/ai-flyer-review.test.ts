import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';

// Isolated test-process fixtures; never used for a real provider request.
process.env.MODEL_API_KEY = 'test-only-not-a-credential';
process.env.MODEL_BASE_URL = 'https://model.test/v1';
process.env.MODEL_NAME = 'gpt-4o-mini';
process.env.NODE_ENV = 'development';
delete process.env.DATABASE_URL;
delete process.env.REPLIT_DEPLOYMENT;
const { extractDraft, plainNote } = await import('../server/extract');

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const now = new Date('2026-11-14T18:00:00Z');
const reply = (data: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(data) } }] });

// First call extracts, second call reviews.
function provider(extraction: unknown, review: unknown) {
  const calls: string[] = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const system = String(body.messages[0].content);
    calls.push(system.startsWith('You check a draft') ? 'review' : 'extract');
    return reply(calls.at(-1) === 'review' ? review : extraction);
  };
  return calls;
}

const mixer = {
  title: 'USC Black Alumni Networking Mixer', description: 'A networking mixer.',
  date: '2026-12-04', yearStated: true, startTime: '17:00', endTime: '19:30',
  location: "Dulan's On Crenshaw Soul Food Restaurant", eligibility: 'All Trojan Black alumni',
  isFree: true, costDollars: null, food: 'advertised', beginnerFriendly: null,
  registrationUrl: 'https://tinyurl.com/USCBAADECADES', registrationDeadlineDate: null, registrationDeadlineTime: null,
  evidence: [
    { field: 'title', excerpt: 'USC Black Alumni NETWORKING MIXER' },
    { field: 'isFree', excerpt: 'NO HOST BEER & WINE' },
    { field: 'eligibility', excerpt: 'ALL TROJAN BLACK ALUMNI INVITED!' },
    { field: 'food', excerpt: 'INCLUDES LIGHT FOOD SAMPLES!' },
  ],
  uncertainties: ['The registration deadline date and time are not stated on the flyer, so they are null.'],
};

test('a no-host bar is not treated as free admission, even if the review is unavailable', async () => {
  provider(mixer, { not: 'a review' });
  const { draft, suggestions } = await extractDraft({ imageBase64: 'aW1hZ2U=', mimeType: 'image/png' }, now);
  assert.equal(draft.costCents, null);
  assert.ok(!draft.evidence.some(e => /no host/i.test(e.excerpt)));
  assert.ok(draft.uncertainties.some(n => /no-host bar/.test(n)));
  assert.deepEqual(suggestions, []);
  // Falling back to first-pass notes still removes internal wording.
  assert.ok(draft.uncertainties.every(n => !/\bnull\b/i.test(n)), draft.uncertainties.join(' | '));
});

test('the review pass clears unsupported values, rewrites the description and adds suggestions', async () => {
  const calls = provider({ ...mixer, isFree: null, evidence: mixer.evidence.filter(e => e.field !== 'isFree') }, {
    fieldChecks: [
      { field: 'title', supported: true, note: null },
      { field: 'location', supported: false, note: 'Only the restaurant name is legible; the address is cut off.' },
      { field: 'food', supported: true, note: null },
      { field: 'eligibility', supported: true, note: null },
    ],
    description: 'The USC Black Alumni Association hosts a networking mixer on Friday, December 4, 2026, from 5:00 to 7:30 PM. Light food samples are included.',
    itemsToConfirm: ['Confirm the admission cost', 'Add a registration deadline if spots are limited'],
    suggestions: ['Say whether admission is free', 'Add the full street address'],
  });
  const { draft, suggestions } = await extractDraft({ imageBase64: 'aW1hZ2U=', mimeType: 'image/png' }, now);
  assert.deepEqual(calls, ['extract', 'review']);
  assert.equal(draft.location, null);
  assert.ok(!draft.evidence.some(e => e.field === 'location'));
  assert.equal(draft.title, 'USC Black Alumni Networking Mixer');
  assert.equal(draft.food, 'advertised');
  assert.match(draft.description, /Light food samples are included/);
  assert.ok(draft.uncertainties.includes('Confirm the admission cost'));
  assert.ok(draft.uncertainties.some(n => /location was left blank/i.test(n)));
  assert.deepEqual(suggestions, ['Say whether admission is free', 'Add the full street address']);
});

test('the review can flag but never clear the title, date or start time', async () => {
  provider({ ...mixer, isFree: null, evidence: [] }, {
    fieldChecks: [{ field: 'date', supported: false, note: 'The day of week does not match.' }],
    description: null, itemsToConfirm: [], suggestions: [],
  });
  const { draft } = await extractDraft({ imageBase64: 'aW1hZ2U=', mimeType: 'image/png' }, now);
  assert.equal(draft.startsAt, '2026-12-04T17:00:00-08:00');
  assert.ok(draft.uncertainties.some(n => /Double-check the date/.test(n)));
});

test('organizer notes never show internal field names or null', () => {
  assert.equal(plainNote('The registration deadline date and time are not stated on the flyer, so they are null.'),
    'The registration deadline date and time are not stated on the flyer.');
  assert.equal(plainNote('endTime is null'), 'end time not stated');
  assert.equal(plainNote('isFree was set per instructions'), 'admission cost was set');
});

test('review notes skip blank fields, accept 12-hour times, and stay short and non-repeating', async () => {
  const sparse = {
    ...mixer, endTime: null, eligibility: null, isFree: null, food: 'unknown', location: 'Downtown Los Angeles',
    startTime: '18:30', registrationUrl: 'https://example.com/mixer',
    evidence: [{ field: 'startTime', excerpt: '6:30 PM' }, { field: 'location', excerpt: 'Downtown Los Angeles' }],
    uncertainties: [],
  };
  provider(sparse, {
    fieldChecks: [
      { field: 'startTime', supported: false, note: 'Source states 6:30 PM, not 18:30' },
      { field: 'endTime', supported: false, note: 'Source does not state an end time' },
      { field: 'eligibility', supported: false, note: 'Source does not state who can attend' },
      { field: 'location', supported: true, note: null },
    ],
    description: 'An alumni mixer in Downtown Los Angeles. No host beer and wine will be provided.',
    itemsToConfirm: ['Confirm the end time', 'Confirm the exact location details', 'Confirm if there is a cost to attend',
      'Confirm if food will be provided', 'Confirm who is eligible to attend', 'Confirm the registration deadline'],
    suggestions: [],
  });
  const { draft } = await extractDraft({ imageBase64: 'aW1n', mimeType: 'image/png' }, now);
  assert.equal(draft.startsAt, '2026-12-04T18:30:00-08:00');
  assert.ok(!draft.uncertainties.some(n => /start time/i.test(n)), 'a matching 12-hour time is not flagged');
  assert.ok(!draft.uncertainties.some(n => /left blank/i.test(n)), 'fields that were never filled are not reported as cleared');
  assert.ok(draft.uncertainties.length <= 5);
  assert.equal(draft.uncertainties.filter(n => /end time/i.test(n)).length, 1);
  assert.match(draft.description, /There is a no-host bar, so guests buy their own drinks\./);
  assert.doesNotMatch(draft.description, /will be provided/);
});

test('a complete flyer keeps quoted values and gets no notes when the review quibbles over formats', async () => {
  const complete = {
    title: 'Intro to Climate Tech Night', description: 'A beginner-friendly panel.', date: '2026-11-19', yearStated: true,
    startTime: '18:00', endTime: '19:30', location: 'Ginsburg Hall, Room 101', eligibility: 'Open to all USC students',
    isFree: true, costDollars: null, food: 'advertised', beginnerFriendly: true,
    registrationUrl: 'https://example.com/rsvp', registrationDeadlineDate: '2026-11-18', registrationDeadlineTime: null,
    evidence: [
      { field: 'endTime', excerpt: '6:00 PM – 7:30 PM' }, { field: 'food', excerpt: 'Dinner provided' },
      { field: 'isFree', excerpt: 'Free' }, { field: 'eligibility', excerpt: 'Open to all USC students' },
      { field: 'registrationDeadline', excerpt: 'RSVP by Wednesday, November 18' },
    ],
    uncertainties: [],
  };
  provider(complete, {
    fieldChecks: [
      { field: 'endTime', supported: false, note: 'Source states 7:30 PM, draft says 19:30' },
      { field: 'food', supported: false, note: "Source says 'Dinner provided' but does not state it is advertised" },
      { field: 'registrationDeadline', supported: false, note: 'Does not specify time' },
    ],
    description: null,
    itemsToConfirm: ['Verify the location is Ginsburg Hall, Room 101', 'Confirm dinner is provided'],
    suggestions: ['Add the specific room number if not already clear', 'Include the exact time zone for the event'],
  });
  const { draft, suggestions } = await extractDraft({ imageBase64: 'aW1n', mimeType: 'image/png' }, now);
  assert.equal(draft.endsAt, '2026-11-19T19:30:00-08:00');
  assert.equal(draft.food, 'advertised');
  assert.equal(draft.registrationDeadline, '2026-11-18T23:59:00-08:00');
  assert.deepEqual(draft.uncertainties, []);
  assert.deepEqual(suggestions, []);
});
