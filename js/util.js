// 汎用ユーティリティ

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const yen = (n, { sign = false } = {}) => {
  const v = Math.round(n || 0);
  const s = Math.abs(v).toLocaleString('ja-JP');
  if (v < 0) return '-¥' + s;
  return (sign && v > 0 ? '+¥' : '¥') + s;
};

// 万円表記（グラフ軸など）
export const man = (n) => {
  const v = n / 10000;
  if (Math.abs(v) >= 10000) return (Math.round(v / 1000) / 10).toLocaleString('ja-JP') + '億';
  if (Math.abs(v) >= 100) return Math.round(v).toLocaleString('ja-JP') + '万';
  return (Math.round(v * 10) / 10).toLocaleString('ja-JP') + '万';
};

export const pad = (n) => String(n).padStart(2, '0');

export const toISO = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const today = () => toISO(new Date());

export const monthKey = (iso) => iso.slice(0, 7);

export const thisMonth = () => today().slice(0, 7);

export const addMonths = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

export const daysInMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
};

export const ymLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${y}年${m}月`;
};

// "2024/5/1 12:34", "2024-05-01", "20240501", "2024年5月1日", "R6.5.1" などを YYYY-MM-DD に
export function parseDate(s) {
  if (s == null) return null;
  s = String(s).trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (!s) return null;
  let m = s.match(/^(\d{4})[\/\-\.年](\d{1,2})[\/\-\.月](\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})(?!\d)/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // 和暦 R6.5.1 / 令和6年5月1日
  m = s.match(/^(?:R|令和)\s*(\d{1,2})[\/\-\.年](\d{1,2})[\/\-\.月](\d{1,2})/);
  if (m) return `${2018 + Number(m[1])}-${pad(m[2])}-${pad(m[3])}`;
  // 年なし（カード明細の一部）"05/01" は扱わない
  m = s.match(/^(\d{2})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (m) return `20${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  return null;
}

// "1,234" "￥1,234" "-1,234円" "(1,234)" "▲1,234" などを数値に。空や "-" は null
export function parseAmount(s) {
  if (s == null) return null;
  if (typeof s === 'number') return s;
  let t = String(s).trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  t = t.replace(/[，,￥¥円\s]/g, '').replace(/[−ー－]/g, '-');
  if (!t || t === '-') return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (t.startsWith('▲') || t.startsWith('△')) { neg = true; t = t.slice(1); }
  const v = Number(t);
  if (!Number.isFinite(v)) return null;
  return neg ? -v : v;
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 文字列ハッシュ（重複取り込み判定用）
export function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

// 検索用に正規化（全角英数→半角、カナ大小、空白除去、小文字）
export function norm(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '');
}

export const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (f(x) || 0), 0);

export function groupBy(arr, f) {
  const m = new Map();
  for (const x of arr) {
    const k = f(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}
