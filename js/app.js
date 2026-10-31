import { state, load, saveKV, putTx, deleteTx, exportAll, importAll, wipe, defaultPlan } from './db.js';
import { decode, parseCSV, toCSV } from './csv.js';
import { isPayPay, parsePayPay, guessMapping, parseGeneric, assignExtIds, findHeaderRow } from './importers.js';
import { categorize, KINDS, defaultRules } from './rules.js';
import {
  ACCOUNT_TYPES, isValuationType, balanceAt, balanceYen, toYen, cardUnpaid, netWorth, netWorthHistory,
  investSummary, monthTx, summarize, monthlySeries, averageMonthly, detectRecurring, monthOutlook, simulate,
} from './finance.js';
import { donut, incomeExpenseBars, lines, legend } from './charts.js';
import { uid, yen, man, today, thisMonth, addMonths, ymLabel, esc, norm, sum, groupBy, parseAmount, daysInMonth, pad } from './util.js';
import { loadSample } from './sample.js';
import { fetchSync, processSync, findNearDup, guessAccount } from './sync.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const ui = {
  tab: 'home',
  ym: thisMonth(),
  txFilter: { q: '', account: '', category: '', uncategorized: false },
  anaYm: thisMonth(),
};

// ---------- 共通 ----------

const accById = (id) => state.accounts.find((a) => a.id === id);
const catColor = (name) => state.categories.find((c) => c.name === name)?.color || '#a8a8a8';
const catsOf = (kind) => state.categories.filter((c) => c.kind === kind);
const activeAccounts = () => state.accounts.filter((a) => !a.archived);
const unitOf = (a) => (a.type === 'points' ? a.unit || 'pt' : '円');
const fmtUnit = (a, v) => (a.type === 'points' ? `${Math.round(v).toLocaleString('ja-JP')} ${unitOf(a)}` : yen(v));

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

function openSheet(title, html, onMount) {
  const s = $('#sheet');
  s.innerHTML = `<div class="sheet-backdrop" data-act="close-sheet"></div>
    <div class="sheet-panel" role="dialog" aria-modal="true">
      <div class="sheet-head"><button class="link" data-act="close-sheet">閉じる</button><h2>${esc(title)}</h2><span></span></div>
      <div class="sheet-body">${html}</div>
    </div>`;
  s.classList.add('open');
  document.body.classList.add('noscroll');
  onMount?.($('.sheet-body', s));
}

function closeSheet() {
  const s = $('#sheet');
  s.classList.remove('open');
  s.innerHTML = '';
  document.body.classList.remove('noscroll');
}

function nextPayday(plan, iso = today()) {
  const day = plan.payday || 25;
  let ym = iso.slice(0, 7);
  let d = `${ym}-${pad(Math.min(day, daysInMonth(ym)))}`;
  if (d < iso) { ym = addMonths(ym, 1); d = `${ym}-${pad(Math.min(day, daysInMonth(ym)))}`; }
  const diff = Math.round((new Date(d) - new Date(iso)) / 86400000);
  return { date: d, days: diff };
}

function monthNav(key) {
  return `<div class="month-nav">
    <button class="icon-btn" data-act="month" data-key="${key}" data-d="-1" aria-label="前月">‹</button>
    <strong>${ymLabel(ui[key])}</strong>
    <button class="icon-btn" data-act="month" data-key="${key}" data-d="1" aria-label="翌月" ${ui[key] >= thisMonth() ? 'disabled' : ''}>›</button>
  </div>`;
}

function amountClass(t) {
  if (t.kind === 'transfer') return 'amt transfer';
  return t.amount >= 0 ? 'amt plus' : 'amt minus';
}

function txRow(t) {
  const a = accById(t.accountId);
  return `<li class="tx${t.excluded ? ' excluded' : ''}" data-act="edit-tx" data-id="${t.id}">
    <span class="dot" style="background:${catColor(t.category)}"></span>
    <div class="tx-main">
      <div class="tx-payee">${esc(t.payee || t.content || '(内容なし)')}</div>
      <div class="tx-sub"><span class="chip">${esc(t.category || '未分類')}</span>${esc(a?.name || '')}${t.memo ? ' · ' + esc(t.memo) : ''}</div>
    </div>
    <div class="${amountClass(t)}">${yen(t.amount, { sign: true })}</div>
  </li>`;
}

// ---------- 描画 ----------

