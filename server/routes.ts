import express from 'express';
import {
  createDraftRequestSchema, feedbackRequestSchema, loginRequestSchema, searchRequestSchema,
  type DraftResponse, type DraftsResponse, type EventRecord, type EventResponse, type EventsResponse, type FeedbackEntry, type FeedbackResponse, type FeedbackSummaryAvailableResponse, type HealthResponse,
  type FeedbackSummary, type OrganizerFeedbackResponse, type OrganizerSession, type PublishErrorResponse, type StoredFeedbackSummary,
} from '../shared/api';
import { clearSessionCookie, findOrganizationByCode, getSession, requireOrganizer, setSessionCookie } from './auth';
import { extractDraft } from './extract';
import { createFeedbackSummary } from './feedback';
import { refreshEventFood } from './engagesc-details';
import { buildIcs } from './ics';
import { modelConfigured, ModelUnavailableError } from './model';
import { applyPatch, missingForPublish, newId, toDraftRecord, toEventRecord } from './records';
import { inWindow, search } from './search';
import type { Store, StoredEvent } from './store';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const now = () => new Date().toISOString();

// Simple fixed-window limiter for model-backed routes.
function rateLimit(limit: number, windowMs: number): express.RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req, res, next) => {
    const key = req.ip ?? 'unknown';
    const t = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt < t) { hits.set(key, { count: 1, resetAt: t + windowMs }); return next(); }
    if (++entry.count > limit) return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
    next();
  };
}

async function publishedEvents(store: Store): Promise<EventRecord[]> {
  return (await store.list({ statuses: ['published'] })).map(toEventRecord);
}

