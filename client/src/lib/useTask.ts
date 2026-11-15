import { useEffect, useRef, useState } from 'react';
import { isAbortError } from './api';
import { TaskGate } from './task';

export function useTask() {
  const gate = useRef(new TaskGate());
  const [busy, setBusy] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    // Native disabled controls can drop keyboard focus to the document while waiting.
    // Recover only if the user has not moved focus elsewhere in the meantime.
    if (!busy && document.activeElement === document.body && trigger.current?.isConnected && !trigger.current.matches(':disabled') && !trigger.current.closest('[hidden]')) trigger.current.focus();
    if (!busy) trigger.current = null;
  }, [busy]);
  useEffect(() => () => gate.current.cancel(), []);
  async function run<T>(job: (signal: AbortSignal) => Promise<T>, success: (data: T) => void, failure: (error: unknown) => void) {
    const ticket = gate.current.begin();
    if (!ticket) return;
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setBusy(true);
    try { const result = await job(ticket.signal); if (ticket.current()) success(result); }
    catch (error) { if (ticket.current() && !isAbortError(error)) failure(error); }
    finally { if (ticket.current()) { ticket.finish(); setBusy(false); } }
  }
  return { busy, run };
}
