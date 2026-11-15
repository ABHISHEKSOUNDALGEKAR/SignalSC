import { cloneElement, useEffect, useState, type FormEvent, type ReactElement, type ReactNode } from 'react';
import type { DraftRecord, EventRecord } from './api';
import { api, ApiError } from './api';
import type { EventDraft } from '../../shared/events';
import { dateLabel, EmptyState, ErrorNotice, LoadingList, unknown } from './common';
import { campusInput as dateInput, campusInstant } from './time';

const blankDraft = (): EventDraft => ({
  title: '', description: '', startsAt: null, endsAt: null, timezone: 'America/Los_Angeles',
  location: null, eligibility: null, costCents: null, food: 'unknown', beginnerFriendly: null,
  registrationUrl: null, registrationDeadline: null, sourceUrl: null, sourceKind: 'flyer',
  evidence: [], uncertainties: [],
});

function draftPatch(draft: EventDraft): Partial<EventDraft> {
  return {
    title: draft.title,
    description: draft.description,
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    location: draft.location,
    eligibility: draft.eligibility,
    costCents: draft.costCents,
    food: draft.food,
    beginnerFriendly: draft.beginnerFriendly,
    registrationUrl: draft.registrationUrl,
    registrationDeadline: draft.registrationDeadline,
    sourceUrl: draft.sourceUrl,
    uncertainties: draft.uncertainties,
  };
}

