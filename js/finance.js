// 残高・集計・見通しの計算（DOM に依存しない純粋関数）
import { addMonths, daysInMonth, monthKey, norm, pad, sum } from './util.js';

export const ACCOUNT_TYPES = {
  bank: { label: '銀行口座', icon: '🏦', group: 'cash' },
  paypay: { label: 'PayPay・電子マネー', icon: '📱', group: 'cash' },
  cash: { label: '現金', icon: '👛', group: 'cash' },
  card: { label: 'クレジットカード', icon: '💳', group: 'card' },
  securities: { label: '証券・投資', icon: '📈', group: 'invest' },
  points: { label: 'ポイント・マイル', icon: '🎁', group: 'points' },
};

export const isValuationType = (type) => type === 'securities' || type === 'points';

const counted = (t) => !t.excluded;

// ---------- 残高 ----------

function txOf(state, accId) {
  return state.tx.filter((t) => t.accountId === accId && counted(t));
}

function snapsOf(state, accId) {
  return state.snapshots.filter((s) => s.accountId === accId).sort((a, b) => a.date.localeCompare(b.date));
}

// 指定日時点の残高（円換算前の口座単位）
export function balanceAt(state, acc, asOf) {
  const snaps = snapsOf(state, acc.id);
  if (isValuationType(acc.type)) {
    const before = snaps.filter((s) => s.date <= asOf);
    const s = before[before.length - 1];
    if (!s) return 0;
    // 記録以降に取り込んだ入出金（積立など）があれば加味
    return s.value + sum(txOf(state, acc.id).filter((t) => t.date > s.date && t.date <= asOf), (t) => t.amount);
  }
  if (acc.type === 'card') return -cardUnpaid(state, acc, asOf).total;
  const txs = txOf(state, acc.id);
  // 「残高を合わせる」記録があれば、それを基準に前後の取引で補正
  const before = snaps.filter((s) => s.date <= asOf);
  const base = before[before.length - 1] || snaps[0];
  if (!base) return (acc.opening || 0) + sum(txs.filter((t) => t.date <= asOf), (t) => t.amount);
  if (base.date <= asOf) return base.value + sum(txs.filter((t) => t.date > base.date && t.date <= asOf), (t) => t.amount);
  return base.value - sum(txs.filter((t) => t.date > asOf && t.date <= base.date), (t) => t.amount);
}

export const toYen = (acc, v) => (acc.type === 'points' ? v * (acc.rate ?? 1) : v);

export function balanceYen(state, acc, asOf) {
  return toYen(acc, balanceAt(state, acc, asOf));
}

// カード：利用日から引き落とし日を求める
export function cardPayDate(acc, date) {
  const closing = acc.closingDay || 31;
  const payDay = acc.payDay || 27;
  const [y, m, d] = date.split('-').map(Number);
  let cy = y, cm = m;
  const lastDay = new Date(y, m, 0).getDate();
  if (d > Math.min(closing, lastDay)) { cm++; if (cm > 12) { cm = 1; cy++; } }
  // 締め月の翌月が引き落とし
  let py = cy, pm = cm + 1;
  if (pm > 12) { pm = 1; py++; }
  const pd = Math.min(payDay, new Date(py, pm, 0).getDate());
  return `${py}-${pad(pm)}-${pad(pd)}`;
}

// 指定日時点で未引き落としのカード利用額（引き落とし日ごと）
export function cardUnpaid(state, acc, asOf) {
  const byPay = new Map();
  for (const t of txOf(state, acc.id)) {
    if (t.date > asOf) continue;
    const p = cardPayDate(acc, t.date);
    if (p <= asOf) continue;
    byPay.set(p, (byPay.get(p) || 0) - t.amount);
  }
  const schedule = [...byPay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, amount]) => ({ date, amount }));
  return { total: sum(schedule, (s) => s.amount), schedule };
}

