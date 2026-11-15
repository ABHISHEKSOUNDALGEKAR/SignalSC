import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { EventRecord, SearchResponse } from './api';
import { api, ApiError } from './api';
import { Confirmation, dateGroups, dateLabel, EmptyState, ErrorNotice, EventCard, LoadingList, locationLabel, money, unknown } from './common';
import { campusRange as dateQuery } from './time';

export function AskPage() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function ask(next = query) {
    if (!next.trim() || loading) return;
    setQuery(next);
    setLoading(true);
    setError('');
    setResult(null);
    try { setResult(await api.search(next.trim())); }
    catch (e) { setError(e instanceof Error ? e.message : 'Search could not be completed.'); }
    finally { setLoading(false); }
  }
  const prompts = ['Free food this week', 'Something after 5 near campus', 'Beginner-friendly events', 'What can I do today?'];
  // One short spoken summary per search, so screen readers hear the outcome without the whole list being read out.
  const announcement = loading ? 'Searching for events…'
    : result ? `${result.answer} ${result.noMatch || result.results.length === 0 ? 'No events matched.' : result.results.length === 1 ? '1 event found.' : `${result.results.length} events found.`}`
      : '';
  return <main id="main-content" tabIndex={-1} className="page">
    <section className="hero">
      <div className="eyebrow">Trojan Signal · Find your people</div>
      <h1>Ask what’s<br />happening.</h1>
      <p className="lede">A campus plan is better when you know what’s confirmed. Search in your own words; details stay linked to their source.</p>
      <div className="hero-rule" />
    </section>
    <div className="content-grid">
      <div className="primary-column">
        <form className="ask-box" aria-busy={loading} onSubmit={e => { e.preventDefault(); void ask(); }}>
          <textarea aria-label="Ask about campus events" aria-describedby="ask-hint" enterKeyHint="search" maxLength={500} placeholder="Try “free food near campus after class…”" value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              // Enter searches; Shift+Enter keeps the usual new line. Ignore Enter while an input method is composing text.
              if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
              e.preventDefault();
              void ask();
            }} />
          <button className="btn btn-primary" type="submit" disabled={loading || !query.trim()}>{loading ? 'Looking…' : 'Find events'} <span aria-hidden="true">↗</span></button>
        </form>
        <p className="ask-hint" id="ask-hint">Press Enter to search · Shift+Enter for a new line</p>
        <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
        {!result && !loading && <div className="prompt-row">{prompts.map(prompt => <button key={prompt} type="button" className="prompt-chip" onClick={() => void ask(prompt)}>{prompt}</button>)}</div>}
        {loading && <><div className="answer-panel">Reading the dates, details, and constraints in your question…</div><LoadingList count={2} /></>}
        {error && <ErrorNotice error={error} retry={() => void ask()} />}
        {result && <>
          <div className="answer-panel">{result.answer}</div>
          {result.constraintSummary.length > 0 && <div className="chip-row">{result.constraintSummary.map((chip, index) => <span className="constraint-chip" key={`${chip}-${index}`}>{chip}</span>)}</div>}
          <div className="section-head"><h2>{result.noMatch ? 'No events matched' : 'Worth a look'}</h2><span className="muted">{result.results.length} found</span></div>
          {result.noMatch ? <p className="lede">No events fit all of those details right now. The answer above explains what we understood; try easing one constraint or check Discover.</p> :
            result.results.length === 0 ? <EmptyState title="No matching events">Try a broader question or explore all upcoming events in Discover.</EmptyState> :
              <div className="results-list">{result.results.map(({ event, reason }) => <EventCard key={event.id} event={event} href={`#/event/${encodeURIComponent(event.id)}`} reason={reason} />)}</div>}
          {result.excluded.length > 0 && <section className="detail-section"><h3>Left out of these results</h3>{result.excluded.map((item, i) => <p className="event-meta" key={`${item.reason}-${i}`}>{item.reason}{item.count > 1 ? ` · ${item.count} events` : ''}</p>)}</section>}
        </>}
      </div>
      <aside className="side-note"><div className="mini-star">✦</div><h3>Trust the details.</h3><p>We keep “unknown” visible instead of guessing. Every event can lead you back to its source or flyer.</p></aside>
    </div>
  </main>;
}

