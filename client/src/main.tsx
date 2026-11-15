import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AskPage, DiscoverPage, EventDetailPage, SavedPage } from './pages';
import { OrganizerPage } from './organizer';
import './style.css';

function readRoute() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean);
  if (parts[0] === 'event' && parts[1]) {
    try { return { page: 'event', id: decodeURIComponent(parts.slice(1).join('/')) }; }
    catch { return { page: 'event', id: parts.slice(1).join('/') }; }
  }
  if (['discover', 'saved', 'organizer'].includes(parts[0] ?? '')) return { page: parts[0], id: '' };
  return { page: 'ask', id: '' };
}
function App() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    if (!window.location.hash) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/ask`);
    const update = () => setRoute(readRoute());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const active = route.page === 'event' ? 'discover' : route.page;
  return <div className="app-shell">
    <header className="topbar">
      <a className="wordmark" href="#/ask" aria-label="Trojan Signal home"><span className="seal" aria-hidden="true">T</span><span>Trojan Signal<small>USC, happening</small></span></a>
      <nav className="nav-links" aria-label="Main navigation">
        <a className={`nav-link ${active === 'ask' ? 'active' : ''}`} href="#/ask">Ask</a>
        <a className={`nav-link ${active === 'discover' ? 'active' : ''}`} href="#/discover">Discover</a>
        <a className={`nav-link ${active === 'saved' ? 'active' : ''}`} href="#/saved">Saved</a>
        <a className={`nav-link organizer ${active === 'organizer' ? 'active' : ''}`} href="#/organizer">Organizers</a>
      </nav>
    </header>
    {route.page === 'ask' && <AskPage />}
    {route.page === 'discover' && <DiscoverPage />}
    {route.page === 'saved' && <SavedPage />}
    {route.page === 'event' && <EventDetailPage key={route.id} id={route.id} />}
    {route.page === 'organizer' && <OrganizerPage />}
    <footer className="footer"><span>Made for Trojans. Source-linked details. Unknowns stay unknown.</span><span className="mono">LOS ANGELES · 34.0224° N</span></footer>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
