import { esc } from './dom.js';
import { fmt } from '../lib/money.js';

/** Donut chart. segments: [{value, color, label}] */
export function donut(segments, { size = 168, thickness = 22, center = '', sub = '' } = {}) {
  const total = segments.reduce((a, s) => a + Math.max(0, s.value), 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const gap = segments.length > 1 ? 2 : 0;
  const arcs = segments.filter((s) => s.value > 0).map((s) => {
    const len = (s.value / total) * c;
    const el = `<circle r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="${s.color}" stroke-width="${thickness}"
      stroke-dasharray="${Math.max(0, len - gap)} ${c}" stroke-dashoffset="${-offset}"><title>${esc(s.label)}: ${fmt(s.value)}</title></circle>`;
    offset += len;
    return el;
  }).join('');
  return `<svg class="donut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Spending by category">
    <g transform="rotate(-90 ${size / 2} ${size / 2})"><circle r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="var(--track)" stroke-width="${thickness}"/>${arcs}</g>
    <text x="50%" y="47%" text-anchor="middle" class="donut-center">${esc(center)}</text>
    <text x="50%" y="61%" text-anchor="middle" class="donut-sub">${esc(sub)}</text></svg>`;
}

/** Paired bars per month: income vs spend. data: [{label, income, spend, active}] */
export function trendBars(data, { height = 140 } = {}) {
  const w = 320, pad = 18, bw = Math.min(16, (w - pad * 2) / data.length / 2.6);
  const max = Math.max(1, ...data.flatMap((d) => [d.income, d.spend]));
  const step = (w - pad * 2) / data.length;
  const h = height - 24;
  const bars = data.map((d, i) => {
    const x = pad + i * step + step / 2;
    const hi = (d.income / max) * h, hs = (d.spend / max) * h;
    return `<g class="${d.active ? 'active' : ''}">
      <rect x="${x - bw - 1}" y="${h - hi}" width="${bw}" height="${Math.max(hi, 1)}" rx="3" class="bar-in"><title>Income ${fmt(d.income)}</title></rect>
      <rect x="${x + 1}" y="${h - hs}" width="${bw}" height="${Math.max(hs, 1)}" rx="3" class="bar-out"><title>Spent ${fmt(d.spend)}</title></rect>
      <text x="${x}" y="${height - 6}" text-anchor="middle" class="bar-label">${esc(d.label)}</text></g>`;
  }).join('');
  return `<svg class="trend" viewBox="0 0 ${w} ${height}" preserveAspectRatio="none" role="img" aria-label="Income and spending by month">
    <line x1="${pad}" x2="${w - pad}" y1="${h}" y2="${h}" class="axis"/>${bars}</svg>`;
}

export function progressBar(pct, { warnAt = 0.85 } = {}) {
  const p = Math.max(0, Math.min(1, pct));
  const cls = pct > 1 ? 'over' : pct >= warnAt ? 'warn' : 'ok';
  return `<div class="pbar ${cls}"><span style="width:${(p * 100).toFixed(1)}%"></span></div>`;
}

/** Tiny line chart for a series of values (pence). Last point highlighted. */
export function sparkline(values, { w = 96, h = 28, color = 'var(--accent)' } = {}) {
  if (!values.length) return '';
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? (w - 4) / (values.length - 1) : 0;
  const pts = values.map((v, i) => [2 + i * step, h - 3 - (v / max) * (h - 6)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const [lx, ly] = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${lx}" cy="${ly}" r="2.8" fill="${color}"/></svg>`;
}

/**
 * Cumulative spending through the month: this month (solid) vs last month (dashed).
 * cur/prev: arrays of daily spend (pence), index 0 = day 1. curDays = days elapsed this month.
 */
export function paceChart(cur, prev, curDays, { w = 320, h = 110 } = {}) {
  const cum = (arr) => arr.reduce((acc, v) => { acc.push((acc[acc.length - 1] || 0) + Math.max(0, v)); return acc; }, []);
  const c = cum(cur).slice(0, curDays), p = cum(prev);
  const days = Math.max(prev.length, cur.length, 28);
  const max = Math.max(1, ...c, ...p);
  const x = (i) => 4 + (i / (days - 1)) * (w - 8);
  const y = (v) => h - 6 - (v / max) * (h - 16);
  const path = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = c.length ? `${path(c)} L${x(c.length - 1).toFixed(1)},${h - 6} L${x(0)},${h - 6} Z` : '';
  const last = c.length ? [x(c.length - 1), y(c[c.length - 1])] : null;
  return `<svg class="pace" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Spending this month compared with last month">
    <defs><linearGradient id="paceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
    ${p.length ? `<path d="${path(p)}" class="pace-prev"/>` : ''}
    ${area ? `<path d="${area}" fill="url(#paceFill)"/><path d="${path(c)}" class="pace-cur"/>` : ''}
    ${last ? `<circle cx="${last[0]}" cy="${last[1]}" r="4" class="pace-dot"/>` : ''}</svg>`;
}
