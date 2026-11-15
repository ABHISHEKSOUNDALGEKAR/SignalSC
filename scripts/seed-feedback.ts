import { randomUUID } from 'node:crypto';
import { newId } from '../server/records';
import { createStore } from '../server/store';

const args = process.argv.slice(2);
const allowProduction = args.includes('--allow-production');
const eventId = args.find(arg => !arg.startsWith('--'));

if (process.env.NODE_ENV === 'production' && !allowProduction) {
  console.error('Refusing to seed feedback in production without --allow-production.');
  process.exitCode = 1;
} else if (!eventId) {
  console.error('Usage: npx tsx --env-file-if-exists=.env scripts/seed-feedback.ts <eventId> [--allow-production]');
  process.exitCode = 1;
} else {
  const store = createStore();
  try {
    await store.init();
    const event = await store.get(eventId);
    if (!event || !['published', 'cancelled'].includes(event.status)) throw new Error('Choose an existing published or cancelled event.');
    const existing = await store.listFeedback(eventId);
    if (existing.some(item => item.demo)) throw new Error('Demo feedback already exists for this event.');
    const seed = [
      { rating: 5, wouldReturn: true, comment: 'The discussion was thoughtful and the organizers made everyone feel welcome.' },
      { rating: 4, wouldReturn: true, comment: 'I liked meeting students from other majors. The snacks were a nice touch.' },
      { rating: 3, wouldReturn: false, comment: 'The event started later than planned, so I had to leave before the last activity.' },
      { rating: 4, wouldReturn: true, comment: 'The room was comfortable, but it was hard to find from the main entrance.' },
      { rating: 3, wouldReturn: null, comment: 'The sign-in line moved slowly at the beginning.' },
      { rating: 5, wouldReturn: true, comment: 'The speakers were engaging. An earlier start would make it easier to attend.' },
      { rating: 4, wouldReturn: null, comment: 'I enjoyed the conversation and would have liked a little more time for questions.' },
    ];
    let inserted = 0;
    for (let index = 0; index < seed.length; index++) {
      const item = seed[index];
      const saved = await store.addFeedback({
        id: newId(),
        eventId,
        ...item,
        deviceKey: `demo-${randomUUID()}`,
        demo: true,
        createdAt: new Date(Date.now() + index).toISOString(),
      });
      if (saved) inserted++;
    }
    console.log(`Inserted ${inserted} demo feedback responses.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Could not seed feedback.');
    process.exitCode = 1;
  } finally {
    await store.close?.();
  }
}
