import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, decode } from '../js/csv.js';
import { parseDate, parseAmount } from '../js/util.js';
import { isPayPay, parsePayPay, guessMapping, parseGeneric, assignExtIds, findHeaderRow } from '../js/importers.js';
import { categorize, defaultRules } from '../js/rules.js';
import { cardPayDate, cardUnpaid, balanceAt, summarize, simulate, detectRecurring } from '../js/finance.js';

test('parseDate', () => {
  assert.equal(parseDate('2024/5/1 12:34:56'), '2024-05-01');
  assert.equal(parseDate('20240501'), '2024-05-01');
  assert.equal(parseDate('2024年5月1日'), '2024-05-01');
  assert.equal(parseDate('R6.5.1'), '2024-05-01');
  assert.equal(parseDate('２０２４/０５/０１'), '2024-05-01');
  assert.equal(parseDate('摘要'), null);
});

test('parseAmount', () => {
  assert.equal(parseAmount('1,234'), 1234);
  assert.equal(parseAmount('￥1,234円'), 1234);
  assert.equal(parseAmount('-1,234'), -1234);
  assert.equal(parseAmount('▲500'), -500);
  assert.equal(parseAmount('-'), null);
  assert.equal(parseAmount(''), null);
});

test('parseCSV handles quotes and newlines', () => {
  const rows = parseCSV('a,b,c\r\n"x, y","he said ""hi""","multi\nline"\r\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['x, y', 'he said "hi"', 'multi\nline']]);
});

test('decode falls back to Shift_JIS', () => {
  // "日付" in Shift_JIS
  const sjis = new Uint8Array([0x93, 0xfa, 0x95, 0x74]);
  assert.equal(decode(sjis), '日付');
  const utf8bom = new Uint8Array([0xef, 0xbb, 0xbf, 0x61]);
  assert.equal(decode(utf8bom), 'a');
});

const PAYPAY = `取引日,出金金額（円）,入金金額（円）,海外出金金額,通貨,変換レート（円）,利用国,取引内容,取引先,取引方法,支払い区分,利用者,取引番号
2024/05/03 12:00:00,580,-,-,-,-,-,支払い,セブン-イレブン 新宿店,PayPay残高,-,-,111
2024/05/02 09:00:00,-,10000,-,-,-,-,チャージ,三井住友銀行,銀行口座,-,-,112
2024/05/04 18:00:00,"3,200",-,-,-,-,-,支払い,ユニクロ,PayPayカード,-,-,113
2024/05/05 18:00:00,-,1000,-,-,-,-,受け取った金額,山田太郎,PayPay残高,-,-,114
2024/05/06 18:00:00,100,-,-,-,-,-,支払い,ローソン,PayPayポイント,-,-,115
2024/05/07 18:00:00,-,580,-,-,-,-,返金,セブン-イレブン 新宿店,PayPay残高,-,-,116`;

test('PayPay CSV', () => {
  const rows = parseCSV(PAYPAY);
  assert.ok(isPayPay(rows[findHeaderRow(rows)]));
  const list = parsePayPay(rows);
  assert.equal(list.length, 6);
  const [a, b, c, d, e, f] = list;
  assert.equal(a.amount, -580);
  assert.equal(a.bucket, 'balance');
  assert.equal(a.extId, 'paypay:111');
  assert.equal(b.kind, 'transfer');
  assert.equal(b.amount, 10000);
  assert.equal(c.bucket, 'card');
  assert.equal(c.amount, -3200);
  assert.equal(d.kind, 'income');
  assert.equal(e.bucket, 'points');
  assert.equal(f.kind, 'expense');
  assert.equal(f.amount, 580);
  const rules = defaultRules();
  categorize(a, rules, 'paypay');
  assert.equal(a.category, '食費');
  // 返金は支出のマイナスとして食費に戻る
  const ff = { ...f, kind: null, category: null };
  categorize(ff, rules, 'paypay', 'expense');
  assert.equal(ff.kind, 'expense');
  assert.equal(ff.category, '食費');
});

test('bank CSV (Shift_JIS style with preamble)', () => {
  const csv = `口座番号,1234567
照会期間,2024/05/01～2024/05/31
年月日,お引出し,お預入れ,お取り扱い内容,残高
2024/5/10,"1,000",,ATM,99000
2024/5/25,,"250,000",給与 カ)テスト,349000
2024/5/26,"20,000",,PAYPAY,329000
2024/5/27,"35,000",,ミツイスミトモカード,294000`;
  const rows = parseCSV(csv);
  const { mapping } = guessMapping(rows, 'bank');
  assert.equal(mapping.headerRow, 2);
  assert.equal(mapping.date, 0);
  assert.equal(mapping.out, 1);
  assert.equal(mapping.in, 2);
  assert.deepEqual(mapping.desc, [3]);
  const list = assignExtIds(parseGeneric(rows, mapping), 'acc1');
  assert.equal(list.length, 4);
  const rules = defaultRules();
  list.forEach((t) => categorize(t, rules, 'bank'));
  assert.deepEqual(list.map((t) => [t.amount, t.kind, t.category]), [
    [-1000, 'transfer', '現金引出'],
    [250000, 'income', '給与'],
    [-20000, 'transfer', 'チャージ'],
    [-35000, 'transfer', 'カード支払い'],
  ]);
  assert.equal(new Set(list.map((t) => t.extId)).size, 4);
});

test('card CSV with single amount column', () => {
  const csv = `利用日,利用店名・商品名,利用者,支払方法,利用金額,支払手数料,支払総額
2024/05/03,AMAZON.CO.JP,本人,1回払い,"2,980",0,"2,980"
2024/05/08,NETFLIX.COM,本人,1回払い,"1,490",0,"1,490"`;
  const rows = parseCSV(csv);
  const { mapping } = guessMapping(rows, 'card');
  assert.equal(mapping.out, 4);
  assert.deepEqual(mapping.desc, [1]);
  const list = parseGeneric(rows, mapping);
  assert.deepEqual(list.map((t) => t.amount), [-2980, -1490]);
  const rules = defaultRules();
  list.forEach((t) => categorize(t, rules, 'card'));
  assert.deepEqual(list.map((t) => t.category), ['ショッピング', 'サブスク']);
});

test('card pay date and unpaid', () => {
  const acc = { id: 'c', type: 'card', closingDay: 31, payDay: 27 };
  assert.equal(cardPayDate(acc, '2024-05-15'), '2024-06-27');
  assert.equal(cardPayDate(acc, '2024-12-31'), '2025-01-27');
  const acc15 = { id: 'c', type: 'card', closingDay: 15, payDay: 10 };
  assert.equal(cardPayDate(acc15, '2024-05-15'), '2024-06-10');
  assert.equal(cardPayDate(acc15, '2024-05-16'), '2024-07-10');
  const state = { tx: [
    { accountId: 'c', date: '2024-05-10', amount: -1000 },
    { accountId: 'c', date: '2024-06-10', amount: -2000 },
  ], snapshots: [] };
  assert.equal(cardUnpaid(state, acc, '2024-06-20').total, 3000);
  assert.equal(cardUnpaid(state, acc, '2024-06-27').total, 2000);
  assert.equal(balanceAt(state, acc, '2024-06-27'), -2000);
});

test('balance with snapshot', () => {
  const acc = { id: 'b', type: 'bank', opening: 0 };
  const state = { tx: [
    { accountId: 'b', date: '2024-05-01', amount: 1000 },
    { accountId: 'b', date: '2024-05-10', amount: -300 },
    { accountId: 'b', date: '2024-05-20', amount: 500 },
  ], snapshots: [{ accountId: 'b', date: '2024-05-15', value: 10000 }] };
  assert.equal(balanceAt(state, acc, '2024-05-31'), 10500);
  assert.equal(balanceAt(state, acc, '2024-05-15'), 10000);
  assert.equal(balanceAt(state, acc, '2024-05-05'), 10300);
});

test('summarize excludes transfers and nets refunds', () => {
  const s = summarize([
    { kind: 'income', amount: 1000 },
    { kind: 'expense', amount: -500, category: '食費' },
    { kind: 'expense', amount: 100, category: '食費' },
    { kind: 'transfer', amount: -999 },
  ]);
  assert.equal(s.income, 1000);
  assert.equal(s.expense, 400);
  assert.deepEqual(s.cats, [{ name: '食費', amount: 400 }]);
});

test('simulate compounding', () => {
  const rows = simulate({ salary: 300000, bonus: 0, bonusMonths: [], living: 200000, invest: 50000, returnRate: 0, salaryGrowth: 0, years: 1 },
    { ym: '2024-12', cash: 0, invest: 0 });
  const last = rows[rows.length - 1];
  assert.equal(last.cash, 50000 * 12);
  assert.equal(last.invest, 50000 * 12);
  const r2 = simulate({ salary: 0, living: 0, invest: 0, returnRate: 12, years: 1, bonusMonths: [] }, { ym: '2024-12', cash: 0, invest: 100 });
  assert.ok(Math.abs(r2[12].invest - 112) < 1e-9);
});

test('detectRecurring finds subscriptions but not supermarkets', () => {
  const tx = [];
  for (const m of ['01', '02', '03', '04']) {
    tx.push({ date: `2024-${m}-03`, amount: -1490, kind: 'expense', payee: 'Netflix', category: 'サブスク' });
    for (const d of ['05', '12', '19']) tx.push({ date: `2024-${m}-${d}`, amount: -3000, kind: 'expense', payee: 'イオン', category: '食費' });
  }
  const r = detectRecurring({ tx }, '2024-04');
  assert.deepEqual(r.map((x) => x.payee), ['Netflix']);
  assert.equal(r[0].monthly, 1490);
});

test('セゾンカードの明細CSV（先頭に請求情報の行がある形式）', () => {
  const csv = `カード名称,セゾンゴールド・アメリカン・エキスプレス・カード
お支払日,2026/10/05
今回ご請求額,0000001500

利用日,ご利用店名及び商品名,本人・家族区分,支払区分名称,締前入金区分,利用金額,備考
2026/08/12,ETC西日本  (テスト→テスト),,1回,,1000,
2026/08/13,テストでんき,,1回,,500,`;
  const rows = parseCSV(csv);
  const { mapping } = guessMapping(rows, 'card');
  const list = parseGeneric(rows, mapping);
  assert.deepEqual(list.map((t) => [t.date, t.amount]), [['2026-08-12', -1000], ['2026-08-13', -500]]);
  const rules = defaultRules();
  list.forEach((t) => categorize(t, rules, 'card'));
  assert.deepEqual(list.map((t) => t.category), ['交通費', '水道光熱費']);
});
