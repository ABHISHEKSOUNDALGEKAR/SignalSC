import React, { useCallback, useEffect, useRef, useState } from 'react';
import { pages, readRoute, type Page } from './lib/navigation';
import { Discover } from './screens/Discover';
import { Saved } from './screens/Saved';
import { SavedStorageNotice } from './components/SavedEvents';
import { EventDetail } from './screens/EventDetail';
import { Organizer } from './screens/Organizer';
import { Ask } from './screens/Ask';

const labels: Record<Page, string> = { discover: 'Discover', ask: 'Ask', saved: 'Saved', organizer: 'For organizers' };
const introductions = {
  discover: { title: 'Your campus. Your next plan.', body: 'Find campus events with details you can check and a clear next step.' },
  ask: { title: 'What are you up for?', body: 'A clearer way to find something happening at USC.' },
  saved: { title: 'Keep your plans close.', body: 'Your space to return to the events that catch your eye.' },
  organizer: { title: 'You made the flyer. Make it discoverable.', body: 'Help students find your event, with details they can trust.' },
  event: { title: 'Get the full picture.', body: 'Source-linked details. Unknowns stay unknown.' },
};

export function App() {
  const [route, setRoute] = useState(() => readRoute(window.location.hash));
  const [eventRevision, setEventRevision] = useState(0);
  const eventsChanged = useCallback(() => setEventRevision(value => value + 1), []);
  const backHref = useRef(`#${route.page === 'event' ? 'discover' : route.page}`);
  const heading = useRef<HTMLHeadingElement>(null);
  const currentRoute = useRef(route);
  const browsingScroll = useRef({ discover: 0, ask: 0, saved: 0 });
  const browsingFocus = useRef<Partial<Record<Page, HTMLElement>>>({});
  const returnFocus = useRef<HTMLElement | undefined>(undefined);
  useEffect(() => {
    const onHashChange = () => {
      const next = readRoute(window.location.hash);
      const current = currentRoute.current.page;
      if (current === 'discover' || current === 'ask' || current === 'saved') browsingScroll.current[current] = window.scrollY;
      if (next.page === 'event' && current !== 'event' && document.activeElement instanceof HTMLElement) browsingFocus.current[current] = document.activeElement;
      returnFocus.current = current === 'event' && next.page !== 'event' ? browsingFocus.current[next.page] : undefined;
      currentRoute.current = next;
      if (next.page !== 'event') backHref.current = `#${next.page}`;
      setRoute(next);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  const firstRender = useRef(true);
  useEffect(() => {
    document.title = `${route.page === 'event' ? 'Event details' : labels[route.page]} · Trojan Signal`;
    if (firstRender.current) { firstRender.current = false; return; }
    const target = returnFocus.current;
    (target?.isConnected && !target.closest('[hidden]') ? target : heading.current)?.focus({ preventScroll: true });
    window.scrollTo(0, route.page === 'discover' || route.page === 'ask' || route.page === 'saved' ? browsingScroll.current[route.page] : 0);
  }, [route]);
  const intro = introductions[route.page];
  return <>
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); heading.current?.focus(); }}>Skip to content</a>
    <header className="site-header"><a className="brand" href="#discover">Trojan Signal<span>USC, happening.</span></a>
      <nav aria-label="Main navigation">{pages.map(page => <a key={page} href={`#${page}`} aria-current={route.page === page ? 'page' : undefined}>{labels[page]}</a>)}</nav>
    </header>
    <main id="main-content"><p className="eyebrow">A clearer way to find your people</p>
      <h1 ref={heading} tabIndex={-1}>{intro.title}</h1><p className="intro">{intro.body}</p>
      <SavedStorageNotice />
      {/* Preserve browsing state while viewing details or another destination. */}
      <div hidden={route.page !== 'discover'}><Discover revision={eventRevision} /></div>
      <div hidden={route.page !== 'ask'}><Ask revision={eventRevision} /></div>
      {route.page === 'event' ? <EventDetail id={route.id} backHref={backHref.current} /> : route.page === 'organizer' ? <Organizer onEventsChanged={eventsChanged} /> : route.page === 'saved' ? <Saved revision={eventRevision} /> : null}
    </main>
    <footer>Made for Trojans. Source-linked details. Unknowns stay unknown.</footer>
  </>;
}
