/** Explicit disposable fixture server. Never imported into the app or production. */
import express from 'express';
import { fileURLToPath } from 'node:url';
import { apiRouter } from '../../server/routes';
import { createStore, type StoredEvent } from '../../server/store';
import { campusDayStart } from '../src/lib/events';
import { eventFixture } from './event-fixtures';

if (process.env.DATABASE_URL || process.env.NODE_ENV === 'production') throw new Error('Fixture server requires local memory mode without DATABASE_URL.');
const store = createStore();
await store.init();
const now = new Date();
const today = new Date(+now + 60_000).toISOString();
const laterToday = new Date(+now + 120_000).toISOString();
const tomorrow = new Date(+campusDayStart(now, 1) + 12 * 3600000).toISOString();
const fixtures = [
  eventFixture({ startsAt: today, endsAt: new Date(+now + 3600000).toISOString(), flyerUrl: '/api/flyers/synthetic-image' }),
  eventFixture({ id: 'synthetic-paid', title: '[SYNTHETIC] Paid workshop', startsAt: laterToday, endsAt: null, costCents: 1250, food: 'not-advertised', beginnerFriendly: false, flyerUrl: '/api/flyers/missing-image', evidence: [{ field: 'food', excerpt: 'Synthetic paid flyer: no food offer is stated.' }] }),
  eventFixture({ id: 'synthetic-unknown', title: '[SYNTHETIC] Unknown details', startsAt: tomorrow, endsAt: null, costCents: null, food: 'unknown', beginnerFriendly: null, eligibility: null, registrationUrl: null, sourceUrl: null }),
  eventFixture({ id: 'synthetic-import', title: '[SYNTHETIC] Imported USC calendar event with a long title to check wrapping on narrow phone screens', startsAt: tomorrow, endsAt: null, confirmation: 'source-imported', sourceKind: 'usc-calendar', sourceUrl: `https://example.com/${'long-source-path-'.repeat(12)}` }),
  eventFixture({ id: 'synthetic-engagesc', title: '[SYNTHETIC] EngageSC import', startsAt: tomorrow, endsAt: null, confirmation: 'source-imported', sourceKind: 'engagesc' }),
  eventFixture({ id: 'synthetic-cancelled', title: '[SYNTHETIC] Cancelled meetup', startsAt: tomorrow, endsAt: null, status: 'cancelled' }),
  eventFixture({ id: 'synthetic-past', title: '[SYNTHETIC] Past event', startsAt: new Date(+now - 86400000).toISOString(), endsAt: null }),
];
for (const event of process.argv.includes('--empty') ? [] : fixtures) {
  const record: StoredEvent = { id: event.id, status: event.status, organizationId: 'synthetic-org', organizationName: event.organizationName,
    data: event, flyerId: event.flyerUrl ? event.flyerUrl.split('/').at(-1)! : null, extractedBy: 'manual', confirmation: event.confirmation,
    externalId: null, createdAt: event.publishedAt, updatedAt: event.updatedAt, publishedAt: event.publishedAt };
  await store.insert(record);
}
// Tiny valid PNG, stored and served through the real flyer route.
await store.saveFlyer('synthetic-image', { mimeType: 'image/png', bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4V0AAAAASUVORK5CYII=', 'base64') });
const app = express();
app.use(express.json());
app.use('/api', apiRouter(store));
if (process.argv.includes('--built-client')) app.use(express.static(fileURLToPath(new URL('../../dist/client/', import.meta.url))));
const port = Number(process.env.FRONTEND_FIXTURE_PORT ?? 3001);
app.listen(port, '127.0.0.1', () => console.log(`Synthetic fixtures ready at http://127.0.0.1:${port}/api/events (memory only).`));
