// 明細CSV（確定データ）と、自動連携で入った速報データの突き合わせ
import { findNearDup } from './sync.js';

// 速報（あとで明細CSVで確定させるもの）
export const PROVISIONAL = new Set(['mail', 'shortcut', 'mf']);

export const isProvisional = (t) => PROVISIONAL.has(t.source) && !t.confirmed;

const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 速報を確定データで置き換える。手で直した分類・メモ・除外はそのまま
export function mergeConfirmed(prov, t) {
  const keepCat = prov.userSet;
  return {
    ...prov,
    date: t.date,
    time: t.time || prov.time || '',
    amount: t.amount,
    payee: t.payee || prov.payee,
    content: t.content || prov.content || '',
    method: t.method || prov.method,
    kind: keepCat ? prov.kind : t.kind,
    category: keepCat ? prov.category : t.category,
    source: t.source,
    extId: t.extId,
    provisionalSource: prov.source,
    confirmed: true,
    review: false,
  };
}

/**
 * list: 取り込もうとしている明細（分類済み）
 * 戻り値:
 *  fresh   … 新しく追加する取引
 *  confirm … 速報を確定データで置き換えたもの（既存IDのまま）
 *  review  … 明細の期間内なのに明細に無かった速報（取消・金額違いの可能性）
 *  dup     … 取り込み済みでスキップした件数
 */
export function reconcile(stateTx, list) {
  const existing = new Set(stateTx.map((t) => t.extId).filter(Boolean));
  const prov = stateTx.filter(isProvisional);
  const used = new Set();
  const fresh = [];
  const confirm = [];
  let dup = 0;
  for (const t of list) {
    if (existing.has(t.extId)) { dup++; continue; }
    const d = findNearDup(prov, t, used);
    if (d) {
      used.add(d.id);
      confirm.push(mergeConfirmed(d, t));
      continue;
    }
    fresh.push(t);
    existing.add(t.extId);
  }
  // 口座ごとの明細の期間。末尾数日は明細への反映待ちがあるので対象外
  const ranges = new Map();
  for (const t of list) {
    const r = ranges.get(t.accountId) || { from: t.date, to: t.date };
    if (t.date < r.from) r.from = t.date;
    if (t.date > r.to) r.to = t.date;
    ranges.set(t.accountId, r);
  }
  const review = prov
    .filter((p) => !used.has(p.id) && !p.review)
    .filter((p) => {
      const r = ranges.get(p.accountId);
      return r && p.date >= r.from && p.date <= addDays(r.to, -3);
    })
    .map((p) => ({ ...p, review: true }));
  const dates = list.map((t) => t.date).sort();
  return { fresh, confirm, review, dup, from: dates[0], to: dates[dates.length - 1] };
}
