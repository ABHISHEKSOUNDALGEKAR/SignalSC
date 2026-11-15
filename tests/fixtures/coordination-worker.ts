// Spawned only against the test's disposable PostgreSQL, with a fake provider.
import { completeJson, reserveModelRetryAttempt } from '../../server/model';
import { createStore } from '../../server/store';
import { enrichImportedEvents } from '../../server/import-enrichment';
import { emptyDraft } from '../../server/extract';
let calls = 0;
globalThis.fetch = async () => {
  calls++;
  if (process.argv[2] === 'crash' || process.argv[2] === 'import-crash') {
    console.log('outbound-attempt');
    process.exit(23);
  }
  if (process.argv[2] === 'http-failure') return new Response('private provider body', { status: 503 });
  if (process.argv[2] === 'invalid') return Response.json({ choices: [{ message: { content: 'invalid' } }] });
  if (process.argv[2] === 'retry') {
    await reserveModelRetryAttempt();
    calls++;
  }
  return Response.json({ choices: [{ message: { content: '{}' } }] });
};
try {
  if (process.argv[2]?.startsWith('import-')) {
    await enrichImportedEvents(createStore(), [{ draft: {
      ...emptyDraft(null), title: 'Crash fixture', description: 'A synthetic gathering.',
    } }]);
  } else await completeJson([]);
  console.log(JSON.stringify({ calls, accepted: true }));
} catch (error) {
  console.log(JSON.stringify({ calls, accepted: false, error: error instanceof Error ? error.message : 'failed' }));
}
