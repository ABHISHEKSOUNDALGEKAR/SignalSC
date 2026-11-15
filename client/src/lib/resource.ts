import { isAbortError } from './api';

export type ResourceState<T> = { status: 'loading' } | { status: 'success'; data: T } | { status: 'error'; error: unknown };

/** Cleanup guards state even when a transport ignores its abort signal. */
export function startResource<T>(load: (signal: AbortSignal) => Promise<T>, update: (state: ResourceState<T>) => void): () => void {
  const controller = new AbortController();
  let active = true;
  update({ status: 'loading' });
  void Promise.resolve().then(() => load(controller.signal)).then(
    data => { if (active) update({ status: 'success', data }); },
    error => { if (active && !isAbortError(error)) update({ status: 'error', error }); },
  );
  return () => { active = false; controller.abort(); };
}
