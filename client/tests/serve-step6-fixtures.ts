/** Disposable production-client preview with synthetic content and the real API routes. */
import express from 'express';
import { fileURLToPath } from 'node:url';
import { apiRouter } from '../../server/routes';
import { createStore, type StoredEvent } from '../../server/store';
import { eventFixture } from './event-fixtures';

if (process.env.DATABASE_URL || process.env.NODE_ENV === 'production') throw new Error('Local memory mode only.');
const store = createStore();
await store.init();
const event = eventFixture({ id: 'synthetic-phone', title: '[SYNTHETIC] Campus meetup with a very long title for checking narrow phone layouts and keyboard access',
  startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: null,
  sourceUrl: `https://example.com/${'long-source-path'.repeat(24)}`,
  evidence: [{ field: 'title', excerpt: 'Synthetic source evidence '.repeat(25) }, { field: 'location', excerpt: 'Room-' + 'LongUnbrokenLocation'.repeat(20) }],
  uncertainties: ['Synthetic uncertainty: dietary suitability remains unknown. '.repeat(10)] });
const record: StoredEvent = { id: event.id, status: 'published', organizationId: 'demo-org-a', organizationName: 'Demo Org A', data: event, flyerId: null,
  extractedBy: 'manual', confirmation: 'organizer-confirmed', externalId: null, createdAt: event.publishedAt, updatedAt: event.updatedAt, publishedAt: event.publishedAt };
await store.insert(record);
await store.insert({ ...record, id: 'synthetic-review', status: 'draft', publishedAt: null });
const app = express();
app.use(express.json({ limit: '8mb' }));
// Explicit synthetic delay/failure switches, never included in the app or production server.
let mode = 'normal';
app.get('/__fixture/:mode', (req, res) => { mode = req.params.mode; res.type('text').send(`Synthetic fixture mode: ${mode}`); });
app.use('/api', async (_req, res, next) => {
  if (mode === 'slow') await new Promise(resolve => setTimeout(resolve, 2000));
  if (mode === 'error') return res.status(503).json({ error: 'Synthetic temporary failure. Retry when connected.' });
  next();
});
app.use('/api', apiRouter(store));
app.use(express.static(fileURLToPath(new URL('../../dist/client/', import.meta.url))));
app.listen(3003, '127.0.0.1', () => console.log('Step 6 synthetic build preview: http://127.0.0.1:3003'));
