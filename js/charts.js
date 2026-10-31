// 軽量な SVG グラフ
import { esc, man, yen } from './util.js';

export function donut(items, { size = 180, thickness = 26, center = '', sub = '' } = {}) {
  const total = items.reduce((a, x) => a + Math.max(0, x.value), 0);
  const r = size / 2 - thickness / 2 - 2;
  const c = size / 2;
  const C = 2 * Math.PI * r;
  let off = 0;
  const arcs = total
    ? items.filter((x) => x.value > 0).map((x) => {
        const len = (x.value / total) * C;
        const s = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${x.color}" stroke-width="${thickness}"
          stroke-dasharray="${Math.max(0, len - 1.5)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 ${c} ${c})"/>`;
        off += len;
        return s;
      }).join('')
    : `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${thickness}"/>`;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="donut" role="img">
    ${arcs}
    <text x="${c}" y="${c - 4}" text-anchor="middle" class="donut-main">${esc(center)}</text>
    <text x="${c}" y="${c + 16}" text-anchor="middle" class="donut-sub">${esc(sub)}</text>
  </svg>`;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

// 収入・支出の月別棒グラフ
export function incomeExpenseBars(series, { height = 180 } = {}) {
  const W = 340, H = height, L = 38, B = 22, T = 8;
  const max = niceMax(Math.max(1, ...series.map((s) => Math.max(s.income, s.expense))));
  const n = series.length;
  const bw = (W - L - 4) / n;
  const y = (v) => T + (H - T - B) * (1 - v / max);
  let g = '';
  for (let i = 0; i <= 2; i++) {
    const v = (max / 2) * i;
    g += `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 4}" y="${y(v) + 4}" text-anchor="end" class="axis">${man(v)}</text>`;
  }
  series.forEach((s, i) => {
    const x = L + i * bw + bw * 0.15;
    const w = bw * 0.33;
    g += `<rect x="${x}" y="${y(s.income)}" width="${w}" height="${Math.max(0, y(0) - y(s.income))}" rx="2" class="bar-in"><title>${s.ym} 収入 ${yen(s.income)}</title></rect>`;
    g += `<rect x="${x + w + 1}" y="${y(Math.max(0, s.expense))}" width="${w}" height="${Math.max(0, y(0) - y(Math.max(0, s.expense)))}" rx="2" class="bar-out"><title>${s.ym} 支出 ${yen(s.expense)}</title></rect>`;
    if (n <= 12 || i % 2 === 0) g += `<text x="${L + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle" class="axis">${Number(s.ym.slice(5))}月</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart">${g}</svg>`;
}

// 折れ線（複数系列）。series: [{ label, color, values: [] }], labels: []
export function lines(seriesList, labels, { height = 200, area = false, fmtLabel = (l) => l } = {}) {
  const W = 340, H = height, L = 42, B = 22, T = 10;
  const all = seriesList.flatMap((s) => s.values);
  const minV = Math.min(0, ...all);
  const range = niceMax(Math.max(1, ...all) - minV);
  const max = range + minV;
  const lead = Math.round(range / Math.pow(10, Math.floor(Math.log10(range))));
  const ticks = lead === 5 ? 5 : 4;
  const n = labels.length;
  const x = (i) => L + (n <= 1 ? 0 : (i * (W - L - 6)) / (n - 1));
  const y = (v) => T + (H - T - B) * (1 - (v - minV) / (max - minV || 1));
  let g = '';
  for (let i = 0; i <= ticks; i++) {
    const v = minV + (range / ticks) * i;
    g += `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 4}" y="${y(v) + 4}" text-anchor="end" class="axis">${man(v)}</text>`;
  }
  const step = Math.max(1, Math.ceil(n / 6));
  labels.forEach((l, i) => {
    if (i % step === 0 || (i === n - 1 && (n - 1) % step >= step / 2)) g += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="axis">${esc(fmtLabel(l))}</text>`;
  });
  for (const s of seriesList) {
    const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    if (area) g += `<polygon points="${x(0)},${y(minV)} ${pts.join(' ')} ${x(n - 1)},${y(minV)}" fill="${s.color}" opacity="0.12"/>`;
    g += `<polyline points="${pts.join(' ')}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="chart">${g}</svg>`;
}

export function legend(items) {
  return `<div class="legend">${items.map((i) => `<span><i style="background:${i.color}"></i>${esc(i.label)}</span>`).join('')}</div>`;
}
