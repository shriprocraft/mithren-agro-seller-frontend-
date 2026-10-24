// Minimal rendering helpers: an auto-escaping `html` template tag and DOM utilities.

export class Raw {
  constructor(public value: string) {}
  toString() {
    return this.value;
  }
}

export const raw = (s: string) => new Raw(s);

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]!);

type Value = string | number | boolean | null | undefined | Raw | Value[];

function serialize(v: Value): string {
  if (v === null || v === undefined || v === false) return '';
  if (v === true) return '';
  if (v instanceof Raw) return v.value;
  if (Array.isArray(v)) return v.map(serialize).join('');
  return esc(v);
}

/** Tagged template that escapes every interpolation unless it is `Raw` (or nested `html`). */
export function html(strings: TemplateStringsArray, ...values: Value[]): Raw {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += serialize(values[i]!);
  });
  return new Raw(out);
}

export function $(sel: string, root: ParentNode = document) {
  return root.querySelector(sel) as HTMLElement | null;
}

export function $$<T extends Element = HTMLElement>(sel: string, root: ParentNode = document) {
  return Array.from(root.querySelectorAll<T>(sel));
}

/** Delegated event binding: on(root, 'click', '[data-action=save]', handler). */
export function on<K extends keyof HTMLElementEventMap>(
  root: HTMLElement,
  type: K,
  selector: string,
  handler: (ev: HTMLElementEventMap[K], target: HTMLElement) => void,
) {
  root.addEventListener(type, (ev) => {
    const t = (ev.target as HTMLElement | null)?.closest?.(selector) as HTMLElement | null;
    if (t && root.contains(t)) handler(ev as HTMLElementEventMap[K], t);
  });
}

export function formValues(form: HTMLFormElement): Record<string, string> {
  const out: Record<string, string> = {};
  new FormData(form).forEach((v, k) => {
    if (typeof v === 'string') out[k] = v;
  });
  return out;
}

/** True when running inside an embedding frame (e.g. a hosted preview), where downloads and print are blocked. */
export const EMBEDDED = (() => {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    return true;
  }
})();

export function download(filename: string, content: string, mime = 'text/csv') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
