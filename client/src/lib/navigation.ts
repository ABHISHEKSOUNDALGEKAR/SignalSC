export const pages = ['discover', 'ask', 'saved', 'organizer'] as const;
export type Page = typeof pages[number];
export type Route = { page: Page } | { page: 'event'; id?: string };

export function readRoute(hash: string): Route {
  const [page, id] = hash.replace(/^#\/?/, '').split('/');
  if (page === 'event') {
    try { return { page, ...(id ? { id: decodeURIComponent(id) } : {}) }; }
    catch { return { page }; }
  }
  return { page: pages.includes(page as Page) ? page as Page : 'discover' };
}

export const eventHref = (id: string) => `#event/${encodeURIComponent(id)}`;
