import { z } from 'zod';
import { createDraftRequestSchema, type CreateDraftRequest, type UpdateDraftRequest } from '../../../shared/api';
import { eventDraftSchema, type EventDraft } from '../../../shared/events';
import { campusTimezone } from './events';

export class FormError extends Error {
  constructor(public field: string, message: string) { super(message); this.name = 'FormError'; }
}
const wallFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: campusTimezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
export function toWall(iso: string | null): string {
  if (!iso) return '';
  const p = Object.fromEntries(wallFormatter.formatToParts(new Date(iso)).map(part => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/** Enumerate real instants: a spring gap has none; a fall fold has two. */
export function wallCandidates(value: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return [];
  const normalized = value.length === 16 ? `${value}:00` : value;
  const target = Date.parse(`${normalized}Z`);
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 19) !== normalized) return [];
  const offsets = new Set<number>();
  for (const shift of [-2, 0, 2]) {
    const instant = target + shift * 86400000;
    offsets.add(Date.parse(`${toWall(new Date(instant).toISOString())}Z`) - instant);
  }
  return [...offsets].map(offset => new Date(target - offset).toISOString()).filter(iso => toWall(iso) === normalized).sort();
}

export function wallToIso(value: string, choice: string, field: string): string | null {
  if (!value) return null;
  const candidates = wallCandidates(value);
  if (!candidates.length) throw new FormError(field, 'This Los Angeles date/time is invalid or falls in a daylight saving gap. Choose another time.');
  if (candidates.length > 1 && !candidates.includes(choice)) throw new FormError(field, 'This time occurs twice in Los Angeles. Choose which occurrence you mean.');
  return candidates.length > 1 ? choice : candidates[0];
}

export function moneyToCents(value: string): number | null {
  if (!value.trim()) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) throw new FormError('costCents', 'Use a non-negative amount with at most two decimal places. Leave blank for unknown.');
  const [whole, fraction = ''] = value.trim().split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new FormError('costCents', 'This amount is too large.');
  return cents;
}

export const timeFields = ['startsAt', 'endsAt', 'registrationDeadline'] as const;
export type TimeField = typeof timeFields[number];
export type ReviewValues = {
  title: string; description: string; startsAt: string; endsAt: string; registrationDeadline: string;
  location: string; eligibility: string; costCents: string; food: EventDraft['food'];
  beginnerFriendly: '' | 'yes' | 'no'; registrationUrl: string; sourceUrl: string;
};
export type TimeChoices = Record<TimeField, string>;
export function reviewValues(draft: EventDraft): ReviewValues {
  return { title: draft.title, description: draft.description, startsAt: toWall(draft.startsAt), endsAt: toWall(draft.endsAt), registrationDeadline: toWall(draft.registrationDeadline),
    location: draft.location ?? '', eligibility: draft.eligibility ?? '', costCents: draft.costCents === null ? '' : (draft.costCents / 100).toFixed(2),
    food: draft.food, beginnerFriendly: draft.beginnerFriendly === null ? '' : draft.beginnerFriendly ? 'yes' : 'no', registrationUrl: draft.registrationUrl ?? '', sourceUrl: draft.sourceUrl ?? '' };
}
export function timeChoices(draft: EventDraft): TimeChoices {
  return Object.fromEntries(timeFields.map(field => [field, draft[field] ? new Date(draft[field]!).toISOString() : ''])) as TimeChoices;
}
const patchSchema = eventDraftSchema.omit({ timezone: true, sourceKind: true, evidence: true, uncertainties: true }).extend({ title: z.string().trim().max(200) });
export function serializeReview(values: ReviewValues, choices: TimeChoices, original: EventDraft): UpdateDraftRequest {
  const nullable = (s: string) => s.trim() || null;
  const result = { ...values, location: nullable(values.location), eligibility: nullable(values.eligibility), registrationUrl: nullable(values.registrationUrl), sourceUrl: nullable(values.sourceUrl),
    costCents: moneyToCents(values.costCents), beginnerFriendly: values.beginnerFriendly === '' ? null : values.beginnerFriendly === 'yes',
    ...Object.fromEntries(timeFields.map(field => {
      // Keep the original instant, including milliseconds, when the field was not changed.
      if (values[field] === toWall(original[field]) && choices[field] === (original[field] ? new Date(original[field]!).toISOString() : '')) return [field, original[field]];
      return [field, wallToIso(values[field], choices[field], field)];
    })),
  };
  const parsed = patchSchema.safeParse(result);
  if (!parsed.success) throw new FormError(String(parsed.error.issues[0].path[0]), parsed.error.issues[0].message);
  if (parsed.data.startsAt && parsed.data.endsAt && Date.parse(parsed.data.endsAt) <= Date.parse(parsed.data.startsAt)) throw new FormError('endsAt', 'End time must be after the start time.');
  return parsed.data;
}

export const imageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export function validateFile(file: Pick<File, 'size' | 'type'>) {
  if (!imageTypes.includes(file.type as typeof imageTypes[number])) throw new FormError('flyer', 'Choose a PNG, JPEG, WebP, or GIF image.');
  if (file.size === 0 || file.size > 5 * 1024 * 1024) throw new FormError('flyer', 'Choose an image up to 5 MB with content.');
}
export function imagePayload(dataUrl: string, mimeType: string) {
  const prefix = `data:${mimeType};base64,`;
  if (!dataUrl.startsWith(prefix)) throw new FormError('flyer', 'The image could not be read. Choose the file again.');
  return { imageBase64: dataUrl.slice(prefix.length), mimeType: mimeType as typeof imageTypes[number] };
}
export function readImage(file: File, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => { reader.abort(); reject(new DOMException('Aborted', 'AbortError')); };
    if (signal.aborted) { abort(); return; }
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    reader.onload = () => { cleanup(); typeof reader.result === 'string' ? resolve(reader.result) : reject(new FormError('flyer', 'Could not read this image.')); };
    reader.onerror = () => { cleanup(); reject(new FormError('flyer', 'Could not read this image. Choose the file again.')); };
    reader.onabort = cleanup;
    reader.readAsDataURL(file);
  });
}
export function validateCreate(input: unknown): CreateDraftRequest {
  const parsed = createDraftRequestSchema.safeParse(input);
  if (!parsed.success) throw new FormError(String(parsed.error.issues[0].path[0] ?? 'announcement'), parsed.error.issues[0].message);
  if (!parsed.data.text?.trim() && !parsed.data.imageBase64) throw new FormError('announcement', 'Provide a flyer image or announcement text.');
  if (parsed.data.sourceUrl && !/^https?:\/\//i.test(parsed.data.sourceUrl)) throw new FormError('sourceUrl', 'Use a full http or https source URL.');
  return parsed.data;
}
