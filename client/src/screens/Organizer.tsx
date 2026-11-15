import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CreateDraftRequest, DraftRecord, DraftResponse, EventRecord, EventResponse, OrganizerSession, UpdateDraftRequest } from '../../../shared/api';
import { loginRequestSchema } from '../../../shared/api';
import { apiRequest, ApiError } from '../lib/api';
import { organizerLists, readSession, requireSessionForOrganization, saveDraft, sessionPath, sessionChangedElsewhere } from '../lib/organizer-api';
import { imagePayload, readImage, validateCreate, validateFile, FormError } from '../lib/organizer-form';
import { startResource } from '../lib/resource';
import { useResource } from '../lib/useResource';
import { useTask } from '../lib/useTask';
import { dateLabel } from '../lib/events';
import { eventHref } from '../lib/navigation';
import { EmptyState, ErrorState, LoadingState } from '../components/States';
import { OrganizerError, ReviewForm } from '../components/ReviewForm';

const channelName = 'trojan-signal-organizer-session';
// A message sender label, not an authentication token; also works on HTTP phone previews.
const sessionSender = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
function announceSessionChange() {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(channelName); channel.postMessage({ type: 'changed', source: sessionSender }); channel.close();
}

export function Organizer({ onEventsChanged }: { onEventsChanged: () => void }) {
  const [user, setUser] = useState<OrganizerSession | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [code, setCode] = useState('');
  const [errorKind, setErrorKind] = useState<'restore' | 'login' | 'logout'>('restore');
  const cancelRestore = useRef<() => void>(() => {});
  const authChanging = useRef(false);
  const task = useTask();
  const codeInput = useRef<HTMLInputElement>(null);
  const workspaceHeading = useRef<HTMLHeadingElement>(null);
  const focusAuthResult = useRef(false);
  useEffect(() => {
    if (!restoring && !task.busy && focusAuthResult.current) {
      focusAuthResult.current = false;
      (user ? workspaceHeading.current : codeInput.current)?.focus();
    }
  }, [user?.organizationId, restoring, task.busy]);
  useEffect(() => { if (error && errorKind === 'login') codeInput.current?.focus(); }, [error, errorKind]);
  const refreshSession = useCallback(() => {
    if (authChanging.current) return;
    cancelRestore.current();
    cancelRestore.current = startResource(readSession, state => {
      if (state.status === 'success') { setUser(state.data); setRestoring(false); setError(null); }
      if (state.status === 'error') {
        setRestoring(false);
        if (state.error instanceof ApiError && state.error.status === 401) { setUser(null); setError(null); setNotice('Your session ended. Sign in with your organization access code.'); }
        else { setError(state.error); setErrorKind('restore'); }
      }
    });
  }, []);
  useEffect(() => {
    refreshSession();
    const timer = window.setInterval(refreshSession, 30_000);
    window.addEventListener('focus', refreshSession);
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(channelName) : null;
    if (channel) channel.onmessage = event => {
      if (!sessionChangedElsewhere(event.data, sessionSender)) return;
      setUser(null); setRestoring(true); refreshSession();
    };
    return () => { cancelRestore.current(); clearInterval(timer); window.removeEventListener('focus', refreshSession); channel?.close(); };
  }, [refreshSession]);
  const expire = useCallback(() => { cancelRestore.current(); setUser(null); setError(null); setNotice('Your session expired or the organization changed. Sign in again.'); setRestoring(false); }, []);
  function login(e: React.FormEvent) {
    e.preventDefault();
    setErrorKind('login');
    const parsed = loginRequestSchema.safeParse({ accessCode: code });
    if (!parsed.success) { setError(new FormError('accessCode', 'Enter your organization access code.')); return; }
    cancelRestore.current(); authChanging.current = true; setError(null); setNotice(''); setErrorKind('login');
    void task.run(signal => apiRequest<OrganizerSession>(sessionPath, { method: 'POST', json: parsed.data, signal }), result => {
      authChanging.current = false; focusAuthResult.current = true; setCode(''); setUser(result); setRestoring(false); announceSessionChange();
    }, cause => { authChanging.current = false; setError(cause); });
  }
  function logout() {
    cancelRestore.current(); authChanging.current = true; focusAuthResult.current = true; setUser(null); setError(null); setNotice(''); setRestoring(false); setErrorKind('logout');
    void task.run(signal => apiRequest<void>(sessionPath, { method: 'DELETE', signal }), () => { authChanging.current = false; setNotice('Signed out.'); announceSessionChange(); }, cause => { authChanging.current = false; setError(cause); });
  }
  if (restoring) return <LoadingState message="Checking your organizer session…" />;
  return <section aria-label="Organizer workspace">
    {user ? <><div className="organizer-toolbar"><h2 ref={workspaceHeading} tabIndex={-1}>{user.organizationName}</h2><button className="button button-secondary" onClick={logout} disabled={task.busy}>Sign out</button></div>
      {Boolean(error) && <div><OrganizerError error={error} /><p>Your session could not be checked. Keep your edits here and retry when connected.</p><button className="button button-secondary" onClick={refreshSession}>Retry session check</button></div>}
      <Workspace key={user.organizationId} user={user} onExpired={expire} onEventsChanged={onEventsChanged} />
    </> : <section className="panel"><h2>Organizer sign-in</h2><p>Use the access code provided to your organization to review and publish events.</p>
      {notice && <p role="status">{notice}</p>}{Boolean(error) && <div id="login-error"><OrganizerError error={error} /></div>}
      {Boolean(error) && errorKind !== 'login' && <button className="button button-secondary" onClick={errorKind === 'logout' ? logout : refreshSession} disabled={task.busy}>{errorKind === 'logout' ? 'Retry sign-out' : 'Retry session check'}</button>}
      <form onSubmit={login} aria-busy={task.busy}><label htmlFor="access-code">Organization access code</label><input ref={codeInput} aria-invalid={Boolean(error) && errorKind === 'login' || undefined} aria-describedby={error && errorKind === 'login' ? 'login-error' : undefined} id="access-code" name="accessCode" type="password" autoComplete="off" maxLength={200} value={code} onChange={e => setCode(e.target.value)} disabled={task.busy} required />
        <button className="button" type="submit" disabled={task.busy}>{task.busy ? 'Please wait…' : 'Sign in'}</button></form>
    </section>}
  </section>;
}