function Evidence({ draft, field }: { draft: EventDraft; field: string }) {
  const aliases: Record<string, string[]> = {
    startsAt: ['date', 'startTime'], endsAt: ['endTime'], costCents: ['isFree', 'costDollars', 'cost'],
    registrationDeadline: ['registrationDeadlineDate', 'registrationDeadlineTime'],
  };
  const names = [field, ...(aliases[field] ?? [])];
  const evidence = draft.evidence.filter(item => names.includes(item.field));
  const uncertain = draft.uncertainties.some(item => item.toLowerCase().includes(field.toLowerCase()) || item.toLowerCase().includes(fieldLabel(field).toLowerCase()));
  if (!evidence.length && !uncertain) return null;
  return <div>
    {uncertain && <div className="uncertainty">Needs a closer look: this field is flagged as uncertain.</div>}
    {evidence.map((item, index) => <div className="evidence" key={`${item.excerpt}-${index}`}><b>Flyer evidence</b>“{item.excerpt}”</div>)}
  </div>;
}
function fieldLabel(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
}
function ReviewForm({ initial, onSave, onPublish, saving, publishing, message, missing, mode }: {
  initial: EventDraft; onSave: (draft: EventDraft) => void; onPublish?: (draft: EventDraft) => void;
  saving: boolean; publishing: boolean; message: string; missing: string[]; mode: 'draft' | 'event';
}) {
  const [draft, setDraft] = useState<EventDraft>(initial);
  const [timeError, setTimeError] = useState('');
  useEffect(() => setDraft(initial), [initial]);
  const set = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) => setDraft(old => ({ ...old, [key]: value }));
  function dateValue(value: string): string | null {
    try { const result = campusInstant(value); setTimeError(''); return result; }
    catch (e) { setTimeError(e instanceof Error ? e.message : 'Invalid time.'); return null; }
  }
  const field = (key: keyof EventDraft, label: string, control: ReactNode, wide = false) =>
    <div className={`field ${wide ? 'full' : ''}`} key={key}><label htmlFor={`review-${key}`}>{label}</label>{cloneElement(control as ReactElement<{ id: string }>, { id: `review-${key}` })}<Evidence draft={draft} field={String(key)} /></div>;
  return <form className="form-panel" onSubmit={e => { e.preventDefault(); if (!timeError) onSave(draft); }}>
    {draft.uncertainties.length > 0 && <div className="inline-message"><strong>Confirm these details before publishing</strong><ul>{draft.uncertainties.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
    <div className="review-layout">
      <div>
        <div className="form-grid">
          {field('title', 'Event title *', <input maxLength={200} value={draft.title} onChange={e => set('title', e.target.value)} />)}
          {field('startsAt', 'Starts at *', <input type="datetime-local" value={dateInput(draft.startsAt)} onChange={e => set('startsAt', dateValue(e.target.value))} />)}
          {field('endsAt', 'Ends at', <input type="datetime-local" value={dateInput(draft.endsAt)} onChange={e => set('endsAt', dateValue(e.target.value))} />)}
          {field('location', 'Location', <input maxLength={500} placeholder="Unknown if not on the flyer" value={draft.location ?? ''} onChange={e => set('location', e.target.value || null)} />)}
          {field('eligibility', 'Who can attend?', <input maxLength={1000} placeholder="All students, members only…" value={draft.eligibility ?? ''} onChange={e => set('eligibility', e.target.value || null)} />)}
          {field('costCents', 'Admission cost (USD)', <input type="number" min="0" step="0.01" placeholder="Leave blank if unknown" value={draft.costCents === null ? '' : (draft.costCents / 100).toString()} onChange={e => set('costCents', e.target.value === '' ? null : Math.round(Number(e.target.value) * 100))} />)}
          {field('food', 'Food', <select value={draft.food} onChange={e => set('food', e.target.value as EventDraft['food'])}><option value="unknown">Unknown</option><option value="advertised">Advertised</option><option value="not-advertised">Not advertised</option></select>)}
          {field('beginnerFriendly', 'Beginner friendly?', <select value={draft.beginnerFriendly === null ? 'unknown' : draft.beginnerFriendly ? 'yes' : 'no'} onChange={e => set('beginnerFriendly', e.target.value === 'unknown' ? null : e.target.value === 'yes')}><option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select>)}
          {field('registrationUrl', 'Registration link', <input type="url" placeholder="https://" value={draft.registrationUrl ?? ''} onChange={e => set('registrationUrl', e.target.value || null)} />)}
          {field('registrationDeadline', 'Registration deadline', <input type="datetime-local" value={dateInput(draft.registrationDeadline)} onChange={e => set('registrationDeadline', dateValue(e.target.value))} />)}
          {field('sourceUrl', 'Source link', <input type="url" placeholder="https://" value={draft.sourceUrl ?? ''} onChange={e => set('sourceUrl', e.target.value || null)} />)}
          {field('description', 'Description', <textarea maxLength={5000} rows={5} value={draft.description} onChange={e => set('description', e.target.value)} />, true)}
          {field('uncertainties', 'Items to confirm (one per line)', <textarea rows={3} value={draft.uncertainties.join('\n')} onChange={e => set('uncertainties', e.target.value.split('\n').map(item => item.trim()).filter(Boolean))} />, true)}
        </div>
        {timeError && <div className="inline-message" role="alert">{timeError}</div>}
        {message && <div className="inline-message" role="status">{message}{missing.length > 0 && <ul>{missing.map(item => <li key={item}>{fieldLabel(item)}</li>)}</ul>}</div>}
        <div className="form-actions">
          <button className="btn btn-outline" type="submit" disabled={saving || publishing || !!timeError}>{saving ? 'Saving…' : 'Save review'}</button>
          {mode === 'draft' && onPublish && <button className="btn btn-primary" type="button" disabled={saving || publishing || !!timeError} onClick={() => onPublish(draft)}>{publishing ? 'Publishing…' : 'Save & publish'}</button>}
        </div>
      </div>
      <aside className="review-aside"><h3>Review, don’t guess.</h3><p className="event-meta">Fields marked unknown stay unknown until you can verify them. Publishing clears review notes after you confirm the details.</p>
        <div className="divider-label">Read-only details</div>
        <div className="field-label">Timezone</div><div className="field-value">America / Los Angeles</div>
        <div className="field-label" style={{ marginTop: 13 }}>Source kind</div><div className="field-value">{draft.sourceKind === 'engagesc' ? 'EngageSC' : draft.sourceKind === 'usc-calendar' ? 'USC Calendar' : 'Flyer'}</div>
        <div className="field-label" style={{ marginTop: 13 }}>Evidence · {draft.evidence.length || 'none'} · read-only</div>
        {draft.evidence.map((item, index) => <div className="evidence" key={`${item.field}-${index}`}><b>{fieldLabel(item.field)}</b>“{item.excerpt}”</div>)}
      </aside>
    </div>
  </form>;
}

export function OrganizerPage() {
  const [session, setSession] = useState<{ organizationId: string; organizationName: string } | null>(null);
  const [checking, setChecking] = useState(true);
  const [accessCode, setAccessCode] = useState('');
  const [signinError, setSigninError] = useState('');
  const [signing, setSigning] = useState(false);
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [selected, setSelected] = useState<DraftRecord | null>(null);
  const [editEvent, setEditEvent] = useState<EventRecord | null>(null);
  const [text, setText] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [loadingData, setLoadingData] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [formMessage, setFormMessage] = useState('');
  const [missing, setMissing] = useState<string[]>([]);
  const [dataError, setDataError] = useState('');

  async function checkSession() {
    setChecking(true);
    try { setSession(await api.session()); } catch (e) {
      setSession(null);
      if (!(e instanceof ApiError && e.status === 401)) setSigninError(e instanceof Error ? e.message : 'Could not check your session.');
    } finally { setChecking(false); }
  }
  async function loadOrganizerData() {
    setLoadingData(true); setDataError('');
    try {
      const [draftData, eventData] = await Promise.all([api.drafts(), api.ownEvents()]);
      setDrafts(draftData.drafts); setEvents(eventData.events);
    } catch (e) { setDataError(e instanceof Error ? e.message : 'Organizer records could not be loaded.'); }
    finally { setLoadingData(false); }
  }
  useEffect(() => { void checkSession(); }, []);
  useEffect(() => { if (session) void loadOrganizerData(); }, [session]);

  async function signIn(e: FormEvent) {
    e.preventDefault(); setSigning(true); setSigninError('');
    try { setSession(await api.signIn(accessCode.trim())); setAccessCode(''); }
    catch (error) { setSigninError(error instanceof Error ? error.message : 'Sign in failed.'); }
    finally { setSigning(false); }
  }
  async function signOut() {
    try {
      await api.signOut();
      setSession(null); setDrafts([]); setEvents([]); setSelected(null); setEditEvent(null);
      setText(''); setFile(null); setSourceUrl(''); setFormMessage(''); setMissing([]); setDataError('');
    } catch (e) { setDataError(e instanceof Error ? e.message : 'Sign out failed. Try again.'); }
  }
  async function upload() {
    setUploadError('');
    if (!file && !text.trim()) { setUploadError('Choose a flyer image or paste the announcement text.'); return; }
    setUploading(true);
    try {
      let imageBase64: string | undefined;
      let mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | undefined;
      if (file) {
        const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
        if (!allowed.includes(file.type)) throw new Error('Use a PNG, JPEG, WebP, or GIF flyer.');
        if (file.size > 5 * 1024 * 1024) throw new Error('Flyer images must be under 5 MB.');
        mimeType = file.type as typeof mimeType;
        imageBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error('The flyer could not be read.'));
          reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
          reader.readAsDataURL(file);
        });
      }
      const created = await api.createDraft({ ...(imageBase64 ? { imageBase64, mimeType } : {}), ...(text.trim() ? { text: text.trim() } : {}), ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}) });
      setText(''); setFile(null); setSourceUrl(''); setSelected(created.draft); await loadOrganizerData();
    } catch (error) { setUploadError(error instanceof Error ? error.message : 'We could not read this flyer.'); }
    finally { setUploading(false); }
  }
  async function saveDraft(draft: EventDraft) {
    if (!selected) return;
    setSaveBusy(true); setFormMessage(''); setMissing([]);
    try {
      const updated = await api.updateDraft(selected.id, draftPatch(draft));
      setSelected(updated.draft); setFormMessage('Review saved.'); await loadOrganizerData();
    } catch (e) { setFormMessage(e instanceof Error ? e.message : 'Save failed.'); }
    finally { setSaveBusy(false); }
  }
  async function publishDraft(draft: EventDraft) {
    if (!selected) return;
    setPublishBusy(true); setFormMessage(''); setMissing([]);
    try {
      const updated = await api.updateDraft(selected.id, draftPatch(draft));
      setSelected(updated.draft);
      const published = await api.publish(selected.id);
      setFormMessage(`${published.event.title} is now published.`);
      setSelected(null); await loadOrganizerData();
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) { setMissing(e.missing); setFormMessage(e.message); }
      else setFormMessage(e instanceof Error ? e.message : 'Could not publish this event.');
    } finally { setPublishBusy(false); }
  }
  async function saveEvent(draft: EventDraft) {
    if (!editEvent) return;
    setSaveBusy(true); setFormMessage(''); setMissing([]);
    try {
      const updated = await api.updateEvent(editEvent.id, draftPatch(draft));
      setEditEvent(updated.event); setFormMessage('Event details updated.'); await loadOrganizerData();
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) { setMissing(e.missing); setFormMessage(e.message); }
      else setFormMessage(e instanceof Error ? e.message : 'Could not update event.');
    } finally { setSaveBusy(false); }
  }
  async function cancelEvent(event: EventRecord) {
    const restore = event.status === 'cancelled';
    if (!window.confirm(restore ? `Restore “${event.title}” and show it as active again?` : `Cancel “${event.title}”? Students who saved it will see the cancellation.`)) return;
    try { await api.updateEvent(event.id, { cancelled: event.status !== 'cancelled' }); await loadOrganizerData(); }
    catch (e) { setDataError(e instanceof Error ? e.message : 'Could not update event status.'); }
  }

  if (checking) return <main className="page organizer-wrap"><div className="hero"><div className="eyebrow">Organizer desk</div><h1>Your events,<br />in good hands.</h1></div><LoadingList count={2} /></main>;
  if (!session) return <main className="page organizer-wrap">
    <section className="hero"><div className="eyebrow">For the people who make campus happen</div><h1>Turn a flyer<br />into a plan.</h1><p className="lede">Sign in with your organization’s access code to review event details, then publish what students can trust.</p><div className="hero-rule" /></section>
    <div className="content-grid"><form className="form-panel" onSubmit={signIn}><h2>Organizer sign in</h2><p className="event-meta">This private workspace is for verified campus organizers.</p><div className="field"><label htmlFor="access-code">Organization access code</label><input id="access-code" autoComplete="current-password" value={accessCode} onChange={e => setAccessCode(e.target.value)} required /></div>{signinError && <div className="inline-message" role="alert">{signinError}</div>}<button className="btn btn-primary" disabled={signing}>{signing ? 'Checking code…' : 'Continue'}</button></form>
      <aside className="side-note"><div className="mini-star">✦</div><h3>People are planning around this.</h3><p>Review every extracted detail. Uncertain fields stay highlighted, and source evidence stays right beside the form.</p></aside></div>
  </main>;

  return <main className="page organizer-wrap">
    <div className="organizer-intro"><div><div className="eyebrow">Organizer desk · Private workspace</div><h1 style={{ fontSize: 'clamp(38px,6vw,66px)' }}>Good to see you,<br />{session.organizationName}.</h1><p className="lede">Review the details, keep unknowns honest, then put the event on the map.</p></div><button className="btn btn-outline" disabled={uploading || saveBusy || publishBusy} onClick={() => void signOut()}>Sign out</button></div>
    {dataError && <ErrorNotice error={dataError} retry={() => void loadOrganizerData()} />}
    {!selected && !editEvent && <>
      {formMessage && <div className="inline-message success-message" role="status">{formMessage}</div>}
      <section className="form-panel"><h2>Start with the announcement</h2><p className="event-meta">Upload an image, paste the text, or include both. Extraction can take a few seconds.</p>
        <div className="upload-zone"><label className="field-label" htmlFor="flyer-file">Flyer image · PNG, JPEG, WebP, GIF · under 5 MB</label><input id="flyer-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          {file && <p className="event-meta">Selected: {file.name}</p>}
          <div className="field"><label htmlFor="announcement">Or paste announcement text</label><textarea id="announcement" maxLength={10000} rows={4} value={text} onChange={e => setText(e.target.value)} placeholder="Paste the event copy from your announcement…" /></div>
          <div className="field"><label htmlFor="source-link">Source link (optional)</label><input id="source-link" type="url" placeholder="https://" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} /></div>
          {uploading && <><div className="progress-track" aria-label="Reading the announcement"><span /></div><p className="event-meta" role="status">Reading the flyer and finding event details… This can take 5–15 seconds.</p></>}
          {uploadError && <div className="inline-message" role="alert">{uploadError}</div>}
          <button className="btn btn-primary" onClick={() => void upload()} disabled={uploading}>{uploading ? 'Reading…' : 'Create review draft'}</button>
        </div>
      </section>
      <section className="form-panel"><div className="section-head" style={{ marginTop: 0 }}><h2>Your drafts</h2><button className="btn btn-outline" onClick={() => void loadOrganizerData()}>Refresh</button></div>
        {loadingData ? <LoadingList count={2} /> : drafts.length === 0 ? <EmptyState title="No drafts waiting">Create one from a flyer or announcement to start a review.</EmptyState> :
          <div className="table-list">{drafts.map(draft => <div className="draft-row" key={draft.id}><div><h3>{draft.draft.title || 'Untitled event'}</h3><div className="event-meta">{draft.organizationName} · Updated {dateLabel(draft.updatedAt)} · {draft.extractedBy === 'model' ? 'Flyer read' : 'Manual entry'}</div></div><button className="btn btn-quiet" onClick={() => { setSelected(draft); setFormMessage(''); setMissing([]); }}>Review</button></div>)}</div>}
      </section>
      <section className="form-panel"><div className="section-head" style={{ marginTop: 0 }}><h2>Your events</h2><span className="muted">{events.length} total</span></div>
        {loadingData ? <LoadingList count={2} /> : events.length === 0 ? <EmptyState title="Nothing published yet">After review and publish, your events will appear here.</EmptyState> :
          <div className="table-list">{events.map(event => <div className="draft-row" key={event.id}><div><h3>{event.title}</h3><div className="event-meta">{dateLabel(event.startsAt)} · {unknown(event.location)}</div></div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, justifyContent: 'flex-end' }}><span className={`badge ${event.status === 'cancelled' ? 'cancelled' : 'confirmed'}`}>{event.status}</span><button className="btn btn-outline" onClick={() => { setEditEvent(event); setFormMessage(''); }}>Edit</button><button className={`btn ${event.status === 'cancelled' ? 'btn-quiet' : 'btn-danger'}`} onClick={() => void cancelEvent(event)}>{event.status === 'cancelled' ? 'Restore' : 'Cancel'}</button></div></div>)}</div>}
      </section>
    </>}
    {selected && <section><div className="section-head"><div><div className="eyebrow">Draft review · {selected.extractedBy === 'model' ? 'Extracted from flyer' : 'Manual entry'}</div><h2>Check every detail.</h2></div><button className="btn btn-outline" onClick={() => { setSelected(null); setFormMessage(''); }}>Back to workspace</button></div>
      {selected.flyerUrl && <div className="source-card"><h3>Original flyer</h3><img className="flyer" src={selected.flyerUrl} alt={`Flyer for ${selected.draft.title || 'draft event'}`} /></div>}
      <ReviewForm key={selected.id} initial={selected.draft} onSave={saveDraft} onPublish={publishDraft} saving={saveBusy} publishing={publishBusy} message={formMessage} missing={missing} mode="draft" />
    </section>}
    {editEvent && <section><div className="section-head"><div><div className="eyebrow">Published event · {editEvent.status}</div><h2>Edit event details.</h2></div><button className="btn btn-outline" onClick={() => { setEditEvent(null); setFormMessage(''); }}>Back to workspace</button></div>
      <ReviewForm key={editEvent.id} initial={editEvent} onSave={saveEvent} saving={saveBusy} publishing={false} message={formMessage} missing={missing} mode="event" />
    </section>}
  </main>;
}
