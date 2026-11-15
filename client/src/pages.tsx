import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { EventRecord, SearchResponse } from './api';
import type { SearchConstraints } from '../../shared/api';
import { api, ApiError } from './api';
import { Confirmation, dateGroups, dateLabel, EmptyState, ErrorNotice, EventCard, LoadingList, locationLabel, money, unknown } from './common';
import { FeedbackForm } from './feedback';
import { readBrowserValue } from './storage';
import { campusInput, campusInstant, campusRange as dateQuery } from './time';

export function AskPage() {
  const [query, setQuery] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [validationError, setValidationError] = useState('');
  const [notice, setNotice] = useState('');
  const [editedKeywords, setEditedKeywords] = useState('');
  const [editedFrom, setEditedFrom] = useState('');
  const [editedTo, setEditedTo] = useState('');
  const [editedAfter, setEditedAfter] = useState('');
  const [editedFree, setEditedFree] = useState(false);
  const [editedFood, setEditedFood] = useState(false);
  const [editedBeginner, setEditedBeginner] = useState(false);
  const latestRequest = useRef(0);
  const sessionActive = useRef(false);
  const lastAction = useRef<{ action: () => Promise<SearchResponse>; mode: 'independent' | 'refine' | 'filters' } | null>(null);

  function loadEditor(constraints: SearchConstraints) {
    setEditedKeywords(constraints.keywords.join(', '));
    setEditedFrom(campusInput(constraints.from));
    setEditedTo(campusInput(constraints.to));
    setEditedAfter(constraints.afterMinutes === null ? '' : String(constraints.afterMinutes));
    setEditedFree(constraints.freeOnly);
    setEditedFood(constraints.foodAdvertisedOnly);
    setEditedBeginner(constraints.beginnerOnly);
  }
  async function run(action: () => Promise<SearchResponse>, mode: 'independent' | 'refine' | 'filters') {
    const requestId = ++latestRequest.current;
    setLoading(true);
    setError('');
    setValidationError('');
    setNotice('');
    lastAction.current = { action, mode };
    try {
      const response = await action();
      if (requestId !== latestRequest.current) return;
      if (mode !== 'independent' && response.refinementApplied === false) {
        setNotice(response.answer);
        return;
      }
      setResult(response);
      sessionActive.current = true;
      setFollowUp('');
      loadEditor(response.constraints);
    } catch (e) {
      if (requestId === latestRequest.current) setError(e instanceof Error ? e.message : 'Search could not be completed.');
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }
  async function ask(next = query) {
    if (!next.trim() || loading) return;
    setQuery(next);
    const text = next.trim();
    void run(() => api.search(text), 'independent');
  }
  function refine() {
    if (!result || !sessionActive.current || !followUp.trim() || loading) return;
    const text = followUp.trim();
    const context = result.constraints;
    void run(() => api.search(text, { context }), 'refine');
  }
  function applyFilters() {
    if (!result || !sessionActive.current || loading) return;
    setValidationError('');
    try {
      if (!editedFrom || !editedTo) throw new Error('Choose both a start and an exclusive end date and time.');
      const from = campusInstant(editedFrom);
      const to = campusInstant(editedTo);
      if (!from || !to) throw new Error('Enter valid Los Angeles start and end dates.');
      if (Date.parse(to) <= Date.parse(from) || Date.parse(to) - Date.parse(from) > 120 * 86_400_000) {
        throw new Error('Choose an end after the start, within 120 days.');
      }
      const afterMinutes = editedAfter.trim() === '' ? null : Number(editedAfter);
      if (afterMinutes !== null && (!Number.isInteger(afterMinutes) || afterMinutes < 0 || afterMinutes > 1439)) {
        throw new Error('Enter an earliest time between 12:00 AM and 11:59 PM.');
      }
      const constraints: SearchConstraints = {
        keywords: editedKeywords.split(',').map(word => word.trim()).filter(Boolean),
        from, to, afterMinutes, freeOnly: editedFree, foodAdvertisedOnly: editedFood, beginnerOnly: editedBeginner,
      };
      setError('');
      void run(() => api.search('', { constraints }), 'filters');
    } catch (e) {
      setValidationError(e instanceof Error ? e.message : 'Check the filter values and try again.');
    }
  }
  function startNewSearch() {
    latestRequest.current++;
    sessionActive.current = false;
    lastAction.current = null;
    setQuery('');
    setFollowUp('');
    setResult(null);
    setLoading(false);
    setError('');
    setValidationError('');
    setNotice('');
  }
  const prompts = ['Free food this week', 'Something after 5 near campus', 'Beginner-friendly events', 'What can I do today?'];
  // One short spoken summary per search, so screen readers hear the outcome without the whole list being read out.
  const announcement = loading ? 'Searching for events…'
    : result ? `${result.answer} ${result.results.length} exact matches and ${result.relatedResults?.length ?? 0} related suggestions.`
      : '';
  return <main id="main-content" tabIndex={-1} className="page">
    <section className="hero">
      <div className="eyebrow">SignalSC · Find your people</div>
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
        {(result || loading) && <div className="ask-session-actions">
          <span className="session-label">{result ? 'Current search · held in this page only' : 'Search in progress'}</span>
          <button className="btn btn-outline" type="button" onClick={startNewSearch}>Start new search</button>
        </div>}
        <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
        {!result && !loading && <div className="prompt-row">{prompts.map(prompt => <button key={prompt} type="button" className="prompt-chip" onClick={() => void ask(prompt)}>{prompt}</button>)}</div>}
        {loading && <><div className="answer-panel">Reading the dates, details, and constraints in your question…</div><LoadingList count={2} /></>}
        {error && <ErrorNotice error={error} retry={() => {
          if (lastAction.current && !loading) void run(lastAction.current.action, lastAction.current.mode);
        }} />}
        {validationError && <p className="inline-message" role="alert">{validationError}</p>}
        {notice && <p className="inline-message" role="status">{notice}</p>}
        {result && <>
          {sessionActive.current && <section className="refine-panel" aria-label="Refine this search">
            <form onSubmit={e => { e.preventDefault(); refine(); }}>
              <label className="field-label" htmlFor="ask-follow-up">Refine this search</label>
              <div className="refine-controls">
                <input id="ask-follow-up" type="text" maxLength={500} value={followUp} onChange={e => setFollowUp(e.target.value)}
                  placeholder="Try “later in the evening” or “only the ones with food”"
                  aria-describedby="follow-up-hint" />
                <button className="btn btn-primary" type="submit" disabled={loading || !followUp.trim()}>Refine search</button>
              </div>
              <p className="ask-hint" id="follow-up-hint">This follow-up updates the current search. Try “later in the evening” or “next week instead.”</p>
            </form>
            <details className="filter-editor" open>
              <summary>Edit interpreted filters</summary>
              <p className="event-meta">Dates and times use America/Los_Angeles. The end date and time is exclusive: events at that instant are not included. A date range is required; widen it to 120 days to remove date narrowing.</p>
              <button className="btn btn-outline" type="button" onClick={() => {
                const now = Date.now();
                setEditedFrom(campusInput(new Date(now).toISOString()));
                setEditedTo(campusInput(new Date(now + 120 * 86_400_000).toISOString()));
              }}>Use widest date range (120 days)</button>
              <div className="form-grid">
                <div className="field full"><label htmlFor="filter-keywords">Topics and keywords</label><input id="filter-keywords" value={editedKeywords} onChange={e => setEditedKeywords(e.target.value)} placeholder="Separate topics with commas" /></div>
                <div className="field"><label htmlFor="filter-from">Start date and time (Los Angeles)</label><input id="filter-from" type="datetime-local" value={editedFrom} onChange={e => setEditedFrom(e.target.value)} /></div>
                <div className="field"><label htmlFor="filter-to">Exclusive end date and time (Los Angeles)</label><input id="filter-to" type="datetime-local" value={editedTo} onChange={e => setEditedTo(e.target.value)} /></div>
                <div className="field full"><label htmlFor="filter-after">Earliest time of day (optional, Los Angeles)</label><input id="filter-after" type="time" value={editedAfter === '' ? '' : `${String(Math.floor(Number(editedAfter) / 60)).padStart(2, '0')}:${String(Number(editedAfter) % 60).padStart(2, '0')}`} onChange={e => {
                  const [hour, minute] = e.target.value.split(':').map(Number);
                  setEditedAfter(e.target.value ? String(hour * 60 + minute) : '');
                }} /><p className="field-help">Clear this field to remove the earliest-time filter.</p></div>
                <div className="filter-toggle-list full" aria-label="Additional filters">
                  <label><input type="checkbox" checked={editedFree} onChange={e => setEditedFree(e.target.checked)} /> Free only</label>
                  <label><input type="checkbox" checked={editedFood} onChange={e => setEditedFood(e.target.checked)} /> Food advertised only</label>
                  <label><input type="checkbox" checked={editedBeginner} onChange={e => setEditedBeginner(e.target.checked)} /> Beginner-friendly only</label>
                </div>
              </div>
              <button className="btn btn-outline" type="button" onClick={applyFilters} disabled={loading}>Apply filters</button>
            </details>
          </section>}
          <div className="answer-panel">{result.answer}</div>
          {result.constraintSummary.length > 0 && <div className="chip-row">{result.constraintSummary.map((chip, index) => <span className="constraint-chip" key={`${chip}-${index}`}>{chip}</span>)}</div>}
          <div className="section-head"><h2>{result.noMatch ? result.relatedResults?.length ? 'Related events to explore' : 'No upcoming events found' : 'Worth a look'}</h2><span className="muted">{result.results.length ? `${result.results.length} exact matches` : `${result.relatedResults?.length ?? 0} related`}</span></div>
          {result.noMatch ? <p className="event-meta">{result.relatedResults?.length ? 'These are suggestions, not exact matches. Each card explains which details differ or still need confirming.' : 'Try a broader question or browse Discover for all published events.'}</p> :
            result.results.length === 0 ? <EmptyState title="No matching events" action={<div className="empty-actions"><a className="btn btn-outline" href="#/discover">Browse Discover</a></div>}>Try a broader question or explore all upcoming events in Discover.</EmptyState> :
              <div className="results-list">{result.results.map(({ event, reason }) => <EventCard key={event.id} event={event} href={`#/event/${encodeURIComponent(event.id)}`} reason={reason} />)}</div>}
          {!!result.relatedResults?.length && <section aria-label="Related event suggestions">
            {!result.noMatch && <div className="section-head"><h2>Related options</h2><span className="muted">Not exact matches</span></div>}
            <div className="results-list">{result.relatedResults.map(({ event, reason, differences }) => <div key={event.id}>
              <div className="chip-row">{differences?.map(note => <span className="constraint-chip" key={note}>{note}</span>)}</div>
              <EventCard event={event} href={`#/event/${encodeURIComponent(event.id)}`} reason={reason} />
            </div>)}</div>
          </section>}
          {result.noMatch && <p><a className="btn btn-outline" href="#/discover">Browse all events</a></p>}
          {result.excluded.length > 0 && <section className="detail-section"><h3>Why some events are not exact matches</h3>{result.excluded.map((item, i) => <p className="event-meta" key={`${item.reason}-${i}`}>{item.reason}{item.count > 1 ? ` · ${item.count} events` : ''}</p>)}</section>}
        </>}
      </div>
      <aside className="side-note"><div className="mini-star">✦</div><h3>Trust the details.</h3><p>We keep “unknown” visible instead of guessing. Every event can lead you back to its source or flyer.</p></aside>
    </div>
  </main>;
}

export function DiscoverPage() {
  const latestRequest = useRef(0);
  const [titleQuery, setTitleQuery] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
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
    if (activeSearch) params.push(`q=${encodeURIComponent(activeSearch)}&scope=all`);
    else if (today) params.push(dateQuery('today'));
    else if (week) params.push(dateQuery('week'));
    if (free) params.push('free=1');
    if (food) params.push('food=1');
    api.events(params.join('&')).then(data => { if (requestId === latestRequest.current) setEvents(data.events); })
      .catch(e => { if (requestId === latestRequest.current) setError(e instanceof Error ? e.message : 'Could not load events.'); })
      .finally(() => { if (requestId === latestRequest.current) setLoading(false); });
  };
  useEffect(reload, [today, week, free, food, activeSearch]);
  const isPast = (event: EventRecord) => Date.parse(event.endsAt ?? event.startsAt ?? '') < Date.now();
  const upcoming = events.filter(event => !isPast(event));
  const past = activeSearch ? events.filter(isPast).sort((a, b) => Date.parse(b.startsAt!) - Date.parse(a.startsAt!)) : [];
  const grouped = dateGroups(upcoming);
  const filtered = today || week || free || food || Boolean(activeSearch);
  const clearFilters = () => { setToday(false); setWeek(false); setFree(false); setFood(false); setTitleQuery(''); setActiveSearch(''); };
  return <main id="main-content" tabIndex={-1} className="page">
    <section className="hero"><div className="eyebrow">Around University Park</div><h1>Make room<br />for a good plan.</h1><p className="lede">Student-run, campus-connected, and clear about what’s known. Browse what’s coming up in Los Angeles.</p><div className="hero-rule" /></section>
    <form className="discover-search" role="search" aria-label="Search event titles" onSubmit={e => {
      e.preventDefault();
      const query = titleQuery.trim();
      if (query.length === 1) return;
      setToday(false); setWeek(false); setActiveSearch(query);
    }}>
      <label className="field-label" htmlFor="discover-title">Find an event by title</label>
      <div className="discover-search-controls">
        <input id="discover-title" type="search" minLength={2} maxLength={120} value={titleQuery} placeholder="Search current or past events…" aria-describedby="discover-search-hint"
          onChange={e => { setTitleQuery(e.target.value); if (!e.target.value.trim()) setActiveSearch(''); }} />
        <button className="btn btn-primary" type="submit" disabled={loading || titleQuery.trim().length === 1}>Search</button>
        {activeSearch && <button className="btn btn-outline" type="button" onClick={() => { setTitleQuery(''); setActiveSearch(''); }}>Clear search</button>}
      </div>
      <p className="ask-hint" id="discover-search-hint">Upcoming events are shown by default. Search a title to also find past events and leave feedback.</p>
    </form>
    <div className="filters" aria-label="Filter events">
      <button className={`filter-chip ${today ? 'selected' : ''}`} aria-pressed={today} onClick={() => { setToday(!today); setActiveSearch(''); setTitleQuery(''); if (!today) setWeek(false); }}>LA Today</button>
      <button className={`filter-chip ${week ? 'selected' : ''}`} aria-pressed={week} onClick={() => { setWeek(!week); setActiveSearch(''); setTitleQuery(''); if (!week) setToday(false); }}>This week</button>
      <button className={`filter-chip ${free ? 'selected' : ''}`} aria-pressed={free} onClick={() => setFree(!free)}>Free</button>
      <button className={`filter-chip ${food ? 'selected' : ''}`} aria-pressed={food} onClick={() => setFood(!food)}>Food advertised</button>
    </div>
    <div className="section-head"><h2>{activeSearch ? `Title results for “${activeSearch}”` : today ? 'Today in LA' : week ? 'The week ahead' : 'Coming up'}</h2><span className="muted" role="status">{loading ? 'Updating…' : `${upcoming.length + past.length} events`}</span></div>
    {error ? <ErrorNotice error={error} retry={reload} /> : loading ? <LoadingList /> : upcoming.length + past.length === 0 ? <EmptyState title={activeSearch ? 'No matching event titles' : 'No plans on the board yet'} action={<div className="empty-actions">{filtered && <button className="btn btn-primary" onClick={clearFilters}>Clear filters</button>}<a className="btn btn-outline" href="#/ask">Ask a question</a></div>}>{activeSearch ? 'Try fewer title keywords. Past events are searchable when they are available in the public archive.' : filtered ? 'Nothing matches these filters right now. Clear them to see everything coming up, or ask SignalSC for something specific.' : 'No upcoming events are listed right now. Check back soon, or ask SignalSC for something specific.'}</EmptyState> :
      <>
      {activeSearch && upcoming.length > 0 && <h3>Upcoming matches</h3>}
      {
      grouped.map(([day, items]) => <section key={day}><div className="date-block">{day}</div><div className="event-list">{items.map(event => <EventCard key={event.id} event={event} href={`#/event/${encodeURIComponent(event.id)}`} />)}</div></section>)}
      {past.length > 0 && <section aria-label="Past event search results"><div className="section-head"><h3>Past events · Leave feedback</h3></div>
        <p className="event-meta">Open an event to leave a rating or feedback.</p>
        <div className="event-list">{past.map(event => <div key={event.id}><span className="badge">Past event</span><EventCard event={event} href={`#/event/${encodeURIComponent(event.id)}`} /></div>)}</div>
      </section>}
      </>}
  </main>;
}

