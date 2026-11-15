import { useEffect, useState, type FormEvent } from 'react';
import type { EventRecord } from './api';
import { api, ApiError } from './api';
import type { FeedbackSummary, OrganizerFeedbackResponse } from '../../shared/api';
import { ErrorNotice } from './common';
import { readBrowserValue } from './storage';

const DEVICE_KEY = 'signalsc-device';
const SUBMITTED_KEY = 'signalsc-feedback-submitted';

function makeDeviceKey() {
  return window.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function savedSubmittedEvents(): string[] {
  const raw = readBrowserValue('feedback-submitted');
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch { return []; }
}

function countLabel(count: number) {
  return `${count} ${count === 1 ? 'person' : 'people'} left feedback`;
}

export function FeedbackForm({ event }: { event: EventRecord }) {
  const [started, setStarted] = useState(() => !!event.startsAt && Date.parse(event.startsAt) <= Date.now());
  const [deviceKey, setDeviceKey] = useState('');
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [wouldReturn, setWouldReturn] = useState<boolean | null>(null);
  const [comment, setComment] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [countError, setCountError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!event.startsAt) { setStarted(false); return; }
    const delay = Date.parse(event.startsAt) - Date.now();
    if (delay <= 0) { setStarted(true); return; }
    setStarted(false);
    const timer = window.setTimeout(() => setStarted(true), Math.min(delay + 20, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [event.startsAt]);

  useEffect(() => {
    if (!started) return;
    try {
      let key = readBrowserValue('device');
      if (!key || key.length < 8 || key.length > 64) {
        key = makeDeviceKey();
        localStorage.setItem(DEVICE_KEY, key);
      }
      setDeviceKey(key);
      setSubmitted(savedSubmittedEvents().includes(event.id));
    } catch {
      setStorageUnavailable(true);
    }
    let active = true;
    api.feedbackCount(event.id).then(result => { if (active) setCount(result.count); })
      .catch(e => { if (active) setCountError(e instanceof Error ? e.message : 'Feedback count could not be loaded.'); });
    return () => { active = false; };
  }, [event.id, started]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (rating === null || !deviceKey || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await api.submitFeedback(event.id, { rating, wouldReturn, comment: comment.trim(), deviceKey });
      setSubmitted(true);
      setMessage('Thanks, your feedback was sent to the organizer.');
      try {
        const ids = savedSubmittedEvents();
        localStorage.setItem(SUBMITTED_KEY, JSON.stringify([...new Set([...ids, event.id])]));
      } catch {
        setMessage('Thanks, your feedback was sent. Browser storage is needed to remember it on this device.');
      }
      api.feedbackCount(event.id).then(updated => setCount(updated.count))
        .catch(e => setCountError(e instanceof Error ? e.message : 'Feedback count could not be loaded.'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        try {
          const ids = savedSubmittedEvents();
          localStorage.setItem(SUBMITTED_KEY, JSON.stringify([...new Set([...ids, event.id])]));
        } catch { setStorageUnavailable(true); }
        setSubmitted(true);
        setMessage('You already left feedback for this event.');
      } else setError(e instanceof Error ? e.message : 'Feedback could not be sent.');
    } finally { setBusy(false); }
  }

  if (!started) return null;
  return <section className="detail-section feedback-section">
    <h2>Feedback</h2>
    {count !== null && <p className="event-meta" role="status">{countLabel(count)}</p>}
    {countError && <div className="inline-message" role="alert">{countError}</div>}
    {submitted ? <p className="inline-message success-message" role="status">{message || 'Thanks, your feedback was sent to the organizer.'}</p> :
      storageUnavailable ? <div className="inline-message" role="alert">Feedback needs browser storage enabled.</div> :
        <form className="feedback-form" onSubmit={e => void submit(e)}>
          <fieldset className="feedback-fieldset">
            <legend>How would you rate this event? *</legend>
            <div className="feedback-rating">
              {[1, 2, 3, 4, 5].map(value => <button key={value} type="button" className={`btn ${rating === value ? 'btn-primary' : 'btn-outline'}`}
                aria-label={`${value} out of 5`} aria-pressed={rating === value} onClick={() => setRating(value)}>{value}</button>)}
            </div>
          </fieldset>
          <fieldset className="feedback-fieldset">
            <legend>Would you come again?</legend>
            <div className="feedback-choices">
              <button type="button" className={`btn ${wouldReturn === true ? 'btn-primary' : 'btn-outline'}`} aria-pressed={wouldReturn === true} onClick={() => setWouldReturn(true)}>Yes</button>
              <button type="button" className={`btn ${wouldReturn === false ? 'btn-primary' : 'btn-outline'}`} aria-pressed={wouldReturn === false} onClick={() => setWouldReturn(false)}>No</button>
              <button type="button" className={`btn ${wouldReturn === null ? 'btn-primary' : 'btn-outline'}`} aria-pressed={wouldReturn === null} onClick={() => setWouldReturn(null)}>Skip</button>
            </div>
          </fieldset>
          <label className="feedback-label" htmlFor={`feedback-comment-${event.id}`}>Comment (optional)</label>
          <textarea id={`feedback-comment-${event.id}`} maxLength={1000} rows={4} value={comment} onChange={e => setComment(e.target.value)} placeholder="Share what stood out…" />
          {error && <div className="inline-message" role="alert">{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={rating === null || busy}>{busy ? 'Sending…' : 'Send feedback'}</button>
          <p className="event-meta">Feedback is only visible to the organizer.</p>
        </form>}
  </section>;
}

function FeedbackQuoteList({ title, items }: { title: string; items: { point: string; quote: string }[] }) {
  return <section className="feedback-summary-section">
    <h4>{title}</h4>
    {items.length ? <ul>{items.map((item, index) => <li key={`${item.quote}-${index}`}><p>{item.point}</p><blockquote>“{item.quote}”</blockquote></li>)}</ul> : <p className="event-meta">No supported points to show.</p>}
  </section>;
}

function FeedbackSummaryView({ summary }: { summary: FeedbackSummary }) {
  return <div className="feedback-summary">
    {summary.overall && <p>{summary.overall}</p>}
    {summary.note && <p className="inline-message">{summary.note}</p>}
    <div className="feedback-stats">
      <p><strong>Average rating:</strong> {summary.averageRating}/5</p>
      <p><strong>Would return:</strong> {summary.wouldReturnYes} yes · {summary.wouldReturnNo} no · {summary.wouldReturnUnknown} not answered</p>
      <p><strong>Ratings:</strong> {([1, 2, 3, 4, 5] as const).map(value => `${value}: ${summary.ratingCounts[String(value) as keyof typeof summary.ratingCounts]}`).join(' · ')}</p>
    </div>
    <FeedbackQuoteList title="What went well" items={summary.wentWell} />
    <FeedbackQuoteList title="What could improve" items={summary.toImprove} />
    <FeedbackQuoteList title="Requests" items={summary.requests} />
  </div>;
}

export function FeedbackPanel({ event }: { event: EventRecord }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [data, setData] = useState<OrganizerFeedbackResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.feedbackCount(event.id).then(result => { if (active) setCount(result.count); })
      .catch(() => { if (active) setCount(null); });
    return () => { active = false; };
  }, [event.id]);

  async function load() {
    setLoading(true); setError('');
    try {
      const result = await api.organizerFeedback(event.id);
      setData(result); setCount(result.responses.length);
    } catch (e) { setError(e instanceof Error ? e.message : 'Feedback could not be loaded.'); }
    finally { setLoading(false); }
  }

  async function summarize() {
    setSummarizing(true); setError('');
    try {
      const summary = await api.summarizeFeedback(event.id);
      setData(current => ({ responses: current?.responses ?? [], summary }));
      setCount(summary.responseCount);
    } catch (e) { setError(e instanceof Error ? e.message : 'Feedback summary could not be created.'); }
    finally { setSummarizing(false); }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !data && !loading) void load();
  }

  return <div className="feedback-panel">
    <button type="button" className="btn btn-outline" aria-expanded={open} aria-controls={`feedback-panel-${event.id}`} onClick={toggle}>
      Feedback{count === null ? '' : ` (${count})`}
    </button>
    {open && <div className="feedback-panel-content" id={`feedback-panel-${event.id}`}>
      {loading ? <div className="inline-message" role="status">Loading feedback…</div> : error && !data ? <ErrorNotice error={error} retry={() => void load()} /> :
        data && <>
          <div className="feedback-responses">
            {data.responses.length ? data.responses.map((response, index) => <article className="feedback-response" key={`${response.createdAt}-${index}`}>
              <div className="feedback-response-meta"><strong>{response.rating}/5</strong><span>{response.wouldReturn === null ? 'Would return: not answered' : `Would return: ${response.wouldReturn ? 'yes' : 'no'}`}</span>{response.demo && <span className="badge feedback-demo">demo</span>}</div>
              {response.comment && <p>{response.comment}</p>}
            </article>) : <p className="event-meta">No responses yet.</p>}
          </div>
          {error && <div className="inline-message" role="alert">{error}</div>}
          <button type="button" className="btn btn-primary" disabled={summarizing} onClick={() => void summarize()}>{summarizing ? 'Summarizing…' : 'Summarize feedback'}</button>
          {summarizing && <div className="inline-message" role="status">Summarizing feedback…</div>}
          {data.summary && <FeedbackSummaryView summary={data.summary.summary} />}
        </>}
    </div>}
  </div>;
}
