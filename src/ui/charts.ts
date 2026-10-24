// Small dependency-free SVG charts. They scale with their container via viewBox.

import { html, raw, esc } from './dom.js';
import { money, count } from '../lib.js';

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * p;
}

const shortMoney = (v: number) => (v >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : v >= 1000 ? `₹${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `₹${Math.round(v)}`);

/** Daily bars (sales) with an order-count line. */
export function salesChart(series: { date: string; sales: number; orders: number }[], title: string) {
  const W = 720;
  const H = 240;
  const pad = { l: 52, r: 40, t: 14, b: 30 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const maxS = niceMax(Math.max(...series.map((s) => s.sales), 1));
  // Order axis uses whole-number ticks: round the max up to a multiple of 4.
  const maxO = Math.max(4, Math.ceil(Math.max(...series.map((s) => s.orders), 1) / 4) * 4);
  const bw = iw / series.length;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const labelEvery = Math.ceil(series.length / 8);
  const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

  const bars = series
    .map((s, i) => {
      const h = (s.sales / maxS) * ih;
      const x = pad.l + i * bw + bw * 0.14;
      const tip = `${fmtDay(s.date)}: ${money(s.sales)} sales · ${s.orders} order${s.orders === 1 ? '' : 's'}`;
      return `<rect class="bar" x="${x.toFixed(1)}" y="${(pad.t + ih - h).toFixed(1)}" width="${(bw * 0.72).toFixed(1)}" height="${Math.max(h, s.sales ? 1 : 0).toFixed(1)}" rx="2"></rect>
        <rect class="hit" x="${(pad.l + i * bw).toFixed(1)}" y="${pad.t}" width="${bw.toFixed(1)}" height="${ih}" data-tip="${esc(tip)}"><title>${esc(tip)}</title></rect>`;
    })
    .join('');
  const line = series
    .map((s, i) => `${i ? 'L' : 'M'}${(pad.l + i * bw + bw / 2).toFixed(1)},${(pad.t + ih - (s.orders / maxO) * ih).toFixed(1)}`)
    .join(' ');
  const grid = ticks
    .map((t) => {
      const y = pad.t + ih - t * ih;
      return `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}"/>
        <text class="axis" x="${pad.l - 8}" y="${y + 4}" text-anchor="end">${shortMoney(maxS * t)}</text>
        <text class="axis axis-r" x="${W - pad.r + 8}" y="${y + 4}">${Math.round(maxO * t)}</text>`;
    })
    .join('');
  const xlabels = series
    .map((s, i) => (i % labelEvery === 0 ? `<text class="axis" x="${(pad.l + i * bw + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(fmtDay(s.date))}</text>` : ''))
    .join('');
  const totalSales = series.reduce((a, s) => a + s.sales, 0);
  const totalOrders = series.reduce((a, s) => a + s.orders, 0);

  return html`
    <figure class="chart">
      <div class="chart-legend" aria-hidden="true">
        <span><i class="swatch swatch-bar"></i>Sales (₹, left axis)</span>
        <span><i class="swatch swatch-line"></i>Orders (right axis)</span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}: ${money(totalSales)} in sales across ${count(totalOrders)} orders over ${series.length} days" preserveAspectRatio="none">
        ${raw(grid)}${raw(bars)}
        <path class="line" d="${line}" fill="none"/>
        ${raw(xlabels)}
      </svg>
      <figcaption class="sr-only">${title}</figcaption>
    </figure>`;
}

/** Horizontal breakdown bars from gross to net. */
export function breakdownBars(rows: { label: string; value: number; tone: 'pos' | 'neg' | 'net' | 'hold' }[]) {
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  return html`<ul class="breakdown">
    ${rows.map(
      (r) => html`<li>
        <span class="bd-label">${r.label}</span>
        <span class="bd-track"><span class="bd-fill bd-${r.tone}" style="width:${Math.max(0.5, (Math.abs(r.value) / max) * 100).toFixed(1)}%"></span></span>
        <span class="bd-value ${r.tone === 'neg' ? 'neg' : ''}">${(r.tone === 'neg' && r.value > 0) || r.value < 0 ? '−' : ''}${money(Math.abs(r.value))}</span>
      </li>`,
    )}
  </ul>`;
}

export function ratingBars(dist: number[], total: number) {
  return html`<ul class="rating-bars">
    ${[5, 4, 3, 2, 1].map((star) => {
      const n = dist[star - 1] ?? 0;
      const pct = total ? (n / total) * 100 : 0;
      return html`<li><span>${star}★</span><span class="bd-track"><span class="bd-fill bd-star" style="width:${pct.toFixed(1)}%"></span></span><span class="muted">${n}</span></li>`;
    })}
  </ul>`;
}