export function DiscoverPage() {
  const latestRequest = useRef(0);
  const [today, setToday] = useState(false);
  const [week, setWeek] = useState(false);
  const [free, setFree] = useState(false);
  const [food, setFood] = useState(false);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reload = () => {
    const requestId = ++latestRequest.current;
    setLoading(true); setError('');
    const params: string[] = [];
    if (today) params.push(dateQuery('today'));
    else if (week) params.push(dateQuery('week'));
    if (free) params.push('free=1');
    if (food) params.push('food=1');
    api.events(params.join('&')).then(data => { if (requestId === latestRequest.current) setEvents(data.events); })
      .catch(e => { if (requestId === latestRequest.current) setError(e instanceof Error ? e.message : 'Could not load events.'); })
      .finally(() => { if (requestId === latestRequest.current) setLoading(false); });
  };
  useEffect(reload, [today, week, free, food]);
  const grouped = dateGroups(events);
  return <main id="main-content" tabIndex={-1} className="page">
    <section className="hero"><div className="eyebrow">Around University Park</div><h1>Make room<br />for a good plan.</h1><p className="lede">Student-run, campus-connected, and clear about what’s known. Browse what’s coming up in Los Angeles.</p><div className="hero-rule" /></section>
    <div className="filters" aria-label="Filter events">
      <button className={`filter-chip ${today ? 'selected' : ''}`} aria-pressed={today} onClick={() => { setToday(!today); if (!today) setWeek(false); }}>LA Today</button>
      <button className={`filter-chip ${week ? 'selected' : ''}`} aria-pressed={week} onClick={() => { setWeek(!week); if (!week) setToday(false); }}>This week</button>
      <button className={`filter-chip ${free ? 'selected' : ''}`} aria-pressed={free} onClick={() => setFree(!free)}>Free</button>
      <button className={`filter-chip ${food ? 'selected' : ''}`} aria-pressed={food} onClick={() => setFood(!food)}>Food advertised</button>
    </div>
    <div className="section-head"><h2>{today ? 'Today in LA' : week ? 'The week ahead' : 'Coming up'}</h2><span className="muted">{loading ? 'Updating…' : `${events.length} events`}</span></div>
    {error ? <ErrorNotice error={error} retry={reload} /> : loading ? <LoadingList /> : events.length === 0 ? <EmptyState title="No plans on the board yet">Try a wider date range, turn off a filter, or ask Signal for something specific.</EmptyState> :
      grouped.map(([day, items]) => <section key={day}><div className="date-block">{day}</div><div className="event-list">{items.map(event => <EventCard key={event.id} event={event} href={`#/event/${encodeURIComponent(event.id)}`} />)}</div></section>)}
  </main>;
}

