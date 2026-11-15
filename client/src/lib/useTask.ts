import { useEffect, useRef, useState } from 'react';
import { isAbortError } from './api';
import { TaskGate } from './task';

export function useTask() {
  const gate = useRef(new TaskGate());
  const [busy, setBusy] = useState(false);
  useEffect(() => () => gate.current.cancel(), []);
  async function run<T>(job: (signal: AbortSignal) => Promise<T>, success: (data: T) => void, failure: (error: unknown) => void) {
    const ticket = gate.current.begin();
    if (!ticket) return;
    setBusy(true);
    try { const result = await job(ticket.signal); if (ticket.current()) success(result); }
    catch (error) { if (ticket.current() && !isAbortError(error)) failure(error); }
    finally { if (ticket.current()) { ticket.finish(); setBusy(false); } }
  }
  return { busy, run };
}