function Workspace({ user, onExpired, onEventsChanged }: { user: OrganizerSession; onExpired: () => void; onEventsChanged: () => void }) {
  const task = useTask();
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<React.ReactNode>(null);
  const [selected, setSelected] = useState<{ record: DraftRecord | EventRecord; text?: string } | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [uploadKey, setUploadKey] = useState(0);
  const [activity, setActivity] = useState<'create' | 'save' | 'cancel' | null>(null);
  const reviewAnchor = useRef<HTMLDivElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const reviewOpener = useRef<HTMLElement | null>(null);
  const cancelOpener = useRef<HTMLElement | null>(null);
  const cancelCompleted = useRef(false);
  const errorSummary = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error && activity !== 'save') errorSummary.current?.focus(); }, [error]);
  const hadReview = useRef(false);
  const hadCancel = useRef(false);
  const guard = useCallback((signal: AbortSignal) => requireSessionForOrganization(user.organizationId, signal, onExpired), [user.organizationId, onExpired]);
  const load = useCallback(async (signal: AbortSignal) => { await guard(signal); return organizerLists(signal); }, [guard]);
  const { state, retry } = useResource(load);
  useEffect(() => { if (state.status === 'error' && state.error instanceof ApiError && state.error.status === 401) onExpired(); }, [state, onExpired]);
  function fail(cause: unknown) { if (cause instanceof ApiError && cause.status === 401) onExpired(); else setError(cause); }
  function select(record: DraftRecord | EventRecord, text?: string) { setError(null); setNotice(null); if (!selected) reviewOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setSelected({ record, text }); }
  useEffect(() => {
    if (selected) {
      reviewAnchor.current?.scrollIntoView({ block: 'start' });
      reviewAnchor.current?.querySelector<HTMLElement>('#review-heading')?.focus({ preventScroll: true });
    } else if (hadReview.current) {
      (reviewOpener.current?.isConnected && !reviewOpener.current.closest(':disabled') ? reviewOpener.current : listHeading.current)?.focus();
    }
    hadReview.current = Boolean(selected);
  }, [selected?.record.id]);
  useEffect(() => {
    if (!cancelId && hadCancel.current) {
      (cancelCompleted.current ? listHeading.current : cancelOpener.current?.isConnected ? cancelOpener.current : listHeading.current)?.focus();
      cancelCompleted.current = false;
    }
    hadCancel.current = Boolean(cancelId);
  }, [cancelId]);
  function create(file: File | null, text: string, sourceUrl: string) {
    setError(null); setNotice(null); setActivity('create');
    void task.run(async signal => {
      if (file) validateFile(file);
      // Validate text/URL limits before reading a potentially large image.
      if (text.length > 10000) throw new FormError('announcement', 'Announcement text must be 10,000 characters or fewer.');
      if (sourceUrl && !/^https?:\/\//i.test(sourceUrl.trim())) throw new FormError('sourceUrl', 'Use a full http or https source URL.');
      const image = file ? imagePayload(await readImage(file, signal), file.type) : {};
      const input: CreateDraftRequest = validateCreate({ ...image, ...(text.trim() ? { text } : {}), ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}) });
      await guard(signal);
      return apiRequest<DraftResponse>('/api/organizer/drafts', { method: 'POST', json: input, signal });
    }, result => { select(result.draft, text); setUploadKey(k => k + 1); retry(); }, fail);
  }
  function save(patch: UpdateDraftRequest, publish: boolean) {
    if (!selected) return;
    const record = selected.record;
    setError(null); setNotice(null); setActivity('save');
    void task.run(async signal => {
      await guard(signal);
      if (record.status === 'draft') return saveDraft(record.id, patch, publish, signal);
      return apiRequest<EventResponse>(`/api/organizer/events/${encodeURIComponent(record.id)}`, { method: 'PATCH', json: patch, signal });
    }, result => {
      if ('draft' in result) { setSelected(current => current ? { ...current, record: result.draft } : null); setNotice('Draft saved.'); }
      else {
        reviewOpener.current = null; // List refresh replaces the original control.
        setSelected(null); setNotice(<>{publish ? 'Event published.' : 'Event updated.'} <a href={eventHref(result.event.id)}>View event</a></>); onEventsChanged();
      }
      retry();
    }, fail);
  }
  function cancel(id: string) {
    setError(null); setActivity('cancel');
    void task.run(async signal => { await guard(signal); return apiRequest<EventResponse>(`/api/organizer/events/${encodeURIComponent(id)}`, { method: 'PATCH', json: { cancelled: true }, signal }); }, () => {
      cancelCompleted.current = true; setCancelId(null); if (selected?.record.id === id) { reviewOpener.current = null; setSelected(null); } setNotice('Event cancelled.'); retry(); onEventsChanged();
    }, fail);
  }
  return <>
    {notice && <p role="status" className="notice">{notice}</p>}
    {Boolean(error) && activity !== 'save' && <div ref={errorSummary} id="workspace-error" tabIndex={-1}><OrganizerError error={error} /></div>}
    <CreateDraft error={activity === 'create' ? error : null} key={uploadKey} busy={task.busy} creating={activity === 'create'} onCreate={create} />
    <div ref={reviewAnchor} tabIndex={-1}>{selected && <ReviewForm key={selected.record.id} record={selected.record} originalText={selected.text} busy={task.busy} error={activity === 'save' ? error : null} onSave={save} onClose={() => { setSelected(null); setError(null); }} />}</div>
    <section className="panel"><div className="section-heading"><h2 ref={listHeading} tabIndex={-1}>Drafts and my events</h2><button className="button button-secondary" onClick={retry} disabled={task.busy}>Refresh lists</button></div>
      {state.status === 'loading' && <LoadingState message="Loading your organization’s records…" />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={retry} />}
      {state.status === 'success' && <><h3 className="list-heading">Private drafts</h3>{state.data.drafts.length === 0 ? <EmptyState title="No private drafts">Create a draft above to get started.</EmptyState> : <ul className="organizer-list">{state.data.drafts.map(record => <li key={record.id}><strong>{record.draft.title || 'Untitled draft'}</strong><span>Updated {dateLabel(record.updatedAt)}</span><button className="button button-secondary" disabled={task.busy} onClick={() => select(record)}>Review draft <span className="sr-only">{record.draft.title || record.id}</span></button></li>)}</ul>}
        <h3 className="list-heading">My events</h3>{state.data.events.length === 0 ? <EmptyState title="No published events">Published events and cancelled listings will appear here.</EmptyState> : <ul className="organizer-list">{state.data.events.map(record => <li key={record.id}>
          <a href={eventHref(record.id)}>{record.title}</a><strong>{record.status === 'cancelled' ? 'Cancelled' : 'Published'}</strong><span>{dateLabel(record.startsAt)}</span>
          <div className="event-actions"><button className="button button-secondary" disabled={task.busy} onClick={() => select(record)}>Edit <span className="sr-only">{record.title}</span></button>
            {record.status !== 'cancelled' && <button className="button button-secondary" disabled={task.busy} onClick={event => { cancelOpener.current = event.currentTarget; setCancelId(record.id); }}>Cancel event <span className="sr-only">{record.title}</span></button>}</div>
          {cancelId === record.id && <CancelConfirmation title={record.title} busy={task.busy} onConfirm={() => cancel(record.id)} onDismiss={() => setCancelId(null)} />}
        </li>)}</ul>}</>}
    </section>
  </>;
}