export function EventDetailPage({ id }: { id: string }) {
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const reload = () => {
    setLoading(true); setError(''); setNotFound(false);
    api.event(id).then(data => setEvent(data.event)).catch(e => {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else setError(e instanceof Error ? e.message : 'This event could not be loaded.');
    }).finally(() => setLoading(false));
  };
  useEffect(() => { reload(); const ids = readSaved(); setSaved(ids?.includes(id) ?? false); }, [id]);
  const backLink = <a href="#/discover" className="nav-link" style={{ paddingLeft: 0 }}>← Back to Discover</a>;
  if (loading) return <main id="main-content" tabIndex={-1} className="page">{backLink}<LoadingList count={2} /></main>;
  if (!event) return <main id="main-content" tabIndex={-1} className="page">{backLink}
    {notFound ? <EmptyState title="This event is no longer available" action={<div className="empty-actions"><a className="btn btn-primary" href="#/discover">Browse Discover</a><a className="btn btn-outline" href="#/saved">Your saved events</a></div>}>Its source may have removed it, or the link may be out of date.</EmptyState>
      : <ErrorNotice error={error || 'This event could not be loaded.'} retry={reload} />}
  </main>;
  const foodText = event.food === 'advertised' ? 'Advertised' : event.food === 'not-advertised' ? 'Not advertised' : 'Not listed';
  function toggleSaved() {
    const ids = readSaved();
    if (!ids) {
      setSaveError('This browser could not save the event. Allow site storage and try again.');
      return;
    }
    const next = saved ? ids.filter(value => value !== id) : [...new Set([...ids, id])];
    try {
      localStorage.setItem('signalsc-saved', JSON.stringify(next)); setSaved(!saved); setSaveError('');
    } catch { setSaveError('This browser could not save the event. Allow site storage and try again.'); }
  }
  return <main id="main-content" tabIndex={-1} className="page">
    {backLink}
    <section className="detail-hero"><div className="eyebrow">{event.organizationName?.trim() || 'Organizer not listed'} · {event.status === 'cancelled' ? 'Notice' : 'Event details'}</div><h1>{event.title}</h1><div className="detail-meta">{dateLabel(event.startsAt, 'Time not listed')}{event.endsAt ? ` — ${dateLabel(event.endsAt)}` : ''}<br />{locationLabel(event)} · {money(event.costCents)}</div>
      <div className="detail-actions"><button className="btn btn-gold saved-label" aria-pressed={saved} onClick={toggleSaved}>{saved ? 'Saved' : 'Save event'}</button>{event.startsAt && <a className="btn btn-outline" href={`/api/events/${encodeURIComponent(event.id)}/calendar.ics`} aria-describedby={event.endsAt ? undefined : 'calendar-note'}>Add to calendar</a>}{event.registrationUrl && <a className="btn btn-outline" href={event.registrationUrl} target="_blank" rel="noreferrer">Register ↗</a>}{event.sourceUrl && <a className="btn btn-outline" href={event.sourceUrl} target="_blank" rel="noreferrer">{event.sourceKind === 'engagesc' ? 'View on EngageSC ↗' : 'View original source ↗'}</a>}</div>
      {event.startsAt && !event.endsAt && <p className="calendar-note" id="calendar-note">End time isn’t listed, so your calendar entry is set to 1 hour.</p>}
    </section>
    <FeedbackForm event={event} />
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
    const stored = readBrowserValue('saved');
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
    {storageUnavailable && <ErrorNotice error="This browser could not read your saved events. Allow site storage in your browser settings and try again." retry={() => void reload()} />}
    {loading ? <LoadingList /> : storageUnavailable ? null : events.length === 0 && missing.length === 0 ? (error ? null : <EmptyState title="Nothing saved just yet" action={<div className="empty-actions"><a className="btn btn-primary" href="#/discover">Browse Discover</a></div>}>Save an event you want to remember and it’ll be waiting here.</EmptyState>) :
      <div className="event-list">{events.map(event => <EventCard key={event.id} event={event} href={`#/event/${encodeURIComponent(event.id)}`} />)}
        {missing.map(id => <div className="event-card" key={id}><div className="event-card-top"><div><h3 className="event-title">This event is no longer available</h3><div className="event-meta">Saved event · source unavailable</div></div><span className="badge cancelled">Unavailable</span></div><p className="event-reason">The source has removed this event or it can’t be reached right now. Its saved place is kept on this device.</p></div>)}</div>}
  </main>;
}