export function EventDetailPage({ id }: { id: string }) {
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const reload = () => {
    setLoading(true); setError('');
    api.event(id).then(data => setEvent(data.event)).catch(e => setError(e instanceof Error ? e.message : 'Event could not be found.')).finally(() => setLoading(false));
  };
  useEffect(() => { reload(); const ids = readSaved(); setSaved(ids?.includes(id) ?? false); }, [id]);
  if (loading) return <main id="main-content" tabIndex={-1} className="page"><LoadingList count={2} /></main>;
  if (!event) return <main id="main-content" tabIndex={-1} className="page"><a className="nav-link" href="#/discover">← Discover</a><ErrorNotice error={error || 'This event is no longer available.'} retry={reload} /></main>;
  const foodText = event.food === 'advertised' ? 'Advertised' : event.food === 'not-advertised' ? 'Not advertised' : 'Not listed';
  function toggleSaved() {
    const ids = readSaved();
    if (!ids) {
      setSaveError('This browser could not save the event. Allow site storage and try again.');
      return;
    }
    const next = saved ? ids.filter(value => value !== id) : [...new Set([...ids, id])];
    try {
      localStorage.setItem('trojan-signal-saved', JSON.stringify(next)); setSaved(!saved); setSaveError('');
    } catch { setSaveError('This browser could not save the event. Allow site storage and try again.'); }
  }
  return <main id="main-content" tabIndex={-1} className="page">
    <a href="#/discover" className="nav-link" style={{ paddingLeft: 0 }}>← Back to Discover</a>
    <section className="detail-hero"><div className="eyebrow">{event.organizationName?.trim() || 'Organizer not listed'} · {event.status === 'cancelled' ? 'Notice' : 'Event details'}</div><h1>{event.title}</h1><div className="detail-meta">{dateLabel(event.startsAt, 'Time not listed')}{event.endsAt ? ` — ${dateLabel(event.endsAt)}` : ''}<br />{locationLabel(event)} · {money(event.costCents)}</div>
      <div className="detail-actions"><button className="btn btn-gold saved-label" aria-pressed={saved} onClick={toggleSaved}>{saved ? 'Saved' : 'Save event'}</button>{event.startsAt && <a className="btn btn-outline" href={`/api/events/${encodeURIComponent(event.id)}/calendar.ics`} aria-describedby={event.endsAt ? undefined : 'calendar-note'}>Add to calendar</a>}{event.registrationUrl && <a className="btn btn-outline" href={event.registrationUrl} target="_blank" rel="noreferrer">Register ↗</a>}{event.sourceUrl && <a className="btn btn-outline" href={event.sourceUrl} target="_blank" rel="noreferrer">{event.sourceKind === 'engagesc' ? 'View on EngageSC ↗' : 'View original source ↗'}</a>}</div>
      {event.startsAt && !event.endsAt && <p className="calendar-note" id="calendar-note">End time isn’t listed, so your calendar entry is set to 1 hour.</p>}
    </section>
    {saveError && <div className="inline-message" role="alert">{saveError}</div>}
    {event.status === 'cancelled' && <div className="inline-message" role="alert"><strong>This event has been cancelled.</strong> Please check the source before making plans.</div>}
    <div className="detail-layout"><div>
      <section className="detail-section"><h2>What to know</h2>{event.description.trim() ? <p className="description">{event.description}</p> : <p className="description unknown">No description listed.</p>}</section>
      <section className="detail-section"><h2>The details</h2><div className="field-grid">
        <Field label="Starts" missing={!event.startsAt}>{dateLabel(event.startsAt)}</Field><Field label="Ends" missing={!event.endsAt}>{dateLabel(event.endsAt, 'End time not listed')}</Field><Field label="Location" missing={!event.location?.trim()}>{locationLabel(event)}</Field><Field label="Cost" missing={event.costCents === null}>{money(event.costCents)}</Field>
        <Field label="Food" missing={event.food === 'unknown'}>{foodText}</Field><Field label="Who can attend" missing={!event.eligibility?.trim()}>{unknown(event.eligibility)}</Field><Field label="Beginner friendly" missing={event.beginnerFriendly === null}>{event.beginnerFriendly === null ? 'Not listed' : event.beginnerFriendly ? 'Yes' : 'No'}</Field>
        <Field label="Registration link" missing={!event.registrationUrl}>{event.registrationUrl ? <a className="source-link" href={event.registrationUrl} target="_blank" rel="noreferrer">Open registration ↗</a> : 'Not listed'}</Field>
        <Field label="Registration deadline" missing={!event.registrationDeadline}>{dateLabel(event.registrationDeadline)}</Field><Field label="Timezone">{event.timezone}</Field><Field label="Source type">{event.sourceKind === 'engagesc' ? 'EngageSC calendar' : event.sourceKind === 'usc-calendar' ? 'USC calendar' : 'Flyer'}</Field>
      </div></section>
      <section className="detail-section"><h2>Confirmation</h2><Confirmation event={event} /><p className="event-meta" style={{ marginTop: 12 }}>Updated {dateLabel(event.updatedAt)} · Published {dateLabel(event.publishedAt)}</p></section>
      {event.evidence.length > 0 && <section className="detail-section"><h2>Evidence from the source</h2>{event.evidence.map((entry, i) => <div className="evidence" key={`${entry.field}-${i}`}><b>{entry.field}</b>“{entry.excerpt}”</div>)}</section>}
      {event.uncertainties.length > 0 && <section className="detail-section"><h2>Still to confirm</h2>{event.uncertainties.map((item, i) => <p className="event-meta" key={`${item}-${i}`}>• {item}</p>)}</section>}
    </div><aside className="detail-aside">
      <div className="registration-card"><h3>Go to the source.</h3><p className="event-meta">Check the original announcement for the latest details.</p>{event.sourceUrl ? <a className="source-link" href={event.sourceUrl} target="_blank" rel="noreferrer">Open source ↗</a> : <span className="unknown">Source link not listed</span>}</div>
      <div className="source-card"><h3>Flyer</h3>{event.flyerUrl ? <img className="flyer" src={event.flyerUrl} alt={`Original flyer for ${event.title}`} /> : <p className="event-meta unknown">No original image attached.</p>}</div>
    </aside></div>
  </main>;
}
function Field({ label, children, missing = false }: { label: string; children: ReactNode; missing?: boolean }) {
  return <div><span className="field-label">{label}</span><div className={missing ? 'field-value unknown' : 'field-value'}>{children}</div></div>;
}
function readSaved(): string[] | null {
  try {
    const stored = localStorage.getItem('trojan-signal-saved');
    if (stored === null) return [];
    const value: unknown = JSON.parse(stored);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : null;
  } catch { return null; }
}
export function SavedPage() {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const reload = async () => {
    setLoading(true); setError(''); setStorageUnavailable(false);
    const ids = readSaved();
    if (!ids) {
      setEvents([]); setMissing([]); setStorageUnavailable(true); setLoading(false);
      return;
    }
    const found: EventRecord[] = [];
    const absent: string[] = [];
    await Promise.all(ids.map(async id => {
      try { found.push((await api.event(id)).event); }
      catch (e) { if (e instanceof ApiError && e.status === 404) absent.push(id); else setError(e instanceof Error ? e.message : 'Saved events could not load.'); }
    }));
    setEvents(found); setMissing(absent); setLoading(false);
  };
  useEffect(() => { void reload(); }, []);
  return <main id="main-content" tabIndex={-1} className="page"><section className="hero"><div className="eyebrow">Your list, on this device</div><h1>Keep the plans<br />you like.</h1><p className="lede">Saved events are stored in this browser and refreshed from the event source every time you visit.</p><div className="hero-rule" /></section>
    {error && <ErrorNotice error={error} retry={() => void reload()} />}
    {storageUnavailable && <div className="inline-message" role="alert">This browser could not read your saved events. Allow site storage in your browser settings and try again.</div>}
    {loading ? <LoadingList /> : storageUnavailable ? null : events.length === 0 && missing.length === 0 ? <EmptyState title="Nothing saved just yet">Save an event you want to remember and it’ll be waiting here.</EmptyState> :
      <div className="event-list">{events.map(event => <EventCard key={event.id} event={event} href={`#/event/${encodeURIComponent(event.id)}`} />)}
        {missing.map(id => <div className="event-card" key={id}><div className="event-card-top"><div><h3 className="event-title">This event is no longer available</h3><div className="event-meta">Saved event · source unavailable</div></div><span className="badge cancelled">Unavailable</span></div><p className="event-reason">The source has removed this event or it can’t be reached right now. Its saved place is kept on this device.</p></div>)}</div>}
  </main>;
}
