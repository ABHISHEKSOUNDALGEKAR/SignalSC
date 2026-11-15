// Copy older browser data without removing it, preserving saved events and feedback identity.
export function readBrowserValue(suffix: 'saved' | 'device' | 'feedback-submitted'): string | null {
  const key = `signalsc-${suffix}`;
  const current = localStorage.getItem(key);
  if (current !== null) return current;
  const legacy = localStorage.getItem(`trojan-signal-${suffix}`);
  if (legacy !== null) {
    try { localStorage.setItem(key, legacy); } catch { /* The existing value can still be read. */ }
  }
  return legacy;
}
