import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Apps Script の Utilities を最小限だけ用意して Code.gs を読み込む
const ctx = {
  Utilities: {
    formatDate: (d, tz, f) => {
      const j = new Date(d.getTime() + 9 * 3600000);
      const p = (n) => String(n).padStart(2, '0');
      return f.replace('yyyy', j.getUTCFullYear()).replace('MM', p(j.getUTCMonth() + 1)).replace('dd', p(j.getUTCDate())).replace('HH', p(j.getUTCHours())).replace('mm', p(j.getUTCMinutes()));
    },
  },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../gas/Code.gs', import.meta.url), 'utf8'), ctx);
const parse = (from, subject, body, date = '2026-10-30T06:37:51Z') => JSON.parse(JSON.stringify(ctx.parseMessage_(from, subject, body, new Date(date), 'MID')));

test('三井住友カード（テキスト形式）', () => {
  const r = parse('statement@vpass.ne.jp', 'ご利用のお知らせ【三井住友カード】',
    'テスト　様\n\nご利用カード：Ｏｌｉｖｅ／クレジット\n\n◇利用日：2026/10/30 15:37\n◇利用先：セブン－イレブン\n◇利用取引：買物\n◇利用金額：1,354円\n');
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], { id: 'm-MID', type: 'tx', source: 'smbc-card', key: 'smbc-card:Olive/クレジット', label: '三井住友カード（Olive/クレジット）', date: '2026-10-30', time: '15:37', amount: -1354, payee: 'セブン-イレブン' });
});

test('三井住友カード（HTML形式のフォールバック）と取消', () => {
  const r = parse('statement@vpass.ne.jp', 'ご利用のお知らせ【三井住友カード】',
    'Ａｍａｚｏｎマスターについてカードの利用内容をお知らせします。 ご利用内容 ご利用日時：2026/09/10 11:32 ＡＭＡＺＯＮ．ＣＯ．ＪＰ（取消） 2,000円 本メールは');
  assert.equal(r[0].amount, 2000);
  assert.equal(r[0].payee, 'AMAZON.CO.JP');
  assert.equal(r[0].date, '2026-09-10');
});

test('三井住友カードの対象外メール', () => {
  assert.equal(parse('statement@vpass.ne.jp', 'カードがご利用いただけませんでした【三井住友カード】', ''), null);
  assert.deepEqual(parse('statement@vpass.ne.jp', 'ご利用のお知らせ【三井住友カード】', '形式が違う本文'), []);
});

test('JCB', () => {
  const r = parse('mail@qa.jcb.co.jp', 'JCBカード／ショッピングご利用のお知らせ',
    'テスト 様\nカード名称　：　ＡＮＡＪＣＢカード\n\n【ご利用日時(日本時間)】　2026/06/19 01:11\n【ご利用金額】　12,345円\n【ご利用先】　テストシヨウテン\n');
  assert.equal(r[0].key, 'jcb:ANAJCBカード');
  assert.equal(r[0].amount, -12345);
  assert.equal(r[0].payee, 'テストシヨウテン');
  assert.equal(r[0].time, '01:11');
  assert.equal(parse('mail@qa.jcb.co.jp', 'JCBカード2026年8月10日分お振替内容確定のご案内', ''), null);
});

test('三井住友銀行 口座出金・引落予定・振込入金', () => {
  const out = parse('SMBC_service@dn.smbc.co.jp', '【三井住友銀行】口座出金のお知らせ',
    'テストさま\n\n出金日　：　2026年10月18日\n出金額　：　5,000円\n内容　　：　PAYPAY\n');
  assert.deepEqual(out.map((x) => [x.type, x.date, x.amount, x.payee, x.key]), [['tx', '2026-10-18', -5000, 'PAYPAY', 'smbc-bank']]);
  const sch = parse('SMBC_service@dn.smbc.co.jp', '【三井住友銀行】口座引き落としの事前お知らせ',
    '口座引落予定日： 2026年11月04日\n\n◆明細１\n引落金額：　1,000円\n内容　　：　セゾン\n\n（…）\n\n◆明細２\n引落金額：　2,500円\n内容　　：　セゾン\n');
  assert.deepEqual(sch.map((x) => [x.type, x.date, x.amount, x.payee]), [['scheduled', '2026-11-04', -1000, 'セゾン'], ['scheduled', '2026-11-04', -2500, 'セゾン']]);
  assert.notEqual(sch[0].id, sch[1].id);
  const n = parse('SMBC_service@dn.smbc.co.jp', '【三井住友銀行】振込入金のお知らせ', '振込入金についてお知らせします。', '2026-10-19T02:45:53Z');
  assert.equal(n[0].type, 'notice');
  assert.equal(n[0].date, '2026-10-19');
});

test('マネーフォワードのアラートメール', () => {
  const row = (k, v) => `<tr><td width="100" bgcolor="#f9f6f0" style="font-weight: bold;">${k}</td><td style="padding:10px;">${v}</td></tr>`;
  const tbl = (a, d, v) => `<table width="500">${row('金融機関', a)}${row('出金日', d)}${row('出金額', v)}</table>\r\n`;
  const html = `<html><body><p>アラートメール（出金のお知らせ）</p><p>設定金額（10,000円）以上の出金がありました。<br>詳細は</p>
    <table><tr><td align="center">${tbl('三井住友銀行', '2026年10月27日', '12,345円')}${tbl('セゾンカード(AMEX GOLD)', '2026年10月26日', '20,000円（振替）')}</td></tr></table></body></html>`;
  const r = JSON.parse(JSON.stringify(ctx.parseMessage_('feedback@moneyforward.com', '【Money Forward ME】出金のお知らせ', 'HTMLメールをご覧ください', new Date(), 'X', html)));
  assert.deepEqual(r.map((x) => [x.key, x.date, x.amount, x.transfer, x.payee]), [
    ['mf:三井住友銀行', '2026-10-27', -12345, false, ''],
    ['mf:セゾンカード(AMEX GOLD)', '2026-10-26', -20000, true, ''],
  ]);
  const inHtml = html.replace(/出金/g, '入金');
  const r2 = JSON.parse(JSON.stringify(ctx.parseMessage_('feedback@moneyforward.com', '【Money Forward ME】入金のお知らせ', '', new Date(), 'Y', inHtml)));
  assert.equal(r2[0].amount, 12345);
  assert.equal(ctx.parseMessage_('feedback@moneyforward.com', '【Money Forward ME】セゾンカード(AMEX GOLD) 引き落としのお知らせ（2026年11月）', '', new Date(), 'Z', ''), null);
});
