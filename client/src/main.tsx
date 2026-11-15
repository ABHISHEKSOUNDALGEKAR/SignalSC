import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { AskPage, DiscoverPage, EventDetailPage, SavedPage } from './pages';
import { OrganizerPage } from './organizer';
import { RegistrationReturnPrompt } from './registration';
import { confirmLeavingWithUnsavedChanges, hasUnsavedChanges } from './unsaved-changes';
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
    let currentHash = window.location.hash;
    let skipHashChange = false;
    let restoringHistory = false;
    const update = () => {
      if (skipHashChange) {
        skipHashChange = false;
        currentHash = window.location.hash;
        setRoute(readRoute());
        return;
      }
      if (hasUnsavedChanges() && !confirmLeavingWithUnsavedChanges()) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${currentHash}`);
        return;
      }
      currentHash = window.location.hash;
      setRoute(readRoute());
    };
    const onPopState = () => {
      if (restoringHistory) {
        restoringHistory = false;
        if (window.location.hash !== currentHash) skipHashChange = true;
        return;
      }
      const changedHash = window.location.hash !== currentHash;
      if (!hasUnsavedChanges()) {
        if (changedHash) skipHashChange = true;
        currentHash = window.location.hash;
        setRoute(readRoute());
        return;
      }
      if (confirmLeavingWithUnsavedChanges()) {
        if (changedHash) skipHashChange = true;
        currentHash = window.location.hash;
        setRoute(readRoute());
      } else {
        restoringHistory = true;
        window.history.forward();
      }
    };
    const onDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>('a[href^="#"]');
      if (!anchor || anchor.target === '_blank' || anchor.href === window.location.href || !hasUnsavedChanges()) return;
      if (!confirmLeavingWithUnsavedChanges()) event.preventDefault();
      else skipHashChange = true;
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('hashchange', update);
    window.addEventListener('popstate', onPopState);
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onDocumentClick);
    return () => {
      window.removeEventListener('hashchange', update);
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onDocumentClick);
    };
  }, []);
  const active = route.page === 'event' ? 'discover' : route.page;
  const current = (page: string) => active === page ? 'page' as const : undefined;
  // Pages are hash routes, so the skip link moves focus itself instead of following its href.
  const skipToContent = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const main = document.getElementById('main-content');
    main?.focus();
    main?.scrollIntoView();
  };
  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={skipToContent}>Skip to content</a>
    <header className="topbar">
      <a className="wordmark" href="#/ask" aria-label="SignalSC home"><span className="seal" aria-hidden="true">S</span><span>SignalSC<small>USC, happening</small></span></a>
      <nav className="nav-links" aria-label="Main navigation">
        <a className={`nav-link ${active === 'ask' ? 'active' : ''}`} aria-current={current('ask')} href="#/ask">Ask</a>
        <a className={`nav-link ${active === 'discover' ? 'active' : ''}`} aria-current={current('discover')} href="#/discover">Discover</a>
        <a className={`nav-link ${active === 'saved' ? 'active' : ''}`} aria-current={current('saved')} href="#/saved">Saved</a>
        <a className={`nav-link organizer ${active === 'organizer' ? 'active' : ''}`} aria-current={current('organizer')} href="#/organizer">Organizers</a>
      </nav>
    </header>
    {route.page === 'ask' && <AskPage />}
    {route.page === 'discover' && <DiscoverPage />}
    {route.page === 'saved' && <SavedPage />}
    {route.page === 'event' && <EventDetailPage key={route.id} id={route.id} />}
    {route.page === 'organizer' && <OrganizerPage />}
    <RegistrationReturnPrompt />
    <footer className="footer"><span>Made for Trojans. Source-linked details. Unknowns stay unknown.</span><span className="mono">LOS ANGELES · 34.0224° N</span></footer>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
