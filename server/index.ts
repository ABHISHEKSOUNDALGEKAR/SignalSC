import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_FEED_URL, scheduleFeedImport } from './importer';
import { apiRouter } from './routes';
import { createStore } from './store';

const store = createStore();
await store.init();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Replit serves the app behind a proxy
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
// Flyer uploads carry a base64 image; everything else stays small.
app.use('/api/organizer/drafts', express.json({ limit: '8mb' }));
app.use(express.json({ limit: '1mb' }));
app.use('/api', apiRouter(store));
app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not implemented.' }));
const publicDir = fileURLToPath(new URL('./client/', import.meta.url));
app.use(express.static(publicDir));
app.get('/{*path}', (_req, res, next) => res.sendFile(path.join(publicDir, 'index.html'), err => err && next(err)));
app.use((error: Error & { status?: number; type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Upload is too large. Use an image under 5 MB.' });
  if (!error.status || error.status >= 500) console.error(error);
  res.status(error.status ?? 500).json({ error: error.status === 400 ? 'Invalid request body.' : 'Request could not be completed.' });
});
const port = Number(process.env.PORT ?? 3001);
app.listen(port, '0.0.0.0', () => {
  console.log(`SignalSC service listening on ${port} (${store.mode} store)`);
  // Public event feeds, imported and refreshed in the background.
  // EVENT_FEED_URLS (comma-separated) overrides the list; ENGAGESC_ICS_URL=off disables all.
  const feeds = process.env.ENGAGESC_ICS_URL === 'off' ? []
    : process.env.EVENT_FEED_URLS ? process.env.EVENT_FEED_URLS.split(',')
    : [process.env.ENGAGESC_ICS_URL || DEFAULT_FEED_URL, 'https://calendar.usc.edu/calendar.ics'];
  for (const feedUrl of feeds.map(u => u.trim()).filter(Boolean)) scheduleFeedImport(store, feedUrl);
});
