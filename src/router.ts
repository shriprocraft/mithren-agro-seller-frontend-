// Hash router. Paths mirror the production routes (/seller/...) after the "#",
// so the prototype works on any static host without server rewrites.

import type { Seller } from './types.js';

export interface PageContext {
  /** Fresh container for this render; bind listeners here. */
  root: HTMLElement;
  params: Record<string, string>;
  query: URLSearchParams;
  seller: Seller;
  /** Re-run the current route (e.g. after a mutation). */
  refresh: () => void;
  /** Returns false if the user has navigated away since this render began. */
  isCurrent: () => boolean;
}

export type Page = (ctx: PageContext) => Promise<void> | void;

interface Route {
  pattern: RegExp;
  keys: string[];
  page: () => Promise<Page>;
  title: string;
  nav?: string;
}

const routes: Route[] = [];

export function route(path: string, title: string, page: () => Promise<Page>, nav?: string) {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' +
      path.replace(/\//g, '\\/').replace(/:(\w+)/g, (_, k: string) => {
        keys.push(k);
        return '([^/]+)';
      }) +
      '\\/?$',
  );
  routes.push({ pattern, keys, page, title, ...(nav ? { nav } : {}) });
}

export function currentLocation() {
  const raw = location.hash.replace(/^#/, '') || '/seller';
  const [path = '/seller', qs = ''] = raw.split('?');
  return { path, query: new URLSearchParams(qs) };
}

export function match(path: string) {
  for (const r of routes) {
    const m = r.pattern.exec(path);
    if (m) {
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1] ?? '')));
      return { route: r, params };
    }
  }
  return null;
}

export function navigate(to: string, replace = false) {
  const target = '#' + to;
  if (replace) history.replaceState(null, '', target);
  else if (location.hash !== target) location.hash = target;
  if (replace || location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** Update the query string without adding a history entry or re-rendering. */
export function setQuery(params: Record<string, string | undefined>) {
  const { path, query } = currentLocation();
  for (const [k, v] of Object.entries(params)) {
    if (v) query.set(k, v);
    else query.delete(k);
  }
  const qs = query.toString();
  history.replaceState(null, '', `#${path}${qs ? '?' + qs : ''}`);
}