export function apiRouter(store: Store) {
  const api = express.Router();
  const asyncRoute = (fn: (req: express.Request, res: express.Response) => Promise<unknown>): express.RequestHandler =>
    (req, res, next) => { fn(req, res).catch(next); };

  // ---------- Public ----------

  api.get('/health', (_req, res) => {
    const body: HealthResponse = { status: 'ok', mode: store.mode, modelConfigured };
    res.json(body);
  });

  api.get('/events', asyncRoute(async (req, res) => {
    const q = req.query;
    const from = typeof q.from === 'string' && !Number.isNaN(Date.parse(q.from)) ? new Date(q.from) : new Date();
    const to = typeof q.to === 'string' && !Number.isNaN(Date.parse(q.to)) ? new Date(q.to) : new Date(from.getTime() + 60 * 86_400_000);
    const text = typeof q.q === 'string' ? q.q.trim().toLowerCase() : '';
    if (text.length > 120) return res.status(400).json({ error: 'Search titles using up to 120 characters.' });
    const archiveSearch = q.scope === 'all' && text.length >= 2;
    const titleWords = text.normalize('NFKD').replace(/\p{M}/gu, '').match(/[\p{L}\p{N}]+/gu) ?? [];
    const events = (await publishedEvents(store))
      .filter(e => archiveSearch && !q.from && !q.to ? Boolean(e.startsAt) : inWindow(e, from, to))
      .filter(e => q.free !== '1' || e.costCents === 0)
      .filter(e => q.food !== '1' || e.food === 'advertised')
      .filter(e => !text || (archiveSearch
        ? titleWords.length > 0 && titleWords.every(word => e.title.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').includes(word))
        : [e.title, e.description, e.location, e.organizationName].join(' ').toLowerCase().includes(text)))
      .sort((a, b) => Date.parse(a.startsAt!) - Date.parse(b.startsAt!));
    const body: EventsResponse = { events, mode: 'live' };
    res.json(body);
  }));

  api.get('/events/:id', asyncRoute(async (req, res) => {
    const record = await store.get(String(req.params.id));
    // Cancelled events stay readable so students who saved them can see the cancellation.
    if (!record || record.status === 'draft') return res.status(404).json({ error: 'Event not found.' });
    const body: EventResponse = { event: toEventRecord(await refreshEventFood(store, record)) };
    res.json(body);
  }));

  api.post('/events/:id/feedback', rateLimit(10, 60_000), asyncRoute(async (req, res) => {
    const parsed = feedbackRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter a rating and valid feedback.' });
    const record = await store.get(String(req.params.id));
    if (!record || record.status === 'draft') return res.status(404).json({ error: 'Event not found.' });
    const startsAt = record.data.startsAt ? Date.parse(record.data.startsAt) : Number.NaN;
    if (!Number.isFinite(startsAt) || startsAt > Date.now()) return res.status(409).json({ error: 'Feedback opens after the event starts.' });
    const entry = {
      id: newId(),
      eventId: record.id,
      ...parsed.data,
      demo: false,
      createdAt: now(),
    };
    if (!await store.addFeedback(entry)) return res.status(409).json({ error: 'Feedback has already been sent from this device.' });
    const body: FeedbackResponse = { ok: true };
    res.status(201).json(body);
  }));

  api.get('/events/:id/feedback/summary-available', asyncRoute(async (req, res) => {
    const record = await store.get(String(req.params.id));
    if (!record || record.status === 'draft') return res.status(404).json({ error: 'Event not found.' });
    const body: FeedbackSummaryAvailableResponse = { count: (await store.listFeedback(record.id)).length };
    res.json(body);
  }));

  api.get('/events/:id/calendar.ics', asyncRoute(async (req, res) => {
    const record = await store.get(String(req.params.id));
    if (!record || record.status === 'draft' || !record.data.startsAt) return res.status(404).json({ error: 'Event not found.' });
    const e = toEventRecord(record);
    const ics = buildIcs({
      id: e.id, title: e.title, description: e.description, startsAt: e.startsAt!, endsAt: e.endsAt, location: e.location,
      url: e.registrationUrl ?? e.sourceUrl, cancelled: e.status === 'cancelled', updatedAt: e.updatedAt,
    }, req.hostname || 'signalsc');
    const filename = (e.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'event') + '.ics';
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(ics);
  }));

  api.get('/flyers/:id', asyncRoute(async (req, res) => {
    const flyer = await store.getFlyer(String(req.params.id));
    if (!flyer) return res.status(404).json({ error: 'Flyer not found.' });
    res.setHeader('Content-Type', flyer.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(flyer.bytes);
  }));

  api.post('/search', rateLimit(30, 60_000), asyncRoute(async (req, res) => {
    const parsed = searchRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Ask a question (up to 500 characters).' });
    const at = parsed.data.now ? new Date(parsed.data.now) : new Date();
    res.json(await search(parsed.data.query, await publishedEvents(store), at));
  }));

  // ---------- Organizer session ----------

  api.post('/organizer/session', rateLimit(10, 60_000), (req, res) => {
    const parsed = loginRequestSchema.safeParse(req.body);
    const org = parsed.success ? findOrganizationByCode(parsed.data.accessCode) : null;
    if (!org) return res.status(401).json({ error: 'That access code was not recognized.' });
    setSessionCookie(res, org);
    const body: OrganizerSession = { organizationId: org.id, organizationName: org.name };
    res.json(body);
  });

  api.get('/organizer/session', (req, res) => {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: 'Not signed in.' });
    res.json(session);
  });

  api.delete('/organizer/session', (_req, res) => { clearSessionCookie(res); res.status(204).end(); });

  // ---------- Organizer drafts ----------

  const organizer = express.Router();
  organizer.use(requireOrganizer);
  const session = (res: express.Response) => res.locals.organizer as OrganizerSession;

  async function ownRecord(req: express.Request, res: express.Response, statuses: StoredEvent['status'][]) {
    const record = await store.get(String(req.params.id));
    if (!record || !statuses.includes(record.status)) { res.status(404).json({ error: 'Not found.' }); return null; }
    if (record.organizationId !== session(res).organizationId) { res.status(403).json({ error: 'This event belongs to another organization.' }); return null; }
    return record;
  }

  organizer.post('/drafts', rateLimit(12, 60_000), asyncRoute(async (req, res) => {
    const parsed = createDraftRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid upload.' });
    const input = parsed.data;
    let bytes: Buffer | null = null;
    if (input.imageBase64) {
      bytes = Buffer.from(input.imageBase64, 'base64');
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return res.status(400).json({ error: 'Image must be under 5 MB.' });
    }
    let extracted;
    try {
      extracted = await extractDraft(input);
    } catch (error) {
      if (!(error instanceof ModelUnavailableError)) throw error;
      console.warn('Extraction failed:', error.message);
      return res.status(503).json({ error: 'Flyer reading is temporarily unavailable or at its usage limit. Please try again later.' });
    }
    const id = newId();
    let flyerId: string | null = null;
    if (bytes && input.mimeType) { flyerId = newId(); await store.saveFlyer(flyerId, { mimeType: input.mimeType, bytes }); }
    const t = now();
    const org = session(res);
    const record: StoredEvent = {
      id, status: 'draft', organizationId: org.organizationId, organizationName: org.organizationName,
      data: extracted.draft, flyerId, extractedBy: extracted.extractedBy, confirmation: null, externalId: null,
      createdAt: t, updatedAt: t, publishedAt: null,
    };
    await store.insert(record);
    const body: DraftResponse = { draft: toDraftRecord(record) };
    res.status(201).json(body);
  }));

  organizer.get('/drafts', asyncRoute(async (_req, res) => {
    const drafts = await store.list({ statuses: ['draft'], organizationId: session(res).organizationId });
    drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const body: DraftsResponse = { drafts: drafts.map(toDraftRecord) };
    res.json(body);
  }));

  organizer.patch('/drafts/:id', asyncRoute(async (req, res) => {
    const record = await ownRecord(req, res, ['draft']);
    if (!record) return;
    const result = applyPatch(record.data, req.body);
    if (!result.ok) return res.status(400).json({ error: result.error });
    const updated: StoredEvent = { ...record, data: result.draft, updatedAt: now() };
    await store.update(updated);
    const body: DraftResponse = { draft: toDraftRecord(updated) };
    res.json(body);
  }));

  organizer.post('/drafts/:id/publish', asyncRoute(async (req, res) => {
    const record = await ownRecord(req, res, ['draft']);
    if (!record) return;
    const missing = missingForPublish(record.data);
    if (missing.length) {
      const body: PublishErrorResponse = { error: 'Add the missing details before publishing.', missing };
      return res.status(422).json(body);
    }
    const t = now();
    // Review is complete once the organizer publishes; extraction notes no longer apply.
    const published: StoredEvent = { ...record, data: { ...record.data, uncertainties: [] }, status: 'published', confirmation: 'organizer-confirmed', updatedAt: t, publishedAt: t };
    await store.update(published);
    const body: EventResponse = { event: toEventRecord(published) };
    res.json(body);
  }));

  organizer.get('/events', asyncRoute(async (_req, res) => {
    const records = await store.list({ statuses: ['published', 'cancelled'], organizationId: session(res).organizationId });
    const events = records.map(toEventRecord).sort((a, b) => Date.parse(b.startsAt ?? '') - Date.parse(a.startsAt ?? ''));
    const body: EventsResponse = { events, mode: 'live' };
    res.json(body);
  }));

  organizer.get('/events/:id/feedback', asyncRoute(async (req, res) => {
    const record = await ownRecord(req, res, ['published', 'cancelled']);
    if (!record) return;
    const [entries, stored] = await Promise.all([
      store.listFeedback(record.id),
      store.getMeta(`feedback-summary:${record.id}`),
    ]);
    let summary: StoredFeedbackSummary | null = null;
    if (stored) {
      try { summary = JSON.parse(stored) as StoredFeedbackSummary; }
      catch { summary = null; }
    }
    const responses: FeedbackEntry[] = entries.map(({ rating, wouldReturn, comment, createdAt, demo }) => ({ rating, wouldReturn, comment, createdAt, demo }));
    const body: OrganizerFeedbackResponse = { responses, summary };
    res.json(body);
  }));

  organizer.post('/events/:id/feedback/summary', asyncRoute(async (req, res) => {
    const record = await ownRecord(req, res, ['published', 'cancelled']);
    if (!record) return;
    const entries = await store.listFeedback(record.id);
    if (entries.length < 3) return res.status(422).json({ error: 'Add at least 3 responses before summarizing.', count: entries.length });
    let summary: FeedbackSummary;
    try { summary = await createFeedbackSummary(entries); }
    catch (error) {
      if (!(error instanceof ModelUnavailableError)) throw error;
      return res.status(503).json({ error: 'Feedback summary is temporarily unavailable. Any previous summary is unchanged.' });
    }
    const result: StoredFeedbackSummary = { summary, generatedAt: now(), responseCount: entries.length };
    await store.setMeta(`feedback-summary:${record.id}`, JSON.stringify(result));
    res.json(result);
  }));

  organizer.patch('/events/:id', asyncRoute(async (req, res) => {
    const record = await ownRecord(req, res, ['published', 'cancelled']);
    if (!record) return;
    const result = applyPatch(record.data, req.body);
    if (!result.ok) return res.status(400).json({ error: result.error });
    const missing = missingForPublish(result.draft);
    if (missing.length) return res.status(422).json({ error: 'Published events need these details.', missing } satisfies PublishErrorResponse);
    const cancelled = (req.body as { cancelled?: unknown })?.cancelled;
    const status = cancelled === true ? 'cancelled' : cancelled === false ? 'published' : record.status;
    const updated: StoredEvent = { ...record, data: result.draft, status, updatedAt: now() };
    await store.update(updated);
    const body: EventResponse = { event: toEventRecord(updated) };
    res.json(body);
  }));

  api.use('/organizer', organizer);
  return api;
}
