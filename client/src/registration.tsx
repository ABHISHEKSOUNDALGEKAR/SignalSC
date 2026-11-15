import { useEffect, useRef, useState } from 'react';
import {
  answerRegistration, markRegistrationDeparture, nextRegistrationCheck, readRegistrations,
  REGISTRATION_CHANGE, REGISTRATION_KEY, type PendingRegistration,
} from './registration-store';
import { hasUnsavedChanges } from './unsaved-changes';

export function RegistrationReturnPrompt() {
  const [pending, setPending] = useState<PendingRegistration | null>(null);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const dismissed = useRef(new Set<string>());

  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus() || hasUnsavedChanges()) return;
      try { setPending(nextRegistrationCheck(Date.now(), dismissed.current)); } catch { /* The outbound action reports inaccessible browser storage. */ }
    };
    const leave = () => { try { markRegistrationDeparture(); } catch { /* Do not prevent external navigation. */ } };
    const returned = () => {
      if (document.visibilityState !== 'visible') return leave();
      leave();
      check();
    };
    const storage = (event: StorageEvent) => { if (event.key === REGISTRATION_KEY || event.key === null) check(); };
    window.addEventListener('blur', leave);
    window.addEventListener('pagehide', leave);
    window.addEventListener('focus', returned);
    window.addEventListener('pageshow', check);
    window.addEventListener('hashchange', check);
    window.addEventListener('storage', storage);
    window.addEventListener(REGISTRATION_CHANGE, check);
    document.addEventListener('visibilitychange', returned);
    check();
    return () => {
      window.removeEventListener('blur', leave);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('focus', returned);
      window.removeEventListener('pageshow', check);
      window.removeEventListener('hashchange', check);
      window.removeEventListener('storage', storage);
      window.removeEventListener(REGISTRATION_CHANGE, check);
      document.removeEventListener('visibilitychange', returned);
    };
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (pending && element && !element.open) { setError(''); element.showModal(); }
    if (!pending && element?.open) element.close();
  }, [pending?.id]);

  function answer(value: 'yes' | 'no' | 'later') {
    if (!pending) return;
    try {
      // Another tab may already have answered this question.
      if (value !== 'yes' && readRegistrations().registered.includes(pending.id)) { setPending(null); return; }
      answerRegistration(pending.id, value);
      setError('');
      setPending(null);
    } catch {
      if (value === 'later') {
        dismissed.current.add(pending.id);
        setPending(null);
        return;
      }
      setError('Your choice could not be saved. Allow browser storage and try again.');
    }
  }

  return <dialog ref={dialog} className="registration-dialog" aria-labelledby="registration-question" aria-describedby="registration-explanation"
    onCancel={event => { event.preventDefault(); answer('later'); }}>
    <div className="eyebrow">Your event plans</div>
    <h2 id="registration-question">Did you register for this event?</h2>
    <p className="registration-event-title">{pending?.title}</p>
    <p id="registration-explanation" className="event-meta">If you registered, we’ll move this event to Saved → Registered. This is your confirmation, not verification from EngageSC. It stays on this browser.</p>
    {error && <div role="alert" className="inline-message">{error}</div>}
    <div className="registration-dialog-actions">
      <button className="btn btn-primary" onClick={() => answer('yes')}>Yes, I registered</button>
      <button className="btn btn-outline" onClick={() => answer('no')}>Not yet</button>
      <button className="btn btn-outline" onClick={() => answer('later')}>Not now</button>
    </div>
  </dialog>;
}
