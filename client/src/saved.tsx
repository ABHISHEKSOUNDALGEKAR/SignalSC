import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type EventRecord } from './api';
import { EmptyState, ErrorNotice, EventCard, LoadingList } from './common';
import { moveRegistrationToSaved, readRegistrations, readSavedIds, REGISTRATION_CHANGE } from './registration-store';

export function SavedPage() {
  const [tab, setTab] = useState<'saved' | 'registered'>('saved');
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [counts, setCounts] = useState({ saved: 0, registered: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const sequence = useRef(0);
  async function reload() {
    const request = ++sequence.current;
    setLoading(true); setError(''); setStorageUnavailable(false);
    let ids: string[];
    try {
      const registered = readRegistrations().registered;
      const saved = readSavedIds().filter(id => !registered.includes(id));
      setCounts({ saved: saved.length, registered: registered.length });
      ids = tab === 'registered' ? registered : saved;
    } catch {
      setEvents([]); setMissing([]); setStorageUnavailable(true); setLoading(false);
      return;
    }
    const found: EventRecord[] = [], absent: string[] = [];
    let fetchError = '';
    await Promise.all(ids.map(async id => {
      try { found.push((await api.event(id)).event); }
      catch (e) {
        if (e instanceof ApiError && e.status === 404) absent.push(id);
        else fetchError = e instanceof Error ? e.message : 'Your events could not load.';
      }
    }));
    if (request !== sequence.current) return;
    found.sort((a, b) => Date.parse(a.startsAt ?? '') - Date.parse(b.startsAt ?? ''));
    setEvents(found); setMissing(absent); setError(fetchError); setLoading(false);
  }
  useEffect(() => {
    void reload();
    const refresh = () => { void reload(); };
    window.addEventListener('storage', refresh);
    window.addEventListener(REGISTRATION_CHANGE, refresh);
    return () => {
      sequence.current++;
      window.removeEventListener('storage', refresh);
      window.removeEventListener(REGISTRATION_CHANGE, refresh);
    };
  }, [tab]);
  function move(id: string) {
    try { moveRegistrationToSaved(id); }
    catch { setError('This event could not be moved. Allow browser storage and try again.'); }
  }
  return <main id="main-content" tabIndex={-1} className="page">
    <section className="hero"><div className="eyebrow">Your list, on this device</div><h1>Keep the plans<br />you like.</h1>
      <p className="lede">Save possibilities and keep track of events you registered for. Both lists stay in this browser; registration is confirmed by you, not verified with the organizer.</p><div className="hero-rule" /></section>
    <div className="filters" role="tablist" aria-label="Your event lists">
      {(['saved', 'registered'] as const).map(value => <button key={value} id={`library-${value}-tab`} role="tab"
        aria-selected={tab === value} aria-controls="library-panel" tabIndex={tab === value ? 0 : -1}
        className={`filter-chip ${tab === value ? 'selected' : ''}`}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 'saved' : event.key === 'End' ? 'registered' : tab === 'saved' ? 'registered' : 'saved';
          setTab(next); document.getElementById(`library-${next}-tab`)?.focus();
        }}
        onClick={() => setTab(value)}>{value === 'saved' ? 'Saved' : 'Registered'} ({counts[value]})</button>)}
    </div>
    <section id="library-panel" role="tabpanel" aria-labelledby={`library-${tab}-tab`} aria-busy={loading}>
      {error && <ErrorNotice error={error} retry={() => void reload()} />}
      {storageUnavailable && <ErrorNotice error="This browser could not read your saved events or registrations. Allow site storage in your browser settings and try again." retry={() => void reload()} />}
      {loading ? <LoadingList /> : storageUnavailable ? null : events.length === 0 && missing.length === 0 ? (error ? null :
        <EmptyState title={tab === 'registered' ? 'No registered events yet' : 'Nothing saved just yet'} action={<div className="empty-actions"><a className="btn btn-primary" href="#/discover">Browse Discover</a></div>}>
          {tab === 'registered' ? 'After visiting an event’s registration page, tell us whether you registered. You can also mark an event as registered from its details.' : 'Save an event you want to remember and it’ll be waiting here.'}
        </EmptyState>) :
        <div className="event-list">
          {events.map(event => <div key={event.id}>
            {tab === 'registered' && <p className="event-meta">Registered · You confirmed</p>}
            <EventCard event={event} href={`#/event/${encodeURIComponent(event.id)}`} />
            {tab === 'registered' && <button className="btn btn-outline library-move" onClick={() => move(event.id)} aria-label={`Move ${event.title} to Saved`}>Move to Saved</button>}
          </div>)}
          {missing.map(id => <div className="event-card" key={id}><div className="event-card-top"><div><h3 className="event-title">This event is no longer available</h3><div className="event-meta">{tab === 'registered' ? 'Registered' : 'Saved'} event · source unavailable</div></div><span className="badge cancelled">Unavailable</span></div>
            <p className="event-reason">The source has removed this event or it can’t be reached right now. Its place is kept on this device.</p>
            {tab === 'registered' && <button className="btn btn-outline" onClick={() => move(id)}>Move to Saved</button>}
          </div>)}
        </div>}
    </section>
  </main>;
}
