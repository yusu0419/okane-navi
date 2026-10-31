// 自動連携（Gmail の通知メール・iPhone ショートカット）
import { uid, norm, today, toISO } from './util.js';
import { categorize } from './rules.js';

export function defaultSync() {
  return {
    url: '',
    token: '',
    lastSync: null,
    lastResult: null,
    map: {}, // 通知の種類(key) → 口座ID または 'skip'
    keys: {}, // これまでに届いた通知の種類
    pending: [], // 口座が決まっていない取引
    scheduled: [], // 銀行の引き落とし予定
    notices: [], // 振込入金などのお知らせ
    dismissed: [],
    unparsed: [],
  };
}

const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00');
  d.setDate(d.getDate() + n);
  return toISO(d);
};

const dayDiff = (a, b) => Math.abs((new Date(a + 'T00:00') - new Date(b + 'T00:00')) / 86400000);

// 別の経路（CSV・メール・ショートカット）で既に入っている同じ取引を探す
export function findNearDup(txs, t, used = new Set()) {
  return txs.find((c) =>
    !used.has(c.id) &&
    c.accountId === t.accountId &&
    c.amount === t.amount &&
    c.source !== t.source &&
    dayDiff(c.date, t.date) <= 3) || null;
}

// 通知の種類から口座を推測
export function guessAccount(accounts, item) {
  const types = item.source === 'smbc-bank' ? ['bank'] : ['card'];
  const words = new Set();
  const add = (s) => norm(s).split(/[\/・()（）:：\-\s]+/).filter((w) => w.length >= 2).forEach((w) => words.add(w));
  add(item.key.split(':').slice(1).join(':'));
  if (item.source === 'smbc-card') ['三井住友', 'smbc', 'olive'].forEach((w) => words.add(w));
  if (item.source === 'jcb') ['jcb'].forEach((w) => words.add(w));
  if (item.source === 'smbc-bank') ['三井住友', 'smbc'].forEach((w) => words.add(w));
  let best = null, bestScore = 0;
  for (const a of accounts) {
    if (a.archived || !types.includes(a.type)) continue;
    const name = norm(a.name);
    let score = 0;
    for (const w of words) if (name.includes(w) || (w.length >= 3 && w.includes(name))) score += w.length;
    // カード名（Olive, Amazon 等）が一致するものを優先
    if (score > bestScore) { best = a; bestScore = score; }
  }
  return best;
}

export function sinceFor(s, now = today()) {
  return s.lastSync ? addDays(s.lastSync.slice(0, 10), -14) : addDays(now, -90);
}

export async function fetchSync(s) {
  const u = new URL(s.url);
  u.searchParams.set('token', s.token);
  u.searchParams.set('since', sinceFor(s));
  let res;
  try {
    res = await fetch(u, { redirect: 'follow' });
  } catch {
    throw new Error('連携先に接続できませんでした（URLとネット接続を確認してください）');
  }
  let j;
  try { j = await res.json(); } catch { throw new Error('連携先の応答を読めませんでした（デプロイの「アクセスできるユーザー」が「全員」か確認してください）'); }
  if (j.error) throw new Error(j.error === 'unauthorized' ? '合言葉が違います' : j.error);
  return j;
}

// 取得した通知をアプリの取引に変換。戻り値は追加する取引
export function processSync(state, items) {
  const s = state.sync;
  const accById = (id) => state.accounts.find((a) => a.id === id);
  const now = today();
  for (const it of items) {
    if (it.key) s.keys[it.key] = { label: it.label, source: it.source, last: it.date };
  }
  const sched = new Map(s.scheduled.filter((x) => x.date >= now).map((x) => [x.id, x]));
  for (const it of items) if (it.type === 'scheduled' && it.date >= now) sched.set(it.id, it);
  s.scheduled = [...sched.values()].sort((a, b) => a.date.localeCompare(b.date));

  const known = new Set([...s.notices.map((n) => n.id), ...s.dismissed]);
  for (const it of items) if (it.type === 'notice' && !known.has(it.id) && it.date >= addDays(now, -30)) s.notices.push(it);

  const existing = new Set(state.tx.map((t) => t.extId).filter(Boolean));
  const used = new Set();
  const add = [];
  const pending = [];
  const seen = new Set();
  for (const it of [...s.pending, ...items.filter((i) => i.type === 'tx')]) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    const extId = 'mail:' + it.id;
    if (existing.has(extId)) continue;
    let accId = s.map[it.key];
    if (accId === undefined) {
      const g = guessAccount(state.accounts, it);
      if (g) { accId = g.id; s.map[it.key] = g.id; }
    }
    if (accId === 'skip') continue;
    const acc = accById(accId);
    if (!acc) { pending.push(it); continue; }
    const t = {
      id: uid(), accountId: acc.id, date: it.date, time: it.time || '', amount: it.amount,
      payee: it.payee || '', content: '', memo: '', source: it.source === 'applepay' ? 'shortcut' : 'mail', extId,
    };
    const dup = findNearDup([...state.tx, ...add], t, used);
    if (dup) { used.add(dup.id); continue; }
    categorize(t, state.rules, acc.type);
    add.push(t);
    existing.add(extId);
  }
  s.pending = pending.slice(-500);
  return add;
}
