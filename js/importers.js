// 明細 CSV の取り込み（PayPay 専用 + 銀行・カード汎用）
import { parseDate, parseAmount, hash } from './util.js';

const has = (h, words) => words.some((w) => h.replace(/\s/g, '').includes(w));

const DATE_WORDS = ['取引日', 'ご利用日', '利用日', 'お取引日', '取扱日', '年月日', '日付', '約定日', '受渡日', '計算日', 'date'];
const OUT_WORDS = ['出金金額', 'お引出', 'お支払金額', '支払金額', 'ご利用金額', '利用金額', '引出', '引落', '出金', 'お支払', '支払', 'debit', 'withdraw'];
const IN_WORDS = ['入金金額', 'お預入', 'お預り', '預入', '入金', '受取', 'credit', 'deposit'];
const AMOUNT_WORDS = ['金額', 'amount'];
const DESC_WORDS = ['摘要', '取引内容', 'お取引内容', '内容', 'ご利用店名', '利用店名', 'ご利用先', '利用先', '加盟店', '店名', '取引先', '明細', '備考', 'メモ', 'description'];

// 先頭の説明行を飛ばしてヘッダー行を探す
export function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const r = rows[i];
    if (r.some((c) => has(c, DATE_WORDS)) && r.some((c) => has(c, [...OUT_WORDS, ...IN_WORDS, ...AMOUNT_WORDS]))) return i;
  }
  // ヘッダーが無い場合：日付として読める最初の行の手前
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    if (rows[i].some((c) => parseDate(c))) return i - 1;
  }
  return 0;
}

export function isPayPay(header) {
  const h = header.join(',');
  return h.includes('取引日') && h.includes('取引内容') && h.includes('取引方法') && /出金金額/.test(h);
}

// ---------- PayPay ----------

// PayPay アプリ「取引履歴 → CSVダウンロード」の形式
// 取引日,出金金額（円）,入金金額（円）,海外出金金額,通貨,変換レート（円）,利用国,取引内容,取引先,取引方法,支払い区分,利用者,取引番号
export function parsePayPay(rows) {
  const hi = findHeaderRow(rows);
  const header = rows[hi];
  const col = (...words) => header.findIndex((h) => has(h, words));
  const c = {
    date: col('取引日'),
    out: col('出金金額'),
    in: col('入金金額'),
    content: col('取引内容'),
    payee: col('取引先'),
    method: col('取引方法'),
    id: col('取引番号'),
    user: col('利用者'),
  };
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const date = parseDate(r[c.date]);
    if (!date) continue;
    const o = parseAmount(r[c.out]);
    const i = parseAmount(r[c.in]);
    const amount = (i || 0) - (o || 0);
    if (!amount) continue;
    const content = r[c.content] || '';
    const method = r[c.method] || '';
    const payee = r[c.payee] || '';
    const time = (String(r[c.date]).match(/\d{1,2}:\d{2}(:\d{2})?/) || [''])[0];
    const tx = {
      date,
      time,
      amount,
      payee: payee || content,
      content,
      method,
      memo: '',
      source: 'paypay',
      bucket: paypayBucket(method),
      extId: c.id >= 0 && r[c.id] ? 'paypay:' + r[c.id] : null,
    };
    Object.assign(tx, paypayKind(content, amount));
    out.push(tx);
  }
  return out;
}

// 取引方法から、どこのお金が動いたかを判定
export function paypayBucket(method) {
  const m = method || '';
  if (/残高/.test(m)) return 'balance'; // 「PayPay残高」や「PayPay残高, PayPayポイント」
  if (/カード|クレジット|VISA|Mastercard|JCB|AMEX/i.test(m)) return 'card';
  if (/ポイント/.test(m)) return 'points';
  return 'balance';
}