export function netWorth(state, asOf) {
  const parts = { cash: 0, card: 0, invest: 0, points: 0 };
  for (const a of state.accounts) {
    if (a.archived) continue;
    parts[ACCOUNT_TYPES[a.type]?.group || 'cash'] += balanceYen(state, a, asOf);
  }
  return { ...parts, total: parts.cash + parts.card + parts.invest + parts.points };
}

export function netWorthHistory(state, months, endYm) {
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const ym = addMonths(endYm, -i);
    const end = `${ym}-${pad(daysInMonth(ym))}`;
    out.push({ ym, ...netWorth(state, end) });
  }
  return out;
}

// 投資の元本と評価額
export function investSummary(state) {
  let value = 0, cost = 0;
  for (const a of state.accounts.filter((x) => x.type === 'securities' && !x.archived)) {
    const snaps = snapsOf(state, a.id);
    const s = snaps[snaps.length - 1];
    if (!s) continue;
    value += s.value;
    cost += s.cost ?? s.value;
  }
  return { value, cost, gain: value - cost };
}

// ---------- 月次集計 ----------

export function monthTx(state, ym) {
  return state.tx.filter((t) => t.date.startsWith(ym) && counted(t));
}

export function summarize(txs) {
  let income = 0, expense = 0;
  const byCat = new Map();
  for (const t of txs) {
    if (t.kind === 'income') income += t.amount;
    else if (t.kind === 'expense') {
      expense -= t.amount;
      byCat.set(t.category, (byCat.get(t.category) || 0) - t.amount);
    }
  }
  const cats = [...byCat.entries()].map(([name, amount]) => ({ name, amount })).filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount);
  return { income, expense, balance: income - expense, cats };
}

export function monthlySeries(state, months, endYm) {
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const ym = addMonths(endYm, -i);
    out.push({ ym, ...summarize(monthTx(state, ym)) });
  }
  return out;
}

// 直近 n か月（今月を除く、データのある月のみ）の平均
export function averageMonthly(state, n = 3, fromYm) {
  const months = [];
  for (let i = 1; i <= n; i++) {
    const ym = addMonths(fromYm, -i);
    const txs = monthTx(state, ym);
    if (txs.length) months.push(summarize(txs));
  }
  if (!months.length) return null;
  return {
    months: months.length,
    income: sum(months, (m) => m.income) / months.length,
    expense: sum(months, (m) => m.expense) / months.length,
  };
}

// ---------- 固定費・サブスクの検出 ----------

export function detectRecurring(state, endYm, lookback = 6) {
  const start = addMonths(endYm, -lookback + 1);
  const groups = new Map();
  for (const t of state.tx) {
    if (!counted(t) || t.kind !== 'expense' || t.amount >= 0) continue;
    const ym = monthKey(t.date);
    if (ym < start || ym > endYm) continue;
    const key = norm(t.payee).replace(/\d{3,}/g, '').slice(0, 24);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { key, payee: t.payee, category: t.category, months: new Map(), days: [] });
    const g = groups.get(key);
    g.months.set(ym, (g.months.get(ym) || 0) - t.amount);
    g.days.push(Number(t.date.slice(8, 10)));
  }
  const out = [];
  for (const g of groups.values()) {
    if (g.months.size < 3) continue;
    const vals = [...g.months.values()];
    const min = Math.min(...vals), max = Math.max(...vals);
    if (max > min * 1.6) continue; // 金額のブレが大きいものは除外（スーパー等）
    // 1か月に何回も使うお店は固定費ではない
    const perMonth = g.days.length / g.months.size;
    if (perMonth > 1.5) continue;
    const days = g.days.sort((a, b) => a - b);
    out.push({
      payee: g.payee,
      category: g.category,
      monthly: sum(vals) / vals.length,
      count: g.months.size,
      day: days[Math.floor(days.length / 2)],
      lastYm: [...g.months.keys()].sort().pop(),
    });
  }
  return out.sort((a, b) => b.monthly - a.monthly);
}

