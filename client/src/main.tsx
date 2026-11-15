import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { EventListResponse } from '../../shared/events';
import './style.css';

function App() {
  const [page, setPage] = useState<'discover' | 'organize'>('discover');
  const [status, setStatus] = useState('Connecting to the event service…');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/events', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Service unavailable');
      const data: EventListResponse = await response.json();
      setStatus(data.mode === 'scaffold' ? 'Service connected · No published events yet' : `${data.events.length} published events`);
    }).catch(error => { if (error.name !== 'AbortError') setStatus('Start the backend to connect the event service.'); });
    return () => controller.abort();
  }, []);
  return <main>
    <nav aria-label="Main navigation"><a className="brand" href="/">Trojan Signal<span>USC, happening.</span></a><div><button aria-pressed={page === 'discover'} onClick={() => setPage('discover')}>Discover</button><button aria-pressed={page === 'organize'} onClick={() => setPage('organize')}>For organizers</button></div></nav>
    <p className="eyebrow">A clearer way to find your people</p>
    <h1>{page === 'discover' ? <>Your campus.<br/>Your next plan.</> : <>You made the flyer.<br/>Make it discoverable.</>}</h1>
    <p className="intro">{page === 'discover' ? 'Find campus events with details you can check and a clear next step.' : 'Upload your announcement, check the extracted details, and publish an event students can find.'}</p>
    <section className="panel"><span className="badge">Development scaffold</span><h2>{page === 'discover' ? 'The next good thing starts here.' : 'Flyer → review → publish'}</h2><p>{page === 'discover' ? 'Published events will appear here once the event store and organizer workflow are connected.' : 'The shared event schema is ready. Flyer extraction, organizer sign-in, and the review form are next to build.'}</p><p className="status" role="status">{status}</p></section>
    <footer>Made for Trojans. Source-linked details. Unknowns stay unknown.</footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