function paypayKind(content, amount) {
  const t = content || '';
  if (/チャージ/.test(t)) return { kind: 'transfer', category: 'チャージ', locked: true };
  if (/出金/.test(t)) return { kind: 'transfer', category: '口座間移動', locked: true };
  if (/送った|送金/.test(t)) return { kind: 'expense', category: '交際費', locked: true };
  if (/受け取った|受取/.test(t)) return { kind: 'income', category: '臨時収入', locked: true };
  if (/獲得|ポイント|特典|キャンペーン/.test(t) && amount > 0) return { kind: 'income', category: 'ポイント・還元', locked: true };
  if (/返金|取消|キャンセル/.test(t)) return { kind: 'expense' }; // 支出のマイナス扱い。カテゴリはルールで
  if (amount > 0) return { kind: 'income' };
  return { kind: 'expense' };
}

// ---------- 汎用（銀行・カード・証券） ----------

function numericRatio(rows, ci) {
  let n = 0, ok = 0;
  for (const r of rows.slice(0, 50)) {
    const v = r[ci];
    if (v == null || v === '') continue;
    n++;
    if (parseAmount(v) != null) ok++;
  }
  return n ? ok / n : 0;
}

function pick(header, data, words, { numeric = false, exclude = [] } = {}) {
  for (const w of words) {
    for (let i = 0; i < header.length; i++) {
      if (exclude.includes(i)) continue;
      const h = header[i].replace(/\s/g, '');
      if (!h.includes(w) || h.includes('残高')) continue;
      if (numeric && numericRatio(data, i) < 0.6) continue;
      if (!numeric && /手数料|回数|区分|方法/.test(h) && w.length < 3) continue;
      return i;
    }
  }
  return -1;
}

// ヘッダー名と中身から、どの列が何かを推測
export function guessMapping(rows, accountType) {
  const headerRow = findHeaderRow(rows);
  const header = headerRow >= 0 ? rows[headerRow] : rows[0].map((_, i) => `列${i + 1}`);
  const data = rows.slice(headerRow + 1);
  const m = { headerRow, date: -1, mode: 'split', out: -1, in: -1, amount: -1, desc: [], invert: false };

  m.date = pick(header, data, DATE_WORDS);
  if (m.date < 0) m.date = header.findIndex((_, i) => data.slice(0, 10).some((r) => parseDate(r[i])));

  m.out = pick(header, data, OUT_WORDS, { numeric: true, exclude: [m.date] });
  m.in = pick(header, data, IN_WORDS, { numeric: true, exclude: [m.date, m.out] });
  if (m.out < 0 && m.in < 0) {
    m.mode = 'signed';
    m.amount = pick(header, data, AMOUNT_WORDS, { numeric: true, exclude: [m.date] });
    if (m.amount < 0) m.amount = header.findIndex((_, i) => i !== m.date && numericRatio(data, i) > 0.8);
    // カード明細の「金額」は正の数が利用額
    m.invert = accountType === 'card';
  }
  const d = pick(header, data, DESC_WORDS, { exclude: [m.date, m.out, m.in, m.amount] });
  if (d >= 0) m.desc = [d];
  else {
    const t = header.findIndex((_, i) => ![m.date, m.out, m.in, m.amount].includes(i) && numericRatio(data, i) < 0.3);
    if (t >= 0) m.desc = [t];
  }
  return { header, mapping: m };
}

export function parseGeneric(rows, m) {
  const out = [];
  for (const r of rows.slice(m.headerRow + 1)) {
    const date = parseDate(r[m.date]);
    if (!date) continue;
    let amount;
    if (m.mode === 'signed') {
      amount = parseAmount(r[m.amount]);
      if (amount == null) continue;
      if (m.invert) amount = -amount;
    } else {
      const o = m.out >= 0 ? parseAmount(r[m.out]) : null;
      const i = m.in >= 0 ? parseAmount(r[m.in]) : null;
      if (o == null && i == null) continue;
      amount = (i || 0) - (o || 0);
    }
    if (!amount) continue;
    const payee = m.desc.map((ci) => r[ci]).filter(Boolean).join(' ');
    out.push({ date, amount, payee, content: '', memo: '', source: 'csv' });
  }
  return out;
}

// 同じファイル内で全く同じ取引が複数あっても区別できるように連番を混ぜる
export function assignExtIds(txs, accountId) {
  const seen = new Map();
  for (const t of txs) {
    if (t.extId) continue;
    const base = [accountId, t.date, t.amount, t.payee].join('|');
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    t.extId = hash(base + '|' + n);
  }
  return txs;
}