// ---------- 今月の見通し ----------

export function monthOutlook(state, todayIso) {
  const ym = todayIso.slice(0, 7);
  const day = Number(todayIso.slice(8, 10));
  const dim = daysInMonth(ym);
  const cur = summarize(monthTx(state, ym));
  const recurring = detectRecurring(state, addMonths(ym, -1));
  const paidKeys = new Set(monthTx(state, ym).filter((t) => t.kind === 'expense').map((t) => norm(t.payee).replace(/\d{3,}/g, '').slice(0, 24)));
  const upcomingFixed = recurring.filter((r) => !paidKeys.has(norm(r.payee).replace(/\d{3,}/g, '').slice(0, 24)) && r.day > day);
  const fixedTotal = sum(recurring, (r) => r.monthly);
  const avg = averageMonthly(state, 3, ym);
  // 変動費の1日あたり：過去平均があればそれを、なければ今月のペース
  const variableDaily = avg
    ? Math.max(0, avg.expense - fixedTotal) / 30
    : day > 0 ? cur.expense / day : 0;
  const remainingDays = dim - day;
  const projectedExpense = cur.expense + sum(upcomingFixed, (r) => r.monthly) + variableDaily * remainingDays;

  const plan = state.plan || {};
  const salaryReceived = monthTx(state, ym).some((t) => t.kind === 'income' && t.category === '給与');
  let expectedIncome = 0;
  if (plan.salary && !salaryReceived) expectedIncome += plan.salary;
  const month = Number(ym.slice(5));
  if (plan.bonus && (plan.bonusMonths || []).includes(month) && !monthTx(state, ym).some((t) => t.category === '賞与')) expectedIncome += plan.bonus;
  const projectedIncome = cur.income + expectedIncome;

  // 予算の残り（1日あたり）
  const budgetTotal = sum(Object.values(state.budgets || {}), (v) => Number(v) || 0);
  return {
    ym, day, dim, remainingDays,
    ...cur,
    projectedExpense,
    projectedIncome,
    projectedBalance: projectedIncome - projectedExpense,
    upcomingFixed,
    budgetTotal,
    perDayLeft: budgetTotal ? Math.max(0, budgetTotal - cur.expense) / Math.max(1, remainingDays + 1) : null,
  };
}

// ---------- 将来シミュレーション ----------

export function simulate(plan, start) {
  const months = Math.max(1, Math.round((plan.years || 10) * 12));
  const r = Math.pow(1 + (Number(plan.returnRate) || 0) / 100, 1 / 12) - 1;
  const g = (Number(plan.salaryGrowth) || 0) / 100;
  let cash = start.cash;
  let invest = start.invest;
  let principal = start.investCost ?? start.invest;
  const other = start.other || 0;
  const living = Number(plan.living) || 0;
  const events = new Map();
  for (const e of plan.events || []) events.set(e.ym, (events.get(e.ym) || 0) + Number(e.amount || 0));
  const rows = [];
  let ym = start.ym;
  const firstYear = Number(start.ym.slice(0, 4));
  rows.push({ ym, cash, invest, principal, total: cash + invest + other });
  for (let i = 1; i <= months; i++) {
    ym = addMonths(ym, 1);
    const yearIdx = Number(ym.slice(0, 4)) - firstYear;
    const growth = Math.pow(1 + g, yearIdx);
    const month = Number(ym.slice(5));
    let income = (Number(plan.salary) || 0) * growth;
    if ((plan.bonusMonths || []).includes(month)) income += (Number(plan.bonus) || 0) * growth;
    const contrib = Number(plan.invest) || 0;
    invest = invest * (1 + r) + contrib;
    principal += contrib;
    cash += income - living - contrib + (events.get(ym) || 0);
    rows.push({ ym, cash, invest, principal, total: cash + invest + other });
  }
  return rows;
}
