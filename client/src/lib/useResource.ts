import { useEffect, useState } from 'react';
import { startResource, type ResourceState } from './resource';

// Pass a stable loader (module function or useCallback).
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ResourceState<T>>({ status: 'loading' });
  useEffect(() => startResource(load, setState), [load, attempt]);
  return { state, retry: () => setAttempt(value => value + 1) };
}
