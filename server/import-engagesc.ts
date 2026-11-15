// Manual feed import: npm run import:engagesc [-- <feed-url>]
// The server also refreshes the feed on its own (see importer.ts); this is for one-off runs.
import { DEFAULT_FEED_URL, importFeed } from './importer';
import { createStore } from './store';

async function main() {
  const configured = process.argv[2] ?? process.env.ENGAGESC_ICS_URL;
  const url = configured && configured !== 'off' ? configured : DEFAULT_FEED_URL;
  const store = createStore();
  await store.init();
  const r = await importFeed(store, url);
  console.log(`Imported ${r.inserted} new, updated ${r.updated}, unchanged ${r.unchanged}, skipped ${r.skipped} (past, all-day, cancelled or incomplete).`);
  process.exit(0);
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
