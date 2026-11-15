import crypto from 'node:crypto';
import { z } from 'zod';
import type { DraftRecord, EventRecord } from '../shared/api';
import { eventDraftSchema, type EventDraft } from '../shared/events';
import type { StoredEvent } from './store';

export const newId = () => crypto.randomUUID();
export const flyerUrl = (flyerId: string | null) => (flyerId ? `/api/flyers/${flyerId}` : null);

export function toDraftRecord(r: StoredEvent): DraftRecord {
  return {
    id: r.id, status: 'draft', draft: r.data, organizationName: r.organizationName ?? '',
    flyerUrl: flyerUrl(r.flyerId), extractedBy: r.extractedBy === 'model' ? 'model' : 'manual',
    suggestions: r.suggestions ?? [],
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

export function toEventRecord(r: StoredEvent): EventRecord {
  return {
    ...r.data,
    id: r.id,
    status: r.status === 'cancelled' ? 'cancelled' : 'published',
    confirmation: r.confirmation ?? 'source-imported',
    organizationName: r.organizationName,
    flyerUrl: flyerUrl(r.flyerId),
    updatedAt: r.updatedAt,
    publishedAt: r.publishedAt ?? r.updatedAt,
  };
}

// Fields an organizer may edit. sourceKind, timezone and evidence are kept server-side.
const editableKeys = [
  'title', 'description', 'startsAt', 'endsAt', 'location', 'eligibility', 'costCents', 'food',
  'beginnerFriendly', 'registrationUrl', 'registrationDeadline', 'sourceUrl', 'uncertainties',
] as const;

const draftPatchSchema = eventDraftSchema
  .pick(Object.fromEntries(editableKeys.map(k => [k, true])) as { [K in typeof editableKeys[number]]: true })
  .extend({ title: z.string().trim().max(200) }) // drafts may have an empty title until publish
  .partial()
  .strict();

export function applyPatch(current: EventDraft, body: unknown): { ok: true; draft: EventDraft } | { ok: false; error: string } {
  const source = body && typeof body === 'object' ? { ...(body as Record<string, unknown>) } : {};
  delete source.cancelled;
  const parsed = draftPatchSchema.safeParse(source);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `Invalid ${issue.path.join('.') || 'request'}: ${issue.message}` };
  }
  const next = { ...current, ...parsed.data };
  if (next.startsAt && next.endsAt && new Date(next.endsAt) <= new Date(next.startsAt)) {
    return { ok: false, error: 'End time must be after the start time.' };
  }
  return { ok: true, draft: next };
}

// Facts that must be known before students can see an event.
export function missingForPublish(draft: EventDraft): string[] {
  const missing: string[] = [];
  if (!draft.title.trim()) missing.push('title');
  if (!draft.startsAt) missing.push('startsAt');
  if (!draft.location) missing.push('location');
  if (!eventDraftSchema.safeParse(draft).success && !missing.length) missing.push('invalid fields');
  return missing;
}