const TABS = {
  home: { label: 'ホーム', icon: '<path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>' },
  tx: { label: '明細', icon: '<path d="M4 5h16M4 12h16M4 19h10"/>' },
  analysis: { label: '分析', icon: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>' },
  future: { label: '将来', icon: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>' },
  settings: { label: '設定', icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>' },
};

function renderNav() {
  $('#nav').innerHTML = Object.entries(TABS).map(([k, t]) =>
    `<button class="${ui.tab === k ? 'active' : ''}" data-act="tab" data-tab="${k}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${t.icon}</svg>
      <span>${t.label}</span></button>`).join('');
}

function render() {
  renderNav();
  $('#title').textContent = ui.tab === 'home' ? 'おかねナビ' : TABS[ui.tab].label;
  const v = $('#view');
  v.innerHTML = VIEWS[ui.tab]();
  MOUNT[ui.tab]?.(v);
}

// ---------- ホーム ----------

function viewHome() {
  if (!state.accounts.length) return viewWelcome();
  const now = today();
  const nw = netWorth(state, now);
  const hist = netWorthHistory(state, 12, thisMonth());
  const o = monthOutlook(state, now);
  const pd = nextPayday(state.plan, now);
  const unc = state.tx.filter((t) => t.category === '未分類' && !t.excluded).length;
  const alerts = [];
  const sy = state.sync;
  if (sy.lastResult?.error) alerts.push(`<button class="alert warn" data-act="goto-sync">自動連携でエラー：${esc(sy.lastResult.error)} →</button>`);
  if (sy.pending.length) alerts.push(`<button class="alert" data-act="goto-sync">自動連携：口座が決まっていない取引が <b>${sy.pending.length}件</b> あります →</button>`);
  for (const n of sy.notices) alerts.push(`<div class="alert row-between"><button class="link-plain" data-act="notice" data-id="${esc(n.id)}">${esc(n.label)}：${Number(n.date.slice(5, 7))}/${Number(n.date.slice(8))} ${esc(n.text)}。<b>金額を記録 →</b></button><button class="icon-btn" data-act="notice-dismiss" data-id="${esc(n.id)}" aria-label="閉じる">×</button></div>`);
  if (unc) alerts.push(`<button class="alert" data-act="goto-uncategorized">未分類の取引が <b>${unc}件</b> あります →</button>`);
  for (const s of expiringPoints()) alerts.push(`<div class="alert warn">${esc(s.acc.name)}：${Math.round(s.value).toLocaleString()}${esc(unitOf(s.acc))} が ${s.expiry} に失効予定</div>`);
  const lastBackup = state.meta.lastBackup;
  if (state.tx.length && (!lastBackup || (Date.now() - new Date(lastBackup)) / 86400000 > 30)) {
    alerts.push(`<button class="alert" data-act="backup">データはこのiPhoneの中だけに保存されています。バックアップしましょう →</button>`);
  }
  if (!state.plan.salary) alerts.push(`<button class="alert" data-act="tab" data-tab="future">「将来」で給料を設定すると、月末の見込みが出せます →</button>`);

  const cards = activeAccounts().filter((a) => a.type === 'card').map((a) => ({ a, u: cardUnpaid(state, a, now) })).filter((x) => x.u.schedule.length);
  const sm = o.cats.slice(0, 6);
  const others = sum(o.cats.slice(6), (c) => c.amount);
  const donutItems = [...sm.map((c) => ({ value: c.amount, color: catColor(c.name) })), ...(others ? [{ value: others, color: '#c8c8c8' }] : [])];

  return `
  ${alerts.join('')}
  <section class="card hero">
    <div class="label">純資産</div>
    <div class="big">${yen(nw.total)}</div>
    <div class="breakdown">
      <span>預金・現金 <b>${yen(nw.cash)}</b></span>
      <span>投資 <b>${yen(nw.invest)}</b></span>
      <span>ポイント <b>${yen(nw.points)}</b></span>
      <span>カード未払 <b class="neg">${yen(nw.card)}</b></span>
    </div>
    ${lines([{ color: '#c4d700', values: hist.map((h) => h.total) }], hist.map((h) => h.ym), { height: 120, area: true, fmtLabel: (l) => Number(l.slice(5)) + '月' })}
  </section>

  <section class="card">
    <div class="row-between"><h3>${Number(o.ym.slice(5))}月の収支</h3><span class="muted">給料日まであと${pd.days}日</span></div>
    <div class="stats3">
      <div><div class="label">収入</div><div class="plus">${yen(o.income)}</div></div>
      <div><div class="label">支出</div><div class="minus">${yen(o.expense)}</div></div>
      <div><div class="label">収支</div><div class="${o.balance >= 0 ? 'plus' : 'minus'}">${yen(o.balance, { sign: true })}</div></div>
    </div>
    <div class="outlook">
      <div>月末の見込み：収入 ${yen(o.projectedIncome)} − 支出 ${yen(o.projectedExpense)} = <b class="${o.projectedBalance >= 0 ? 'plus' : 'minus'}">${yen(o.projectedBalance, { sign: true })}</b></div>
      ${o.perDayLeft != null ? `<div>予算の残りは <b>1日あたり ${yen(o.perDayLeft)}</b>（${o.remainingDays + 1}日間）</div>` : ''}
    </div>
    <div class="donut-wrap">
      ${donut(donutItems, { center: yen(o.expense), sub: '今月の支出' })}
      <ul class="cat-list">${sm.map((c) => `<li><i style="background:${catColor(c.name)}"></i>${esc(c.name)}<b>${yen(c.amount)}</b></li>`).join('') || '<li class="muted">まだ支出がありません</li>'}</ul>
    </div>
    ${budgetBars(o.ym)}
  </section>

  ${futureCard()}

  ${cards.length || o.upcomingFixed.length || sy.scheduled.length ? `<section class="card">
    <h3>これからの引き落とし</h3>
    <ul class="simple">
      ${cards.flatMap((x) => x.u.schedule.map((s) => `<li><span>${s.date.slice(5).replace('-', '/')} ${esc(x.a.name)}</span><b class="minus">${yen(s.amount)}</b></li>`)).join('')}
      ${sy.scheduled.map((x) => `<li><span>${x.date.slice(5).replace('-', '/')} ${esc(x.payee)} <small class="muted">${esc(x.label)}から引落予定</small></span><b class="minus">${yen(-x.amount)}</b></li>`).join('')}
      ${o.upcomingFixed.map((r) => `<li><span>${r.day}日頃 ${esc(r.payee)} <small class="muted">固定費</small></span><b class="minus">${yen(r.monthly)}</b></li>`).join('')}
    </ul>
  </section>` : ''}

  <section class="card">
    <div class="row-between"><h3>口座</h3><button class="link" data-act="add-account">＋追加</button></div>
    ${accountGroups()}
  </section>`;
}

function accountGroups() {
  const now = today();
  return Object.entries(ACCOUNT_TYPES).map(([type, info]) => {
    const accs = activeAccounts().filter((a) => a.type === type);
    if (!accs.length) return '';
    return `<div class="acc-group"><div class="label">${info.icon} ${info.label}</div>
      <ul class="simple">${accs.map((a) => {
        const v = balanceAt(state, a, now);
        const sub = a.type === 'points' ? `<small class="muted">≈${yen(toYen(a, v))}</small>` : a.type === 'card' ? '<small class="muted">未払い</small>' : '';
        return `<li data-act="account" data-id="${a.id}" class="tap"><span>${esc(a.name)}</span><span class="right"><b class="${v < 0 ? 'minus' : ''}">${fmtUnit(a, v)}</b>${sub}</span></li>`;
      }).join('')}</ul></div>`;
  }).join('');
}

function budgetBars(ym) {
  const entries = Object.entries(state.budgets || {}).filter(([, v]) => Number(v) > 0);
  if (!entries.length) return '';
  const s = summarize(monthTx(state, ym));
  const spent = new Map(s.cats.map((c) => [c.name, c.amount]));
  const ratio = Number(ym === thisMonth() ? today().slice(8) : daysInMonth(ym)) / daysInMonth(ym);
  return `<div class="budgets"><div class="label">予算</div>${entries.map(([name, b]) => {
    const used = spent.get(name) || 0;
    const p = used / b;
    const cls = p > 1 ? 'over' : p > ratio + 0.1 ? 'warn' : '';
    return `<div class="budget"><div class="row-between"><span>${esc(name)}</span><span>${yen(used)} / ${yen(b)}</span></div>
      <div class="bar ${cls}"><i style="width:${Math.min(100, p * 100)}%"></i><em style="left:${ratio * 100}%"></em></div></div>`;
  }).join('')}</div>`;
}

function expiringPoints() {
  const limit = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  const out = [];
  for (const a of activeAccounts().filter((x) => x.type === 'points')) {
    const snaps = state.snapshots.filter((s) => s.accountId === a.id).sort((x, y) => x.date.localeCompare(y.date));
    const s = snaps[snaps.length - 1];
    if (s?.expiry && s.expiry <= limit && s.expiry >= today() && s.expiringValue) out.push({ acc: a, value: s.expiringValue, expiry: s.expiry });
  }
  return out;
}

function viewWelcome() {
  return `<section class="card welcome">
    <h2>ようこそ 👋</h2>
    <p>銀行・カード・PayPay・証券・ポイントのお金の動きを、このiPhoneの中だけでまとめて管理します。データは外部に送信されません。</p>
    <ol>
      <li><b>口座を登録</b>（銀行、PayPay、カード、証券、マイル・ポイント）</li>
      <li><b>明細CSVを取り込む</b>（PayPayアプリ・ネットバンク・カード会社サイトからダウンロード）</li>
      <li><b>給料と積立を設定</b>して将来の見通しを確認</li>
    </ol>
    <button class="btn primary" data-act="quick-setup">よく使う口座をまとめて登録</button>
    <button class="btn" data-act="add-account">口座を1つずつ追加</button>
    <button class="btn ghost" data-act="sample">サンプルデータで試してみる</button>
  </section>`;
}

// ---------- 明細 ----------

function filteredTx() {
  const f = ui.txFilter;
  const q = norm(f.q);
  return state.tx.filter((t) => {
    if (!q && !f.uncategorized && !t.date.startsWith(ui.ym)) return false;
    if (f.account && t.accountId !== f.account) return false;
    if (f.category && t.category !== f.category) return false;
    if (f.uncategorized && t.category !== '未分類') return false;
    if (q && !norm([t.payee, t.content, t.memo, t.category].join(' ')).includes(q)) return false;
    return true;
  }).sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
}

function viewTx() {
  const f = ui.txFilter;
  const list = filteredTx();
  const s = summarize(list);
  const shown = list.slice(0, 500);
  const byDate = groupBy(shown, (t) => t.date);
  return `
  <div class="toolbar">
    <button class="btn primary small" data-act="import">取り込み</button>
    <button class="btn small" data-act="new-tx">＋手入力</button>
  </div>
  ${f.q || f.uncategorized ? `<div class="muted center">全期間から検索中</div>` : monthNav('ym')}
  <div class="filters">
    <input type="search" id="q" placeholder="お店・メモで検索" value="${esc(f.q)}">
    <select id="f-acc"><option value="">すべての口座</option>${state.accounts.map((a) => `<option value="${a.id}" ${f.account === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
    <select id="f-cat"><option value="">すべての分類</option>${Object.entries(KINDS).map(([k, l]) => `<optgroup label="${l}">${catsOf(k).map((c) => `<option ${f.category === c.name ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`).join('')}</select>
    <label class="check"><input type="checkbox" id="f-unc" ${f.uncategorized ? 'checked' : ''}> 未分類のみ</label>
  </div>
  <div class="stats3 compact">
    <div><div class="label">収入</div><div class="plus">${yen(s.income)}</div></div>
    <div><div class="label">支出</div><div class="minus">${yen(s.expense)}</div></div>
    <div><div class="label">件数</div><div>${list.length}件</div></div>
  </div>
  ${list.length ? [...byDate.entries()].map(([d, txs]) => `<div class="date-head">${Number(d.slice(5, 7))}月${Number(d.slice(8))}日（${'日月火水木金土'[new Date(d + 'T00:00').getDay()]}）</div><ul class="tx-list">${txs.map(txRow).join('')}</ul>`).join('') : `<div class="empty">取引がありません<br><button class="btn small" data-act="import">明細を取り込む</button></div>`}
  ${list.length > shown.length ? `<div class="muted center">ほか ${list.length - shown.length}件（検索で絞り込んでください）</div>` : ''}`;
}

function mountTx(v) {
  const f = ui.txFilter;
  let timer;
  $('#q', v).addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { f.q = e.target.value; render(); const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 300);
  });
  $('#f-acc', v).onchange = (e) => { f.account = e.target.value; render(); };
  $('#f-cat', v).onchange = (e) => { f.category = e.target.value; render(); };
  $('#f-unc', v).onchange = (e) => { f.uncategorized = e.target.checked; render(); };
}

function editTx(t, preset = null, onSaved = null) {
  const isNew = !t;
  t = t ? { ...t } : { id: uid(), date: today(), amount: 0, kind: 'expense', category: '未分類', accountId: activeAccounts().find((a) => !isValuationType(a.type))?.id, payee: '', memo: '', source: 'manual', ...preset };
  const orig = { ...t };
  const html = `<form id="txf" class="form">
    <div class="seg" id="kind">${Object.entries(KINDS).map(([k, l]) => `<button type="button" data-k="${k}" class="${t.kind === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <label>金額<div class="amount-in"><select id="dir"><option value="-1">出金</option><option value="1">入金</option></select><input id="amt" inputmode="numeric" value="${t.amount ? Math.abs(t.amount) : ''}" placeholder="0" required></div></label>
    <label>分類<select id="cat"></select></label>
    <label>日付<input type="date" id="date" value="${t.date}" required></label>
    <label>口座<select id="acc">${state.accounts.map((a) => `<option value="${a.id}" ${a.id === t.accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
    <label>お店・内容<input id="payee" value="${esc(t.payee)}"></label>
    <label>メモ<input id="memo" value="${esc(t.memo || '')}"></label>
    ${t.content && t.content !== t.payee ? `<div class="muted">明細の内容：${esc(t.content)}${t.method ? ' / ' + esc(t.method) : ''}</div>` : ''}
    <label class="check"><input type="checkbox" id="excl" ${t.excluded ? 'checked' : ''}> 集計から除外する（重複など）</label>
    ${!isNew ? `<label class="check"><input type="checkbox" id="learn" checked> 同じお店の取引にも適用し、次回から自動分類する</label>` : ''}
    <button class="btn primary" type="submit">保存</button>
    ${!isNew ? '<button class="btn danger" type="button" id="del">この取引を削除</button>' : ''}
  </form>`;
  openSheet(isNew ? '取引を追加' : '取引を編集', html, (b) => {
    const dir = $('#dir', b);
    dir.value = t.amount > 0 || (!t.amount && t.kind === 'income') ? '1' : '-1';
    const fillCats = () => {
      $('#cat', b).innerHTML = catsOf(t.kind).map((c) => `<option ${c.name === t.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    };
    fillCats();
    $('#kind', b).onclick = (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      t.kind = k;
      $$('#kind button', b).forEach((x) => x.classList.toggle('on', x.dataset.k === k));
      if (k === 'income') dir.value = '1';
      if (k === 'expense') dir.value = '-1';
      t.category = catsOf(k)[0]?.name;
      fillCats();
    };
    $('#del', b)?.addEventListener('click', async () => {
      if (!confirm('削除しますか？')) return;
      await deleteTx(t.id);
      closeSheet(); render(); toast('削除しました');
    });
    $('#txf', b).onsubmit = async (e) => {
      e.preventDefault();
      const v = parseAmount($('#amt', b).value);
      if (v == null) return toast('金額を入力してください');
      t.amount = Math.abs(v) * Number(dir.value);
      t.category = $('#cat', b).value;
      t.date = $('#date', b).value;
      t.accountId = $('#acc', b).value;
      t.payee = $('#payee', b).value.trim();
      t.memo = $('#memo', b).value.trim();
      t.excluded = $('#excl', b).checked;
      const catChanged = t.category !== orig.category || t.kind !== orig.kind;
      if (catChanged) t.userSet = true;
      const updates = [t];
      if (!isNew && catChanged && $('#learn', b)?.checked && t.payee) {
        const key = norm(t.payee);
        for (const x of state.tx) {
          if (x.id !== t.id && norm(x.payee) === key && !x.userSet) updates.push({ ...x, kind: t.kind, category: t.category });
        }
        addRule(t.payee, t.kind, t.category);
        await saveKV('rules');
      }
      await putTx(updates);
      await onSaved?.();
      closeSheet(); render();
      toast(updates.length > 1 ? `${updates.length}件を「${t.category}」にしました` : '保存しました');
    };
  });
}

function addRule(keyword, kind, category, accountTypes = null) {
  const k = norm(keyword);
  state.rules = state.rules.filter((r) => !(r.builtin === false && norm(r.keyword) === k));
  state.rules.unshift({ id: uid(), keyword, kind, category, accountTypes, builtin: false });
}

// ---------- 取り込み ----------

function importSheet(presetAccountId) {
  const accs = activeAccounts();
  if (!accs.length) { toast('先に口座を追加してください'); return addAccount(); }
  const html = `<div class="form">
    <label>取り込み先の口座<select id="imp-acc">${accs.map((a) => `<option value="${a.id}" ${a.id === presetAccountId ? 'selected' : ''}>${ACCOUNT_TYPES[a.type].icon} ${esc(a.name)}</option>`).join('')}</select></label>
    <label class="file-btn btn primary">CSVファイルを選ぶ<input type="file" id="imp-file" accept=".csv,.txt,.tsv,text/csv,text/plain" hidden></label>
    <div id="imp-body"></div>
    <details class="help"><summary>明細CSVのダウンロード方法</summary>
      <p><b>PayPay</b>：PayPayアプリ → 「アカウント」→「取引履歴」→ 右上の「⋯」または「ダウンロード」→ 期間を選んでCSVを保存（「ファイル」アプリに保存）。</p>
      <p><b>銀行</b>：各ネットバンキングの「入出金明細」→「CSVダウンロード」。</p>
      <p><b>カード</b>：カード会社の会員サイト → 「ご利用明細」→「CSVダウンロード」。</p>
      <p><b>証券</b>：評価額は口座画面の「評価額を記録」で入力します（積立は銀行明細の振替として自動判定）。</p>
      <p>同じファイルを2回取り込んでも、重複分は自動でスキップされます。</p>
    </details>
  </div>`;
  openSheet('明細の取り込み', html, (b) => {
    $('#imp-file', b).onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = decode(await file.arrayBuffer());
      const rows = parseCSV(text);
      if (!rows.length) return toast('読み込めませんでした');
      const acc = accById($('#imp-acc', b).value);
      if (isPayPay(rows[findHeaderRow(rows)] || [])) importPayPayUI(b, acc, rows);
      else importGenericUI(b, acc, rows, file.name);
    };
  });
}

function prepare(list, acc) {
  for (const t of list) {
    t.id = uid();
    t.accountId = t.accountId || acc.id;
    if (!t.locked) {
      const fallback = t.kind;
      t.kind = null; t.category = null;
      categorize(t, state.rules, accById(t.accountId)?.type, fallback);
    }
    delete t.locked;
    delete t.bucket;
  }
  return list;
}

function importSummary(list) {
  const existing = new Set(state.tx.map((t) => t.extId).filter(Boolean));
  const used = new Set();
  const auto = state.tx.filter((t) => t.source === 'mail' || t.source === 'shortcut');
  // 自動連携で入っている取引と同じものは重複として扱う
  const fresh = list.filter((t) => {
    if (existing.has(t.extId)) return false;
    const d = findNearDup(auto, t, used);
    if (d) { used.add(d.id); return false; }
    return true;
  });
  const dates = list.map((t) => t.date).sort();
  return { fresh, dup: list.length - fresh.length, from: dates[0], to: dates[dates.length - 1] };
}

function previewTable(list) {
  return `<ul class="tx-list preview">${list.slice(0, 6).map((t) => `<li class="tx"><div class="tx-main"><div class="tx-payee">${esc(t.payee || '')}</div><div class="tx-sub">${t.date} <span class="chip">${esc(t.category || '')}</span></div></div><div class="${amountClass(t)}">${yen(t.amount, { sign: true })}</div></li>`).join('')}</ul>`;
}

async function commitImport(list, accIds) {
  const s = importSummary(list);
  await putTx(s.fresh);
  for (const id of accIds) {
    const a = accById(id);
    if (a) a.lastImport = today();
  }
  await saveKV('accounts');
  const unc = s.fresh.filter((t) => t.category === '未分類').length;
  closeSheet();
  ui.tab = 'tx';
  if (s.to) ui.ym = s.to.slice(0, 7);
  render();
  toast(`${s.fresh.length}件を取り込みました${s.dup ? `（重複${s.dup}件はスキップ）` : ''}${unc ? `。未分類${unc}件` : ''}`);
}

function importPayPayUI(b, acc, rows) {
  const all = parsePayPay(rows);
  const buckets = groupBy(all, (t) => t.bucket);
  const cards = activeAccounts().filter((a) => a.type === 'card');
  const pointsAccs = activeAccounts().filter((a) => a.type === 'points');
  const nCard = buckets.get('card')?.length || 0;
  const nPts = buckets.get('points')?.length || 0;
  const body = $('#imp-body', b);
  body.innerHTML = `<div class="notice">PayPayの取引履歴として認識しました（${all.length}件）</div>
    ${acc.type !== 'paypay' ? `<div class="notice warn">取り込み先が「${esc(acc.name)}」になっています。PayPay用の口座を選ぶのがおすすめです。</div>` : ''}
    ${nCard ? `<label>クレジットカード払いの ${nCard}件
      <select id="pp-card"><option value="">取り込まない（カード明細を別に取り込む場合）</option>${cards.map((a) => `<option value="${a.id}">「${esc(a.name)}」の利用として取り込む</option>`).join('')}</select></label>` : ''}
    ${nPts ? `<label>ポイントだけで払った ${nPts}件
      <select id="pp-pts"><option value="">取り込まない</option><option value="paypay">PayPay口座の支出として取り込む</option>${pointsAccs.map((a) => `<option value="${a.id}">「${esc(a.name)}」から取り込む</option>`).join('')}</select></label>` : ''}
    <div id="pp-sum"></div>`;
  const build = () => {
    const cardAcc = $('#pp-card', body)?.value || '';
    const ptsSel = $('#pp-pts', body)?.value || '';
    const list = [];
    for (const t0 of all) {
      const t = { ...t0 };
      if (t.bucket === 'card') { if (!cardAcc) continue; t.accountId = cardAcc; t.extId += ':card'; }
      else if (t.bucket === 'points') { if (!ptsSel) continue; t.accountId = ptsSel === 'paypay' ? acc.id : ptsSel; }
      else t.accountId = acc.id;
      list.push(t);
    }
    assignExtIds(list, acc.id);
    return prepare(list, acc);
  };
  const refresh = () => {
    const list = build();
    const s = importSummary(list);
    $('#pp-sum', body).innerHTML = `<div class="notice">新規 <b>${s.fresh.length}件</b>${s.dup ? `／重複 ${s.dup}件（スキップ）` : ''}<br>${s.from || ''} 〜 ${s.to || ''}</div>
      ${previewTable(s.fresh)}
      <button class="btn primary" id="pp-go" ${s.fresh.length ? '' : 'disabled'}>${s.fresh.length}件を取り込む</button>`;
    $('#pp-go', body).onclick = () => commitImport(list, [acc.id]);
  };
  body.onchange = refresh;
  refresh();
}

function importGenericUI(b, acc, rows, fileName) {
  const g = guessMapping(rows, acc.type);
  const sig = g.header.join('|');
  const m = acc.importMapping?.sig === sig ? { ...acc.importMapping.m } : g.mapping;
  const opts = (sel) => `<option value="-1">（なし）</option>` + g.header.map((h, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(h || `列${i + 1}`)}</option>`).join('');
  const body = $('#imp-body', b);
  body.innerHTML = `<div class="notice">${esc(fileName)}：${rows.length - m.headerRow - 1}行。列の割り当てを確認してください。</div>
    <div class="grid2">
      <label>日付の列<select id="m-date">${opts(m.date)}</select></label>
      <label>金額の形式<select id="m-mode"><option value="split" ${m.mode === 'split' ? 'selected' : ''}>出金と入金が別の列</option><option value="signed" ${m.mode === 'signed' ? 'selected' : ''}>1つの列（±あり）</option></select></label>
      <label class="m-split">出金（支払）の列<select id="m-out">${opts(m.out)}</select></label>
      <label class="m-split">入金の列<select id="m-in">${opts(m.in)}</select></label>
      <label class="m-signed">金額の列<select id="m-amt">${opts(m.amount)}</select></label>
      <label class="m-signed check"><input type="checkbox" id="m-inv" ${m.invert ? 'checked' : ''}> プラスを支出として扱う（カード明細）</label>
      <label>内容の列<select id="m-desc">${opts(m.desc[0] ?? -1)}</select></label>
      <label>内容の列（追加）<select id="m-desc2">${opts(m.desc[1] ?? -1)}</select></label>
    </div>
    <div id="g-sum"></div>`;
  const read = () => {
    m.date = Number($('#m-date', body).value);
    m.mode = $('#m-mode', body).value;
    m.out = Number($('#m-out', body).value);
    m.in = Number($('#m-in', body).value);
    m.amount = Number($('#m-amt', body).value);
    m.invert = $('#m-inv', body).checked;
    m.desc = [Number($('#m-desc', body).value), Number($('#m-desc2', body).value)].filter((x) => x >= 0);
    $$('.m-split', body).forEach((x) => (x.style.display = m.mode === 'split' ? '' : 'none'));
    $$('.m-signed', body).forEach((x) => (x.style.display = m.mode === 'signed' ? '' : 'none'));
  };
  const refresh = () => {
    read();
    const list = prepare(assignExtIds(parseGeneric(rows, m), acc.id), acc);
    const s = importSummary(list);
    $('#g-sum', body).innerHTML = `<div class="notice">新規 <b>${s.fresh.length}件</b>${s.dup ? `／重複 ${s.dup}件（スキップ）` : ''}${s.from ? `<br>${s.from} 〜 ${s.to}` : ''}</div>
      ${previewTable(s.fresh)}
      <p class="muted">プラス（緑）が入金、マイナスが出金になっていればOKです。</p>
      <button class="btn primary" id="g-go" ${s.fresh.length ? '' : 'disabled'}>${s.fresh.length}件を取り込む</button>`;
    $('#g-go', body).onclick = async () => {
      acc.importMapping = { sig, m: { ...m } };
      await commitImport(list, [acc.id]);
    };
  };
  body.onchange = refresh;
  refresh();
}

// ---------- 口座 ----------

const QUICK = [
  { name: 'メイン銀行', type: 'bank' },
  { name: 'PayPay', type: 'paypay' },
  { name: 'PayPayカード', type: 'card', closingDay: 31, payDay: 27 },
  { name: '証券口座', type: 'securities' },
  { name: 'ANAマイル', type: 'points', unit: 'マイル', rate: 1.5 },
  { name: 'Vポイント', type: 'points', unit: 'pt', rate: 1 },
  { name: '楽天ポイント', type: 'points', unit: 'pt', rate: 1 },
  { name: '現金', type: 'cash' },
];

function quickSetup() {
  const html = `<form class="form" id="qs">
    <p class="muted">登録する口座にチェックを入れ、名前を変えられます（あとで変更できます）。</p>
    ${QUICK.map((q, i) => `<div class="qs-row"><input type="checkbox" id="qs${i}" checked><span>${ACCOUNT_TYPES[q.type].icon}</span><input id="qn${i}" value="${esc(q.name)}"></div>`).join('')}
    <button class="btn primary">登録する</button></form>`;
  openSheet('口座をまとめて登録', html, (b) => {
    $('#qs', b).onsubmit = async (e) => {
      e.preventDefault();
      QUICK.forEach((q, i) => {
        if ($(`#qs${i}`, b).checked) state.accounts.push({ ...q, id: uid(), name: $(`#qn${i}`, b).value.trim() || q.name, opening: 0 });
      });
      await saveKV('accounts');
      closeSheet(); render();
      toast('登録しました。口座をタップして残高を合わせられます');
    };
  });
}

function addAccount(a) {
  const isNew = !a;
  a = a ? { ...a } : { id: uid(), name: '', type: 'bank', opening: 0 };
  const html = `<form class="form" id="accf">
    <label>種類<select id="a-type">${Object.entries(ACCOUNT_TYPES).map(([k, v]) => `<option value="${k}" ${a.type === k ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('')}</select></label>
    <label>名前<input id="a-name" value="${esc(a.name)}" placeholder="例：三井住友銀行" required></label>
    <div class="t-card grid2">
      <label>締め日<input id="a-close" inputmode="numeric" value="${a.closingDay ?? 31}"><small>月末は31</small></label>
      <label>引き落とし日（翌月）<input id="a-pay" inputmode="numeric" value="${a.payDay ?? 27}"></label>
    </div>
    <div class="t-points grid2">
      <label>単位<input id="a-unit" value="${esc(a.unit || 'pt')}"></label>
      <label>1${esc(a.unit || 'pt')}あたりの価値（円）<input id="a-rate" inputmode="decimal" value="${a.rate ?? 1}"></label>
    </div>
    <button class="btn primary">${isNew ? '追加' : '保存'}</button>
    ${!isNew ? `<button type="button" class="btn" id="a-arch">${a.archived ? '表示に戻す' : '非表示にする（解約など）'}</button>
      <button type="button" class="btn danger" id="a-del">口座と取引をすべて削除</button>` : ''}
  </form>`;
  openSheet(isNew ? '口座を追加' : '口座を編集', html, (b) => {
    const sync = () => {
      const t = $('#a-type', b).value;
      $('.t-card', b).style.display = t === 'card' ? '' : 'none';
      $('.t-points', b).style.display = t === 'points' ? '' : 'none';
    };
    $('#a-type', b).onchange = sync;
    sync();
    $('#accf', b).onsubmit = async (e) => {
      e.preventDefault();
      a.type = $('#a-type', b).value;
      a.name = $('#a-name', b).value.trim();
      if (a.type === 'card') { a.closingDay = Number($('#a-close', b).value) || 31; a.payDay = Number($('#a-pay', b).value) || 27; }
      if (a.type === 'points') { a.unit = $('#a-unit', b).value.trim() || 'pt'; a.rate = Number($('#a-rate', b).value) || 1; }
      const i = state.accounts.findIndex((x) => x.id === a.id);
      if (i >= 0) state.accounts[i] = a; else state.accounts.push(a);
      await saveKV('accounts');
      closeSheet(); render();
    };
    $('#a-arch', b)?.addEventListener('click', async () => {
      const x = accById(a.id); x.archived = !x.archived;
      await saveKV('accounts'); closeSheet(); render();
    });
    $('#a-del', b)?.addEventListener('click', async () => {
      const n = state.tx.filter((t) => t.accountId === a.id).length;
      if (!confirm(`「${a.name}」と取引${n}件を削除します。よろしいですか？`)) return;
      await deleteTx(state.tx.filter((t) => t.accountId === a.id).map((t) => t.id));
      state.accounts = state.accounts.filter((x) => x.id !== a.id);
      state.snapshots = state.snapshots.filter((s) => s.accountId !== a.id);
      await saveKV('accounts', 'snapshots');
      closeSheet(); render();
    });
  });
}

function accountSheet(id) {
  const a = accById(id);
  const now = today();
  const v = balanceAt(state, a, now);
  const txs = state.tx.filter((t) => t.accountId === id).sort((x, y) => y.date.localeCompare(x.date));
  const snaps = state.snapshots.filter((s) => s.accountId === id).sort((x, y) => y.date.localeCompare(x.date));
  const valuation = isValuationType(a.type);
  let extra = '';
  if (a.type === 'securities') {
    const s = snaps[0];
    if (s?.cost != null) extra = `<div class="muted">元本 ${yen(s.cost)} ／ 損益 <b class="${s.value - s.cost >= 0 ? 'plus' : 'minus'}">${yen(s.value - s.cost, { sign: true })}</b>（${s.cost ? (((s.value - s.cost) / s.cost) * 100).toFixed(1) : 0}%）</div>`;
  }
  if (a.type === 'card') {
    const u = cardUnpaid(state, a, now);
    extra = `<ul class="simple">${u.schedule.map((s) => `<li><span>${s.date} 引き落とし</span><b>${yen(s.amount)}</b></li>`).join('') || '<li class="muted">未払いはありません</li>'}</ul>`;
  }
  const snapLabel = a.type === 'securities' ? '評価額を記録' : a.type === 'points' ? '残高を記録' : a.type === 'card' ? '' : '残高を合わせる';
  const html = `<div class="acc-head"><div class="label">${ACCOUNT_TYPES[a.type].label}</div><div class="big">${fmtUnit(a, v)}</div>
      ${a.type === 'points' ? `<div class="muted">≈ ${yen(toYen(a, v))}（1${esc(unitOf(a))}=${a.rate}円）</div>` : ''}${extra}</div>
    <div class="toolbar">
      ${snapLabel ? `<button class="btn primary small" id="snap">${snapLabel}</button>` : ''}
      ${a.type !== 'points' ? `<button class="btn small" id="imp">明細を取り込む</button>` : ''}
      <button class="btn small" id="edit">口座を編集</button>
    </div>
    ${snaps.length ? `<h3>${valuation ? '記録の履歴' : '残高合わせの履歴'}</h3><ul class="simple">${snaps.slice(0, 24).map((s) => `<li><span>${s.date}${s.expiry ? ` <small class="muted">失効 ${s.expiry}: ${Number(s.expiringValue || 0).toLocaleString()}</small>` : ''}</span><span class="right"><b>${fmtUnit(a, s.value)}</b>${s.cost != null ? `<small class="muted">元本 ${yen(s.cost)}</small>` : ''}</span><button class="icon-btn" data-del-snap="${s.id}" aria-label="削除">×</button></li>`).join('')}</ul>` : ''}
    ${txs.length ? `<h3>取引（${txs.length}件）</h3><ul class="tx-list">${txs.slice(0, 50).map(txRow).join('')}</ul>` : ''}`;
  openSheet(a.name, html, (b) => {
    $('#snap', b)?.addEventListener('click', () => snapshotSheet(a, v));
    $('#imp', b)?.addEventListener('click', () => importSheet(a.id));
    $('#edit', b).onclick = () => addAccount(a);
    $$('[data-del-snap]', b).forEach((x) => (x.onclick = async (e) => {
      e.stopPropagation();
      state.snapshots = state.snapshots.filter((s) => s.id !== x.dataset.delSnap);
      await saveKV('snapshots'); accountSheet(id); render();
    }));
  });
}

function snapshotSheet(a, current) {
  const sec = a.type === 'securities', pts = a.type === 'points';
  const last = state.snapshots.filter((s) => s.accountId === a.id).sort((x, y) => y.date.localeCompare(x.date))[0];
  const html = `<form class="form" id="snf">
    ${!sec && !pts ? `<p class="muted">アプリや通帳に表示されている今の残高を入力すると、それを基準に計算し直します。</p>` : ''}
    <label>日付<input type="date" id="s-date" value="${today()}"></label>
    <label>${sec ? '評価額（円）' : pts ? `残高（${esc(unitOf(a))}）` : '実際の残高（円）'}<input id="s-val" inputmode="numeric" value="${Math.round(current) || ''}" required></label>
    ${sec ? `<label>元本・取得額（円）<input id="s-cost" inputmode="numeric" value="${last?.cost ?? ''}" placeholder="任意"></label>` : ''}
    ${pts ? `<div class="grid2"><label>直近の失効日<input type="date" id="s-exp" value="${last?.expiry || ''}"></label><label>失効する量<input id="s-expv" inputmode="numeric" value="${last?.expiringValue || ''}"></label></div>` : ''}
    <button class="btn primary">記録</button></form>`;
  openSheet(a.name, html, (b) => {
    $('#snf', b).onsubmit = async (e) => {
      e.preventDefault();
      const s = { id: uid(), accountId: a.id, date: $('#s-date', b).value, value: parseAmount($('#s-val', b).value) || 0 };
      if (sec) { const c = parseAmount($('#s-cost', b).value); if (c != null) s.cost = c; }
      if (pts) { s.expiry = $('#s-exp', b).value || null; s.expiringValue = parseAmount($('#s-expv', b).value) || 0; }
      state.snapshots = state.snapshots.filter((x) => !(x.accountId === a.id && x.date === s.date));
      state.snapshots.push(s);
      await saveKV('snapshots');
      accountSheet(a.id); render(); toast('記録しました');
    };
  });
}

// ---------- 分析 ----------

function viewAnalysis() {
  const ym = ui.anaYm;
  const s = summarize(monthTx(state, ym));
  const prev = summarize(monthTx(state, addMonths(ym, -1)));
  const prevMap = new Map(prev.cats.map((c) => [c.name, c.amount]));
  const series = monthlySeries(state, 12, ym);
  const withData = series.filter((x) => x.income || x.expense);
  const avgIn = withData.length ? sum(withData, (x) => x.income) / withData.length : 0;
  const avgOut = withData.length ? sum(withData, (x) => x.expense) / withData.length : 0;
  const rate = avgIn ? ((avgIn - avgOut) / avgIn) * 100 : 0;
  const nwh = netWorthHistory(state, 12, ym);
  const rec = detectRecurring(state, ym);
  const recTotal = sum(rec, (r) => r.monthly);
  const inv = investSummary(state);
  const payees = [...groupBy(monthTx(state, ym).filter((t) => t.kind === 'expense'), (t) => t.payee || '(不明)').entries()]
    .map(([p, l]) => ({ p, v: -sum(l, (t) => t.amount), n: l.length })).sort((a, b) => b.v - a.v).slice(0, 10);
  const max = s.cats[0]?.amount || 1;
  return `
  ${monthNav('anaYm')}
  <section class="card">
    <h3>カテゴリ別の支出</h3>
    <div class="stats3 compact">
      <div><div class="label">収入</div><div class="plus">${yen(s.income)}</div></div>
      <div><div class="label">支出</div><div class="minus">${yen(s.expense)}</div></div>
      <div><div class="label">収支</div><div class="${s.balance >= 0 ? 'plus' : 'minus'}">${yen(s.balance, { sign: true })}</div></div>
    </div>
    <ul class="cat-bars">${s.cats.map((c) => {
      const p = prevMap.get(c.name) || 0;
      const d = c.amount - p;
      return `<li data-act="cat-month" data-cat="${esc(c.name)}" class="tap"><div class="row-between"><span><i style="background:${catColor(c.name)}"></i>${esc(c.name)}</span><span><b>${yen(c.amount)}</b> <small class="${d > 0 ? 'minus' : 'plus'}">${p && d ? (d > 0 ? '▲' : '▼') + yen(Math.abs(d)) : ''}</small></span></div>
        <div class="bar"><i style="width:${(c.amount / max) * 100}%;background:${catColor(c.name)}"></i></div></li>`;
    }).join('') || '<li class="muted">データがありません</li>'}</ul>
    <p class="muted">▲▼は前月との差</p>
  </section>
  <section class="card">
    <h3>収入と支出の推移</h3>
    ${incomeExpenseBars(series)}
    ${legend([{ label: '収入', color: 'var(--plus)' }, { label: '支出', color: 'var(--minus)' }])}
    <div class="stats3 compact">
      <div><div class="label">平均収入</div><div>${yen(avgIn)}</div></div>
      <div><div class="label">平均支出</div><div>${yen(avgOut)}</div></div>
      <div><div class="label">貯蓄率</div><div class="${rate >= 0 ? 'plus' : 'minus'}">${rate.toFixed(0)}%</div></div>
    </div>
  </section>
  <section class="card">
    <h3>資産の推移</h3>
    ${lines([
      { color: 'var(--accent)', values: nwh.map((h) => h.total) },
      { color: '#8fae00', values: nwh.map((h) => h.cash) },
      { color: '#2f7fd0', values: nwh.map((h) => h.invest) },
    ], nwh.map((h) => h.ym), { fmtLabel: (l) => Number(l.slice(5)) + '月' })}
    ${legend([{ label: '純資産', color: 'var(--accent)' }, { label: '預金・現金', color: '#8fae00' }, { label: '投資', color: '#2f7fd0' }])}
    ${inv.value ? `<div class="muted">投資評価額 ${yen(inv.value)}（元本 ${yen(inv.cost)}、損益 <b class="${inv.gain >= 0 ? 'plus' : 'minus'}">${yen(inv.gain, { sign: true })}</b>）</div>` : ''}
    <p class="muted">証券・ポイントは記録した日の評価額で計算します。</p>
  </section>
  <section class="card">
    <div class="row-between"><h3>固定費・サブスク</h3><span>月 <b>${yen(recTotal)}</b> ／ 年 ${yen(recTotal * 12)}</span></div>
    <ul class="simple">${rec.map((r) => `<li><span>${esc(r.payee)} <small class="muted">${esc(r.category)}・毎月${r.day}日頃・${r.count}か月</small></span><b>${yen(r.monthly)}</b></li>`).join('') || '<li class="muted">3か月以上の明細があると自動で見つけます</li>'}</ul>
  </section>
  <section class="card">
    <h3>よく使ったお店</h3>
    <ul class="simple">${payees.map((x) => `<li><span>${esc(x.p)} <small class="muted">${x.n}回</small></span><b>${yen(x.v)}</b></li>`).join('') || '<li class="muted">データがありません</li>'}</ul>
  </section>`;
}

function catMonthSheet(cat) {
  const txs = monthTx(state, ui.anaYm).filter((t) => t.category === cat).sort((a, b) => b.date.localeCompare(a.date));
  openSheet(`${ymLabel(ui.anaYm)}・${cat}`, `<ul class="tx-list">${txs.map(txRow).join('')}</ul>`);
}

// ---------- 将来 ----------

function startPosition() {
  const now = today();
  const nw = netWorth(state, now);
  const inv = investSummary(state);
  return { ym: thisMonth(), cash: nw.cash + nw.card, invest: nw.invest, investCost: inv.cost || nw.invest, other: nw.points };
}

function futureModel() {
  const p = state.plan;
  const avg = averageMonthly(state, 3, thisMonth());
  const living = p.living ?? Math.round(avg?.expense || 0);
  const plan = { ...p, living };
  const start = startPosition();
  const rate = Number(p.returnRate) || 0;
  const rows = simulate(plan, start);
  const low = simulate({ ...plan, returnRate: Math.max(0, rate - 2) }, start);
  const high = simulate({ ...plan, returnRate: rate + 2 }, start);
  return { p, avg, living, plan, start, rows, low, high, rate };
}

const ageAt = (p, i) => (p.age ? Math.floor(Number(p.age) + i / 12) : null);
const ageLabel = (p, i) => (p.age ? `（${ageAt(p, i)}歳）` : '');

function futureCard() {
  if (!state.plan.salary) return '';
  const { p, rows } = futureModel();
  const yearly = rows.filter((r, i) => i === 0 || r.ym.endsWith('-12') || i === rows.length - 1);
  const at = (y) => rows[Math.min(rows.length - 1, y * 12)];
  const ys = [5, 10, 20].filter((y) => y <= p.years);
  return `<section class="card tap" data-act="tab" data-tab="future">
    <div class="row-between"><h3>将来の資産の見通し</h3><span class="link">詳しく ›</span></div>
    <div class="stats3">${ys.map((y) => `<div><div class="label">${y}年後${p.age ? `・${ageAt(p, y * 12)}歳` : ''}</div><div>${man(at(y).total)}円</div></div>`).join('')}</div>
    ${lines([{ color: 'var(--accent)', values: yearly.map((r) => r.total) }], yearly.map((r) => r.ym), { height: 110, area: true, fmtLabel: (l) => "'" + l.slice(2, 4) })}
  </section>`;
}

function viewFuture() {
  const { p, avg, living, start, rows, low, high, rate } = futureModel();
  const yearly = rows.filter((r, i) => i === 0 || r.ym.endsWith('-12') || i === rows.length - 1);
  const monthlyFlow = (Number(p.salary) || 0) - living;
  const annualBonus = (Number(p.bonus) || 0) * (p.bonusMonths || []).length;
  const yearlySave = monthlyFlow * 12 + annualBonus;
  const negative = rows.find((r) => r.cash < 0);
  const milestones = [1000, 2000, 3000, 5000, 10000].map((m) => ({ m, i: rows.findIndex((r) => r.total >= m * 10000) })).filter((x) => x.i > 0);
  const pick = (arr, y) => arr[Math.min(arr.length - 1, y * 12)];
  const last = rows[rows.length - 1];
  const fire = living ? (living * 12) / 0.04 : 0;
  const fireI = fire ? rows.findIndex((r) => r.invest >= fire) : -1;
  const goal = Number(p.goal) || 0;
  const goalI = goal ? rows.findIndex((r) => r.total >= goal) : -1;
  const setup = !p.salary;
  return `<div id="fut-res">
  ${setup ? '<div class="alert">下の「給料と毎月のお金」に手取りなどを入れると、将来の資産が計算されます。</div>' : `
  <section class="card hero">
    <div class="label">${p.years}年後${p.age ? `（${ageAt(p, p.years * 12)}歳）` : ''}の資産の見込み</div>
    <div class="big">${man(last.total)}円</div>
    <div class="breakdown">
      <span>預金 <b>${man(last.cash)}円</b></span>
      <span>投資 <b>${man(last.invest)}円</b></span>
      <span>うち運用益 <b>${man(last.invest - last.principal)}円</b></span>
      <span>年あたり <b>+${man((last.total - rows[0].total) / p.years)}円</b></span>
    </div>
    ${lines([
      { color: '#c4d700', values: yearly.map((r) => r.total) },
      { color: 'rgba(255,255,255,.8)', values: yearly.map((r) => r.cash) },
      { color: '#7fd4ff', values: yearly.map((r) => r.invest) },
    ], yearly.map((r) => r.ym), { height: 200, fmtLabel: (l) => "'" + l.slice(2, 4) })}
    ${legend([{ label: '合計', color: '#c4d700' }, { label: '預金', color: 'rgba(255,255,255,.8)' }, { label: '投資評価額', color: '#7fd4ff' }])}
  </section>
  ${negative ? `<div class="alert warn">${ymLabel(negative.ym)}${ageLabel(p, rows.indexOf(negative))}に預金がマイナスになります。生活費か積立額を見直しましょう。</div>` : ''}

  <section class="card">
    <h3>年ごとの資産</h3>
    <table class="tbl"><tr><th></th><th>預金</th><th>投資</th><th>合計</th></tr>
      ${[0, 1, 2, 3, 5, 10, 15, 20, 25, 30, 40, 50].filter((y) => y <= p.years).map((y) => { const r = pick(rows, y); return `<tr><td>${y ? y + '年後' : '今'}${p.age ? `<small class="muted"> ${ageAt(p, y * 12)}歳</small>` : ''}</td><td>${man(r.cash)}</td><td>${man(r.invest)}</td><td><b>${man(r.total)}</b></td></tr>`; }).join('')}
    </table>
  </section>

  <section class="card">
    <h3>運用成績による違い</h3>
    <p class="muted">利回りが想定より±2%ずれた場合の合計資産です。</p>
    <table class="tbl"><tr><th></th><th>悲観 ${Math.max(0, rate - 2)}%</th><th>標準 ${rate}%</th><th>楽観 ${rate + 2}%</th></tr>
      ${[5, 10, 20, 30].filter((y) => y <= p.years).map((y) => `<tr><td>${y}年後</td><td>${man(pick(low, y).total)}</td><td><b>${man(pick(rows, y).total)}</b></td><td>${man(pick(high, y).total)}</td></tr>`).join('')}
    </table>
  </section>

  <section class="card">
    <h3>目標と節目</h3>
    <ul class="simple">
      ${goal ? `<li><span>目標 ${man(goal)}円</span><b>${goalI > 0 ? ymLabel(rows[goalI].ym) + ageLabel(p, goalI) : goalI === 0 ? '達成済み' : '期間内は未到達'}</b></li>` : ''}
      ${milestones.map((x) => `<li><span>資産 ${x.m >= 10000 ? '1億' : x.m + '万'}円</span><b>${ymLabel(rows[x.i].ym)}${ageLabel(p, x.i)}</b></li>`).join('')}
      ${fire ? `<li><span>運用益で生活できる目安<br><small class="muted">投資額が年間生活費÷4%＝${man(fire)}円</small></span><b>${fireI > 0 ? ymLabel(rows[fireI].ym) + ageLabel(p, fireI) : fireI === 0 ? '達成済み' : '期間内は未到達'}</b></li>` : ''}
    </ul>
  </section>`}
  </div>

  <section class="card">
    <h3>給料と毎月のお金</h3>
    <form class="form" id="plan">
      <div class="grid2">
        <label>毎月の手取り<input name="salary" inputmode="numeric" value="${p.salary || ''}" placeholder="250000"></label>
        <label>給料日<input name="payday" inputmode="numeric" value="${p.payday}"></label>
        <label>賞与（1回の手取り）<input name="bonus" inputmode="numeric" value="${p.bonus || ''}" placeholder="0"></label>
        <label>賞与の月<input name="bonusMonths" value="${(p.bonusMonths || []).join(',')}" placeholder="6,12"></label>
        <label>毎月の生活費<input name="living" inputmode="numeric" value="${p.living ?? ''}" placeholder="${avg ? `実績平均 ${Math.round(avg.expense)}` : '200000'}"><small>${p.living == null ? (avg ? `空欄＝直近${avg.months}か月の平均` : '空欄＝実績平均') : ''}</small></label>
        <label>毎月の積立投資<input name="invest" inputmode="numeric" value="${p.invest || ''}" placeholder="30000"></label>
        <label>想定利回り（年%）<input name="returnRate" inputmode="decimal" value="${p.returnRate}"></label>
        <label>昇給率（年%）<input name="salaryGrowth" inputmode="decimal" value="${p.salaryGrowth}"></label>
        <label>今の年齢<input name="age" inputmode="numeric" value="${p.age || ''}" placeholder="任意"></label>
        <label>目標の資産額<input name="goal" inputmode="numeric" value="${p.goal || ''}" placeholder="10000000"></label>
        <label>シミュレーション年数<input name="years" inputmode="numeric" value="${p.years}"></label>
      </div>
    </form>
    <div class="stats3 compact" id="fut-stats">
      <div><div class="label">毎月の余剰</div><div class="${monthlyFlow - (p.invest || 0) >= 0 ? 'plus' : 'minus'}">${yen(monthlyFlow - (p.invest || 0), { sign: true })}</div></div>
      <div><div class="label">年間の貯蓄＋投資</div><div>${yen(yearlySave)}</div></div>
      <div><div class="label">貯蓄率</div><div>${p.salary ? Math.round((yearlySave / ((p.salary * 12) + annualBonus)) * 100) : 0}%</div></div>
    </div>
  </section>

  <section class="card">
    <div class="row-between"><h3>予定しているイベント</h3><button class="link" id="ev-add">＋追加</button></div>
    <ul class="simple">${(p.events || []).sort((a, b) => a.ym.localeCompare(b.ym)).map((e, i) => `<li><span>${ymLabel(e.ym)} ${esc(e.label)}</span><span><b class="${e.amount >= 0 ? 'plus' : 'minus'}">${yen(e.amount, { sign: true })}</b> <button class="icon-btn" data-ev-del="${i}">×</button></span></li>`).join('') || '<li class="muted">引っ越し・車・旅行・結婚などの大きな出費や臨時収入を入れると見通しに反映されます</li>'}</ul>
  </section>
  <p class="muted center">スタート時点：預金 ${yen(start.cash)}（カード未払い差引後）／投資 ${yen(start.invest)}</p>`;
}

function mountFuture(v) {
  const f = $('#plan', v);
  f.onchange = async () => {
    {
      const d = new FormData(f);
      const num = (k) => { const x = parseAmount(d.get(k)); return x == null ? 0 : x; };
      const p = state.plan;
      p.salary = num('salary');
      p.payday = Math.min(31, Math.max(1, num('payday') || 25));
      p.bonus = num('bonus');
      p.bonusMonths = String(d.get('bonusMonths')).split(/[,、\s]+/).map(Number).filter((x) => x >= 1 && x <= 12);
      p.living = String(d.get('living')).trim() === '' ? null : num('living');
      p.invest = num('invest');
      p.returnRate = num('returnRate');
      p.salaryGrowth = num('salaryGrowth');
      p.years = Math.min(50, Math.max(1, num('years') || 20));
      p.age = num('age') || null;
      p.goal = num('goal') || null;
      await saveKV('plan');
      // 入力中の欄を消さないよう、結果部分だけ描き直す
      const tmp = document.createElement('div');
      tmp.innerHTML = viewFuture();
      for (const id of ['fut-res', 'fut-stats']) $('#' + id, v).innerHTML = $('#' + id, tmp).innerHTML;
    }
  };
  $('#ev-add', v).onclick = () => {
    openSheet('イベントを追加', `<form class="form" id="evf">
      <label>内容<input id="e-l" placeholder="例：車の購入" required></label>
      <label>年月<input type="month" id="e-ym" value="${addMonths(thisMonth(), 12)}" required></label>
      <label>金額<div class="amount-in"><select id="e-d"><option value="-1">出費</option><option value="1">収入</option></select><input id="e-a" inputmode="numeric" required></div></label>
      <button class="btn primary">追加</button></form>`, (b) => {
      $('#evf', b).onsubmit = async (e) => {
        e.preventDefault();
        state.plan.events = state.plan.events || [];
        state.plan.events.push({ label: $('#e-l', b).value, ym: $('#e-ym', b).value, amount: (parseAmount($('#e-a', b).value) || 0) * Number($('#e-d', b).value) });
        await saveKV('plan'); closeSheet(); render();
      };
    });
  };
  $$('[data-ev-del]', v).forEach((x) => (x.onclick = async () => {
    state.plan.events.sort((a, b) => a.ym.localeCompare(b.ym)).splice(Number(x.dataset.evDel), 1);
    await saveKV('plan'); render();
  }));
}

// ---------- 設定 ----------

function viewSettings() {
  const userRules = state.rules.filter((r) => !r.builtin);
  return `
  <section class="card">
    <div class="row-between"><h3>口座</h3><button class="link" data-act="add-account">＋追加</button></div>
    <ul class="simple">${state.accounts.map((a) => `<li class="tap" data-act="account" data-id="${a.id}"><span>${ACCOUNT_TYPES[a.type].icon} ${esc(a.name)}${a.archived ? ' <small class="muted">非表示</small>' : ''}</span><small class="muted">${a.lastImport ? '取込 ' + a.lastImport : ''}</small></li>`).join('') || '<li class="muted">口座がありません</li>'}</ul>
    <button class="btn" data-act="import">明細CSVを取り込む</button>
  </section>
  ${syncSection()}
  <section class="card">
    <h3>予算（月）</h3>
    <form id="budgets" class="form">${catsOf('expense').map((c) => `<label class="inline"><span><i class="sw" style="background:${c.color}"></i>${esc(c.name)}</span><input name="${esc(c.name)}" inputmode="numeric" value="${state.budgets[c.name] || ''}" placeholder="—"></label>`).join('')}</form>
  </section>
  <section class="card">
    <div class="row-between"><h3>カテゴリ</h3><button class="link" id="cat-add">＋追加</button></div>
    ${Object.entries(KINDS).map(([k, l]) => `<div class="label">${l}</div><div class="chips">${catsOf(k).map((c) => `<span class="chip big" style="border-color:${c.color}">${esc(c.name)} <button data-cat-del="${esc(c.name)}" aria-label="削除">×</button></span>`).join('')}</div>`).join('')}
  </section>
  <section class="card">
    <div class="row-between"><h3>自動分類ルール</h3><button class="link" id="rule-add">＋追加</button></div>
    <p class="muted">取引のお店名・内容にキーワードが含まれると自動で分類します。明細の分類を直すと自動で学習します。（標準ルール ${state.rules.length - userRules.length}件）</p>
    <ul class="simple">${userRules.map((r) => `<li><span>「${esc(r.keyword)}」→ ${esc(r.category)}</span><button class="icon-btn" data-rule-del="${r.id}">×</button></li>`).join('') || '<li class="muted">学習したルールはまだありません</li>'}</ul>
    <button class="btn" id="recat">すべての取引を再分類する</button>
    <small class="muted">手で直した取引はそのままです</small>
  </section>
  <section class="card">
    <h3>データ</h3>
    <p class="muted">データはこのiPhoneのSafari内にだけ保存されています。機種変更やSafariのデータ削除に備えて定期的にバックアップしてください。${state.meta.lastBackup ? `<br>最終バックアップ：${state.meta.lastBackup.slice(0, 10)}` : ''}</p>
    <button class="btn primary" data-act="backup">バックアップを保存</button>
    <label class="btn file-btn">バックアップから復元<input type="file" id="restore" accept=".json,application/json" hidden></label>
    <button class="btn" id="export-csv">取引をCSVで書き出す</button>
    <button class="btn ghost" data-act="sample">サンプルデータを入れる</button>
    <button class="btn danger" id="wipe">すべてのデータを削除</button>
  </section>
  <p class="muted center">おかねナビ v1.0 ・ 取引 ${state.tx.length}件</p>`;
}

function mountSettings(v) {
  mountSync(v);
  const bf = $('#budgets', v);
  let timer;
  bf.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const b = {};
      for (const [k, val] of new FormData(bf)) { const n = parseAmount(val); if (n) b[k] = n; }
      state.budgets = b;
      await saveKV('budgets');
    }, 500);
  };
  $('#cat-add', v).onclick = () => {
    openSheet('カテゴリを追加', `<form class="form" id="cf">
      <label>種類<select id="c-k">${Object.entries(KINDS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <label>名前<input id="c-n" required></label>
      <label>色<input type="color" id="c-c" value="#4ea8de"></label>
      <button class="btn primary">追加</button></form>`, (b) => {
      $('#cf', b).onsubmit = async (e) => {
        e.preventDefault();
        const name = $('#c-n', b).value.trim();
        if (state.categories.some((c) => c.name === name)) return toast('同じ名前があります');
        state.categories.push({ name, kind: $('#c-k', b).value, color: $('#c-c', b).value });
        await saveKV('categories'); closeSheet(); render();
      };
    });
  };
  $$('[data-cat-del]', v).forEach((x) => (x.onclick = async () => {
    const name = x.dataset.catDel;
    const n = state.tx.filter((t) => t.category === name).length;
    if (!confirm(`「${name}」を削除しますか？${n ? `（${n}件の取引は「未分類」になります）` : ''}`)) return;
    state.categories = state.categories.filter((c) => c.name !== name);
    if (n) await putTx(state.tx.filter((t) => t.category === name).map((t) => ({ ...t, kind: t.kind === 'transfer' ? 'transfer' : t.amount >= 0 ? 'income' : 'expense', category: t.kind === 'transfer' ? '口座間移動' : t.amount >= 0 ? 'その他収入' : '未分類' })));
    await saveKV('categories'); render();
  }));
  $('#rule-add', v).onclick = () => {
    openSheet('ルールを追加', `<form class="form" id="rf">
      <label>キーワード（お店名などの一部）<input id="r-k" required></label>
      <label>分類<select id="r-c">${Object.entries(KINDS).map(([k, l]) => `<optgroup label="${l}">${catsOf(k).map((c) => `<option value="${k}|${esc(c.name)}">${esc(c.name)}</option>`).join('')}</optgroup>`).join('')}</select></label>
      <label class="check"><input type="checkbox" id="r-apply" checked> 既存の取引にも適用する</label>
      <button class="btn primary">追加</button></form>`, (b) => {
      $('#rf', b).onsubmit = async (e) => {
        e.preventDefault();
        const kw = $('#r-k', b).value.trim();
        const [kind, category] = $('#r-c', b).value.split('|');
        addRule(kw, kind, category);
        await saveKV('rules');
        if ($('#r-apply', b).checked) {
          const k = norm(kw);
          const upd = state.tx.filter((t) => !t.userSet && norm([t.payee, t.content, t.memo].join(' ')).includes(k)).map((t) => ({ ...t, kind, category }));
          await putTx(upd);
          toast(`${upd.length}件に適用しました`);
        }
        closeSheet(); render();
      };
    });
  };
  $$('[data-rule-del]', v).forEach((x) => (x.onclick = async () => {
    state.rules = state.rules.filter((r) => r.id !== x.dataset.ruleDel);
    await saveKV('rules'); render();
  }));
  $('#recat', v).onclick = async () => {
    // 標準ルールは最新版に入れ替え（学習ルールは維持）
    state.rules = [...state.rules.filter((r) => !r.builtin), ...defaultRules()];
    await saveKV('rules');
    const upd = [];
    for (const t of state.tx) {
      if (t.userSet || t.source === 'manual' || (t.source === 'paypay' && ['チャージ', '交際費', '臨時収入', 'ポイント・還元', '口座間移動'].includes(t.category))) continue;
      const x = { ...t, kind: null, category: null };
      categorize(x, state.rules, accById(t.accountId)?.type);
      if (x.kind !== t.kind || x.category !== t.category) upd.push(x);
    }
    await putTx(upd);
    render();
    toast(`${upd.length}件の分類を更新しました`);
  };
  $('#restore', v).onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const o = JSON.parse(await f.text());
      if (!confirm(`バックアップ（取引${o.tx?.length || 0}件）で今のデータを置き換えます。よろしいですか？`)) return;
      await importAll(o);
      render(); toast('復元しました');
    } catch (err) { alert('復元できませんでした：' + err.message); }
  };
  $('#export-csv', v).onclick = () => {
    const rows = [['日付', '口座', '種別', '分類', 'お店・内容', '金額', 'メモ', '除外']];
    for (const t of [...state.tx].sort((a, b) => a.date.localeCompare(b.date))) rows.push([t.date, accById(t.accountId)?.name || '', KINDS[t.kind], t.category, t.payee, t.amount, t.memo || '', t.excluded ? '1' : '']);
    saveFile(new Blob(['﻿' + toCSV(rows)], { type: 'text/csv' }), `okane-navi-${today()}.csv`);
  };
  $('#wipe', v).onclick = async () => {
    if (!confirm('すべてのデータを削除します。元に戻せません。よろしいですか？')) return;
    if (!confirm('本当に削除しますか？')) return;
    await wipe(); render(); toast('削除しました');
  };
}

async function saveFile(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return true;
}

async function backup() {
  const blob = new Blob([JSON.stringify(exportAll())], { type: 'application/json' });
  if (await saveFile(blob, `okane-navi-backup-${today()}.json`)) {
    state.meta.lastBackup = new Date().toISOString();
    await saveKV('meta');
    render();
    toast('バックアップを保存しました（「ファイル」やiCloud Driveに保存してください）');
  }
}

// ---------- 自動連携 ----------

let syncing = false;

async function runSync({ silent = false } = {}) {
  const s = state.sync;
  if (!s.url || !s.token || syncing) return;
  syncing = true;
  try {
    const j = await fetchSync(s);
    const add = processSync(state, j.items || []);
    if (add.length) await putTx(add);
    s.unparsed = (j.unparsed || []).slice(-20);
    s.lastSync = new Date().toISOString();
    s.lastResult = { ok: true, added: add.length, at: s.lastSync };
    await saveKV('sync');
    if (!$('#sheet').classList.contains('open') && !document.activeElement?.matches('input, select')) render();
    if (add.length || !silent) toast(`自動連携：${add.length}件を追加しました${s.pending.length ? `（口座未設定 ${s.pending.length}件）` : ''}`);
  } catch (err) {
    s.lastResult = { error: err.message, at: new Date().toISOString() };
    await saveKV('sync');
    if (!silent) toast(err.message);
    else if (!$('#sheet').classList.contains('open')) render();
  } finally {
    syncing = false;
  }
}

function syncSection() {
  const s = state.sync;
  const keys = Object.entries(s.keys).sort((a, b) => a[1].label.localeCompare(b[1].label));
  const accOpts = (sel, src) => {
    const types = src === 'smbc-bank' ? ['bank'] : ['card', 'paypay', 'bank', 'cash'];
    return `<option value="">（未設定）</option><option value="skip" ${sel === 'skip' ? 'selected' : ''}>取り込まない</option>` +
      activeAccounts().filter((a) => types.includes(a.type)).map((a) => `<option value="${a.id}" ${sel === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  };
  const status = !s.url ? '未設定' : s.lastResult?.error ? `<span class="minus">エラー：${esc(s.lastResult.error)}</span>` : s.lastSync ? `最終同期 ${new Date(s.lastSync).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '未同期';
  return `<section class="card" id="sync">
    <h3>自動連携</h3>
    <p class="muted">カード・銀行の利用通知メール（Gmail）と、Apple Payでの支払い（iPhoneのショートカット）から、取引を自動で取り込みます。アプリを開くたびに同期します。</p>
    <div class="notice">状態：${status}</div>
    <form class="form" id="syncf">
      <label>連携URL<input id="sy-url" value="${esc(s.url)}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" autocapitalize="off"></label>
      <label>合言葉<input id="sy-token" value="${esc(s.token)}" autocomplete="off" autocapitalize="off"></label>
      <button class="btn primary">保存して同期</button>
    </form>
    ${keys.length ? `<div class="label">通知と口座の対応</div>
      <form class="form" id="sy-map">${keys.map(([k, v]) => `<label>${esc(v.label)}<select data-key="${esc(k)}">${accOpts(s.map[k], v.source)}</select></label>`).join('')}</form>` : ''}
    ${s.pending.length ? `<div class="notice warn">口座が決まっていない取引が ${s.pending.length}件 あります。上で口座を選ぶと取り込まれます。</div>` : ''}
    ${s.unparsed.length ? `<details class="help"><summary>読み取れなかったメール（${s.unparsed.length}件）</summary><ul class="simple">${s.unparsed.map((u) => `<li><span>${esc(u.date)} ${esc(u.subject)}</span></li>`).join('')}</ul></details>` : ''}
    <details class="help"><summary>① Gmail連携の設定方法（最初に1回・約5分）</summary>
      <ol class="steps">
        <li>下のボタンでスクリプトをコピー<button type="button" class="btn small" id="sy-copy">スクリプトをコピー</button></li>
        <li>Safariで <b>script.google.com</b> を開き、Gmailと同じGoogleアカウントでログイン →「新しいプロジェクト」</li>
        <li>最初から入っている文字を全部消して、コピーしたスクリプトを貼り付け → 💾保存</li>
        <li>上の関数の選択で <b>setup</b> を選び「実行」→ 権限の確認で自分のアカウントを選び「許可」<br><small>「このアプリは確認されていません」と出たら「詳細」→「（安全ではないページ）に移動」。自分で作ったスクリプトなので問題ありません。</small></li>
        <li>下の「実行ログ」に出る <b>合言葉</b> をコピーして、上の「合言葉」に貼り付け</li>
        <li>右上「デプロイ」→「新しいデプロイ」→ 種類の⚙で「ウェブアプリ」→ 次のユーザーとして実行：<b>自分</b>、アクセスできるユーザー：<b>全員</b> →「デプロイ」</li>
        <li>表示された「ウェブアプリのURL」をコピーして、上の「連携URL」に貼り付け →「保存して同期」</li>
      </ol>
      <p>読み取れるメール：三井住友カード（Olive・Amazonマスター等）と ANA JCBカードの「ご利用のお知らせ」、三井住友銀行の「口座出金」「引き落としの事前お知らせ」「振込入金」。<br>
      ・三井住友銀行の振込入金メールには金額が書かれていないため、ホームに「金額を記録」のお知らせを出します。<br>
      ・携帯料金・公共料金など毎月の自動払いは、カード会社が通知メールを送らないことがあります。月1回カード明細CSVを取り込むと確実です（重複は自動でスキップ）。<br>
      ・セゾン・PayPay・ゆうちょ・SBIは利用ごとのメールが届かないため、CSV取り込みかショートカットを使ってください。</p>
      <p>合言葉を知っている人だけが連携URLから明細を読めます。合言葉は人に教えないでください。</p>
    </details>
    <details class="help"><summary>② Apple Payの支払いを自動記録（iPhoneのショートカット）</summary>
      <ol class="steps">
        <li>「ショートカット」アプリ → 下の「オートメーション」→ 右上「＋」</li>
        <li>「ウォレット」を選び、記録したいカード（セゾン・Suicaなど）を選ぶ →「すぐに実行」→「次へ」</li>
        <li>「新規の空のオートメーション」→「アクションを追加」で <b>URLの内容を取得</b> を追加</li>
        <li>URLに上の「連携URL」を入れ、「>」を開いて 方法：<b>POST</b>、本文を要求：<b>JSON</b></li>
        <li>「新規フィールドを追加」→「テキスト」で次の4つを追加：<br>
          <code>token</code> … 合言葉<br>
          <code>amount</code> … 変数「ショートカットの入力」→「金額」<br>
          <code>merchant</code> … 「ショートカットの入力」→「加盟店」<br>
          <code>card</code> … 「ショートカットの入力」→「カードまたはパス」</li>
        <li>「完了」。以後、そのカードで支払うと自動で記録され、次にアプリを開いた時に取り込まれます。</li>
      </ol>
      <p>メール通知があるカード（三井住友・JCB）は、ショートカットと両方で記録されても1件にまとめます。</p>
    </details>
    ${s.url ? '<button type="button" class="btn" id="sy-now">今すぐ同期</button><button type="button" class="btn ghost" id="sy-off">自動連携をやめる</button>' : ''}
  </section>`;
}

function mountSync(v) {
  const s = state.sync;
  $('#syncf', v).onsubmit = async (e) => {
    e.preventDefault();
    s.url = $('#sy-url', v).value.trim();
    s.token = $('#sy-token', v).value.trim();
    if (!/^https:\/\//.test(s.url)) return toast('連携URLを入力してください');
    if (!s.token) return toast('合言葉を入力してください');
    await saveKV('sync');
    await runSync();
    render();
  };
  $('#sy-map', v)?.addEventListener('change', async (e) => {
    const k = e.target.dataset.key;
    if (!k) return;
    if (e.target.value) s.map[k] = e.target.value; else delete s.map[k];
    const add = processSync(state, []);
    if (add.length) await putTx(add);
    await saveKV('sync');
    render();
    if (add.length) toast(`${add.length}件を取り込みました`);
  });
  $('#sy-copy', v).onclick = async () => {
    try {
      const code = await (await fetch('gas/Code.gs', { cache: 'no-store' })).text();
      await navigator.clipboard.writeText(code);
      toast('スクリプトをコピーしました');
    } catch {
      window.open('gas/Code.gs', '_blank');
    }
  };
  $('#sy-now', v)?.addEventListener('click', () => runSync());
  $('#sy-off', v)?.addEventListener('click', async () => {
    if (!confirm('自動連携をやめますか？（取り込み済みの取引は残ります）')) return;
    s.url = ''; s.token = ''; s.lastResult = null;
    await saveKV('sync'); render();
  });
}

function openNotice(id) {
  const n = state.sync.notices.find((x) => x.id === id);
  if (!n) return;
  const acc = state.accounts.find((a) => a.id === state.sync.map[n.key]) || guessAccount(state.accounts, n);
  const payday = state.plan.payday || 25;
  const nearPayday = Math.abs(Number(n.date.slice(8)) - payday) <= 3;
  editTx(null, {
    kind: 'income', category: nearPayday ? '給与' : 'その他収入', date: n.date, payee: '振込入金',
    accountId: acc?.id || activeAccounts().find((a) => a.type === 'bank')?.id,
  }, () => dismissNotice(id));
}

async function dismissNotice(id) {
  const s = state.sync;
  s.notices = s.notices.filter((n) => n.id !== id);
  s.dismissed = [...s.dismissed, id].slice(-300);
  await saveKV('sync');
}

// ---------- ルーティング ----------

const VIEWS = { home: viewHome, tx: viewTx, analysis: viewAnalysis, future: viewFuture, settings: viewSettings };
const MOUNT = { tx: mountTx, future: mountFuture, settings: mountSettings };

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  switch (act) {
    case 'tab': closeSheet(); ui.tab = el.dataset.tab; render(); window.scrollTo(0, 0); break;
    case 'close-sheet': closeSheet(); break;
    case 'month': ui[el.dataset.key] = addMonths(ui[el.dataset.key], Number(el.dataset.d)); render(); break;
    case 'edit-tx': editTx(state.tx.find((t) => t.id === el.dataset.id)); break;
    case 'new-tx': editTx(null); break;
    case 'import': importSheet(); break;
    case 'add-account': addAccount(); break;
    case 'quick-setup': quickSetup(); break;
    case 'account': accountSheet(el.dataset.id); break;
    case 'cat-month': catMonthSheet(el.dataset.cat); break;
    case 'backup': backup(); break;
    case 'goto-sync': ui.tab = 'settings'; render(); setTimeout(() => $('#sync')?.scrollIntoView({ block: 'start' }), 50); break;
    case 'notice': openNotice(el.dataset.id); break;
    case 'notice-dismiss': await dismissNotice(el.dataset.id); render(); break;
    case 'goto-uncategorized': ui.tab = 'tx'; ui.txFilter = { q: '', account: '', category: '', uncategorized: true }; render(); break;
    case 'sample':
      if (state.tx.length && !confirm('今のデータにサンプルを追加します。よろしいですか？')) return;
      await loadSample(state, { putTx, saveKV });
      render(); toast('サンプルデータを入れました（設定から全削除できます）');
      break;
  }
});

(async function init() {
  try {
    await load();
  } catch (err) {
    $('#view').innerHTML = `<div class="card">データベースを開けませんでした：${esc(err.message)}<br>プライベートブラウズでは使えません。</div>`;
    return;
  }
  render();
  runSync({ silent: true });
  document.addEventListener('visibilitychange', () => {
    const last = state.sync.lastSync ? Date.parse(state.sync.lastSync) : 0;
    if (document.visibilityState === 'visible' && Date.now() - last > 5 * 60000) runSync({ silent: true });
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
})();