function CreateDraft({ busy, creating, error, onCreate }: { error: unknown; busy: boolean; creating: boolean; onCreate: (file: File | null, text: string, url: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState(''); const [url, setUrl] = useState('');
  return <section className="panel"><h2>Create an event draft</h2><p>Upload a flyer, paste an announcement, or provide both. Review the extracted details before publishing.</p>
    <form onSubmit={e => { e.preventDefault(); onCreate(file, text, url); }} aria-busy={busy} aria-describedby={error ? 'workspace-error' : undefined}><fieldset disabled={busy}><legend className="sr-only">Flyer or announcement</legend>
      <label htmlFor="flyer">Flyer image (PNG, JPEG, WebP, GIF; up to 5 MB)</label><input type="file" id="flyer" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e => setFile(e.target.files?.[0] ?? null)} />
      <label htmlFor="announcement">Announcement text</label><textarea id="announcement" rows={5} maxLength={10000} value={text} onChange={e => setText(e.target.value)} />
      <label htmlFor="announcement-source">Original source URL (optional)</label><input id="announcement-source" type="url" value={url} onChange={e => setUrl(e.target.value)} />
      <button className="button" type="submit">Create draft</button></fieldset>
      {busy && creating && <p role="status">Reading your announcement. Flyer extraction can take 5–15 seconds; keep this page open.</p>}
    </form>
  </section>;
}

/** Inline confirmation: keep normal tab order; Escape dismisses without changing data. */
function CancelConfirmation({ title, busy, onConfirm, onDismiss }: { title: string; busy: boolean; onConfirm: () => void; onDismiss: () => void }) {
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => { keep.current?.focus(); }, []);
  return <div className="cancel-confirmation" role="group" aria-label={`Confirm cancellation of ${title}`} aria-busy={busy} onKeyDown={event => {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); onDismiss(); }
  }}><p>Cancel this event? Students will see that it has been cancelled.</p>
    <button className="button" disabled={busy} onClick={onConfirm}>Confirm cancellation</button>
    <button ref={keep} className="button button-secondary" disabled={busy} onClick={onDismiss}>Keep event</button>
    {busy && <p role="status">Cancelling event…</p>}
  </div>;
}
