import React, { useEffect, useRef, useState } from 'react';
import type { DraftRecord, EventRecord, UpdateDraftRequest } from '../../../shared/api';
import type { EventDraft } from '../../../shared/events';
import { ApiError, errorMessage } from '../lib/api';
import { dateLabel, sourceLabel } from '../lib/events';
import { FormError, reviewValues, serializeReview, timeChoices, wallCandidates, type ReviewValues, type TimeField } from '../lib/organizer-form';

export function OrganizerError({ error }: { error: unknown }) {
  return <div className="error-state" role="alert"><p>{error instanceof FormError ? error.message : errorMessage(error)}</p>
    {error instanceof ApiError && error.missing.length > 0 && <ul>{error.missing.map(field => <li key={field}>{field}</li>)}</ul>}
  </div>;
}

export function ReviewForm({ record, busy, error, originalText, onSave, onClose }: {
  record: DraftRecord | EventRecord; busy: boolean; error: unknown; originalText?: string;
  onSave: (patch: UpdateDraftRequest, publish: boolean) => void; onClose: () => void;
}) {
  const draft = 'draft' in record ? record.draft : record;
  const isDraft = record.status === 'draft';
  const [values, setValues] = useState(() => reviewValues(draft));
  const [choices, setChoices] = useState(() => timeChoices(draft));
  const [localError, setLocalError] = useState<unknown>(null);
  const form = useRef<HTMLFormElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const shownError = localError ?? error;
  const missing = shownError instanceof ApiError ? shownError.missing : shownError instanceof FormError ? [shownError.field] : [];
  useEffect(() => {
    if (!shownError) return;
    const field = missing[0];
    const target = field ? form.current?.elements.namedItem(field) : null;
    if (target instanceof HTMLElement) target.focus(); else summary.current?.focus();
  }, [shownError]); // Error focus only, never on ordinary edits.
  const update = <K extends keyof ReviewValues>(field: K, value: ReviewValues[K]) => {
    setValues(current => ({ ...current, [field]: value }));
    if (['startsAt', 'endsAt', 'registrationDeadline'].includes(field)) setChoices(current => ({ ...current, [field]: '' }));
  };
  function submit(publish: boolean) {
    if (!form.current?.reportValidity()) return;
    try { const patch = serializeReview(values, choices, draft); setLocalError(null); onSave(patch, publish); }
    catch (cause) { setLocalError(cause); }
  }
  const evidenceAliases: Partial<Record<keyof EventDraft, string[]>> = { startsAt: ['date', 'startTime', 'year'], endsAt: ['endTime'], costCents: ['isFree', 'costDollars'], registrationDeadline: ['registrationDeadlineDate', 'registrationDeadlineTime'] };
  function field(name: keyof ReviewValues, label: string, control: React.ReactNode) {
    const evidence = draft.evidence.filter(item => [name, ...(evidenceAliases[name] ?? [])].includes(item.field));
    const uncertain = draft.uncertainties.some(note => note.toLowerCase().includes(label.toLowerCase()) || note.toLowerCase().includes(name.toLowerCase()));
    return <div className={`review-field${uncertain ? ' uncertain-field' : ''}`} key={name}>
      <label htmlFor={`review-${name}`}>{label}</label>{control}
      <div id={`note-${name}`} className="field-note">{missing.includes(name) && <p className="field-error">Check {label.toLowerCase()} before continuing.</p>}
        {uncertain && <p>Review flagged: see extraction uncertainties.</p>}
        {evidence.map((item, index) => <p key={index}><strong>Source evidence:</strong> {item.excerpt}</p>)}
      </div>
    </div>;
  }
  const props = (name: keyof ReviewValues) => ({ id: `review-${name}`, name, value: values[name], 'aria-describedby': `note-${name}`, 'aria-invalid': missing.includes(name) || undefined });
  function text(name: keyof ReviewValues, label: string, limit: number, type = 'text') {
    return field(name, label, <input {...props(name)} type={type} maxLength={limit} onChange={e => update(name, e.target.value as never)} />);
  }
  function time(name: TimeField, label: string) {
    const candidates = wallCandidates(values[name]);
    return field(name, label, <><input {...props(name)} type="datetime-local" step="1" onChange={e => update(name, e.target.value)} />
      {candidates.length > 1 && <><label htmlFor={`choice-${name}`}>Which occurrence?</label><select id={`choice-${name}`} value={choices[name]} onChange={e => setChoices(current => ({ ...current, [name]: e.target.value }))}>
        <option value="">Choose a time occurrence</option>{candidates.map(iso => <option key={iso} value={iso}>{dateLabel(iso)} ({iso})</option>)}
      </select></>}
    </>);
  }
  return <section className="panel organizer-review" aria-labelledby="review-heading">
    <h2 id="review-heading" tabIndex={-1}>{isDraft ? 'Review draft' : 'Edit event'}</h2>
    <p>All date and time inputs use Los Angeles time. Blank optional fields mean Unknown; enter 0 for free admission.</p>
    <p className="filter-note">Source: {sourceLabel(draft.sourceKind)} · {draft.timezone}. Evidence is retained from the source.</p>
    {'extractedBy' in record && record.extractedBy === 'manual' && <p className="notice">Automatic extraction was unavailable. Fill in the details manually, using the source.</p>}
    {draft.uncertainties.length > 0 && <aside className="uncertainties"><h3>Extraction uncertainties — check before publishing</h3><ul>{draft.uncertainties.map((note, i) => <li key={i}>{note}</li>)}</ul></aside>}
    <div ref={summary} tabIndex={-1}>{shownError ? <OrganizerError error={shownError} /> : null}</div>
    <ReviewSource flyerUrl={record.flyerUrl} text={originalText} />
    <form ref={form} onSubmit={e => { e.preventDefault(); submit(false); }} aria-busy={busy}>
      <fieldset disabled={busy}><legend className="sr-only">Event details</legend><div className="review-grid">
        {text('title', 'Title', 200)}
        {field('description', 'Description', <textarea {...props('description')} rows={5} maxLength={5000} onChange={e => update('description', e.target.value)} />)}
        {time('startsAt', 'Start time')}{time('endsAt', 'End time')}
        {text('location', 'Location', 500)}{text('eligibility', 'Eligibility', 1000)}
        {field('costCents', 'Admission in dollars', <input {...props('costCents')} inputMode="decimal" onChange={e => update('costCents', e.target.value)} placeholder="Unknown" />)}
        {field('food', 'Food', <select {...props('food')} onChange={e => update('food', e.target.value as ReviewValues['food'])}><option value="unknown">Unknown</option><option value="advertised">Advertised</option><option value="not-advertised">Not advertised</option></select>)}
        {field('beginnerFriendly', 'Beginner-friendly', <select {...props('beginnerFriendly')} onChange={e => update('beginnerFriendly', e.target.value as ReviewValues['beginnerFriendly'])}><option value="">Unknown</option><option value="yes">Yes, explicitly stated</option><option value="no">No</option></select>)}
        {text('registrationUrl', 'Registration URL', 5000, 'url')}{time('registrationDeadline', 'Registration deadline')}{text('sourceUrl', 'Source URL', 5000, 'url')}
      </div>
      <p className="filter-note">“Not advertised” means the source did not offer food, not that there will be no food. Dietary suitability stays unknown unless stated in the source.</p>
      <div className="event-actions"><button className="button" type="submit">{isDraft ? 'Save draft' : 'Save changes'}</button>
        {isDraft && <button className="button" type="button" onClick={() => submit(true)}>Save and publish</button>}
        <button className="button button-secondary" type="button" onClick={onClose}>Close review</button>
      </div></fieldset>
      {busy && <p role="status">Working on your request…</p>}
    </form>
    {draft.evidence.length > 0 && <details><summary>All source evidence</summary><dl>{draft.evidence.map((item, i) => <React.Fragment key={i}><dt>{item.field}</dt><dd>{item.excerpt}</dd></React.Fragment>)}</dl></details>}
  </section>;
}

function ReviewSource({ flyerUrl, text }: { flyerUrl: string | null; text?: string }) {
  const [failed, setFailed] = useState(false);
  return <aside className="review-source"><h3>Review against the source</h3>
    {flyerUrl?.startsWith('/api/flyers/') && !failed ? <img className="flyer" src={flyerUrl} alt="Uploaded event flyer; extracted evidence is shown beside the form fields." onError={() => setFailed(true)} /> : <p>{failed ? 'The flyer could not be loaded. Use the evidence below or try reopening the draft.' : 'No flyer image attached.'}</p>}
    {text && <><h4 id="announcement-heading">Submitted announcement</h4><pre className="announcement-preview" tabIndex={0} role="region" aria-labelledby="announcement-heading">{text}</pre></>}
  </aside>;
}
