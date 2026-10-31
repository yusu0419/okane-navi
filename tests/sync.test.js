import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSync, processSync, guessAccount, findNearDup, sinceFor } from '../js/sync.js';
import { defaultRules } from '../js/rules.js';

const accounts = [
  { id: 'bank', type: 'bank', name: '三井住友銀行' },
  { id: 'olive', type: 'card', name: 'Olive' },
  { id: 'amz', type: 'card', name: 'Amazonマスター' },
  { id: 'jcb', type: 'card', name: 'ANA JCB' },
  { id: 'saison', type: 'card', name: 'セゾンカード' },
];
const item = (o) => ({ type: 'tx', time: '', ...o });

test('guessAccount picks the matching card', () => {
  assert.equal(guessAccount(accounts, { source: 'smbc-card', key: 'smbc-card:Olive/クレジット' }).id, 'olive');
  assert.equal(guessAccount(accounts, { source: 'smbc-card', key: 'smbc-card:Amazonマスター' }).id, 'amz');
  assert.equal(guessAccount(accounts, { source: 'jcb', key: 'jcb:ANAJCBカード' }).id, 'jcb');
  assert.equal(guessAccount(accounts, { source: 'smbc-bank', key: 'smbc-bank' }).id, 'bank');
  assert.equal(guessAccount([{ id: 'x', type: 'card', name: '楽天カード' }], { source: 'jcb', key: 'jcb:ANAJCBカード' }), null);
});

test('processSync adds, categorizes, dedupes and keeps pending', () => {
  const state = { accounts, rules: defaultRules(), tx: [
    { id: 'csv1', accountId: 'olive', date: '2026-10-02', amount: -980, source: 'csv', extId: 'x' },
  ], sync: defaultSync() };
  const items = [
    item({ id: 'a', source: 'smbc-card', key: 'smbc-card:Olive/クレジット', label: 'L', date: '2026-10-01', amount: -980, payee: 'ローソン' }), // CSV と重複
    item({ id: 'b', source: 'smbc-card', key: 'smbc-card:Olive/クレジット', label: 'L', date: '2026-10-05', amount: -354, payee: 'セブン-イレブン' }),
    item({ id: 'c', source: 'smbc-bank', key: 'smbc-bank', label: '三井住友銀行', date: '2026-10-18', amount: -5000, payee: 'PAYPAY' }),
    item({ id: 'd', source: 'applepay', key: 'applepay:Suica', label: 'Apple Pay（Suica）', date: '2026-10-06', amount: -200, payee: 'JR東日本' }),
    { id: 'n', type: 'notice', source: 'smbc-bank', key: 'smbc-bank', label: '三井住友銀行', date: '2099-01-01', text: '振込入金がありました' },
    { id: 's', type: 'scheduled', source: 'smbc-bank', key: 'smbc-bank', label: '三井住友銀行', date: '2099-11-04', amount: -1000, payee: 'セゾン' },
  ];
  const { add } = processSync(state, items);
  assert.deepEqual(add.map((t) => [t.accountId, t.amount, t.kind, t.category, t.source]), [
    ['olive', -354, 'expense', '食費', 'mail'],
    ['bank', -5000, 'transfer', 'チャージ', 'mail'],
  ]);
  assert.equal(state.sync.pending.length, 1); // Suica は口座が無い
  assert.equal(state.sync.notices.length, 1);
  assert.equal(state.sync.scheduled.length, 1);
  assert.equal(state.sync.map['smbc-card:Olive/クレジット'], 'olive');

  // 2回目：同じ通知は追加されない。Suica を口座に割り当てると pending が取り込まれる
  state.tx.push(...add);
  state.accounts = [...accounts, { id: 'suica', type: 'paypay', name: 'モバイルSuica' }];
  state.sync.map['applepay:Suica'] = 'suica';
  const { add: add2 } = processSync(state, items);
  assert.deepEqual(add2.map((t) => [t.accountId, t.source]), [['suica', 'shortcut']]);
  assert.equal(state.sync.pending.length, 0);
  assert.equal(state.sync.notices.length, 1);
});

test('skip mapping drops items', () => {
  const state = { accounts, rules: defaultRules(), tx: [], sync: { ...defaultSync(), map: { 'jcb:X': 'skip' } } };
  assert.equal(processSync(state, [item({ id: 'z', source: 'jcb', key: 'jcb:X', label: 'J', date: '2026-10-01', amount: -1, payee: '' })]).add.length, 0);
  assert.equal(state.sync.pending.length, 0);
});

test('findNearDup is one-to-one and source-aware', () => {
  const txs = [{ id: '1', accountId: 'a', amount: -500, date: '2026-10-01', source: 'mail' }];
  const used = new Set();
  const t = { accountId: 'a', amount: -500, date: '2026-10-03', source: 'csv' };
  assert.equal(findNearDup(txs, t, used).id, '1');
  used.add('1');
  assert.equal(findNearDup(txs, t, used), null);
  assert.equal(findNearDup(txs, { ...t, source: 'mail' }), null);
  assert.equal(findNearDup(txs, { ...t, date: '2026-10-08' }), null);
});

test('sinceFor', () => {
  assert.equal(sinceFor({ lastSync: null }, '2026-10-31'), '2026-08-02');
  assert.equal(sinceFor({ lastSync: '2026-10-31T01:00:00Z' }), '2026-10-17');
});

test('MoneyForward items: transfer flag, salary guess, payee enrichment', () => {
  const state = { accounts, rules: defaultRules(), tx: [], plan: { payday: 25, salary: 280000 }, sync: defaultSync() };
  const r1 = processSync(state, [
    item({ id: 'mf1', source: 'mf', key: 'mf:三井住友銀行', label: 'MF', date: '2026-10-26', amount: -20936, payee: '', transfer: true }),
    item({ id: 'mf2', source: 'mf', key: 'mf:三井住友銀行', label: 'MF', date: '2026-10-24', amount: 281000, payee: '' }),
    item({ id: 'mf3', source: 'mf', key: 'mf:セゾンカード(AMEX GOLD)', label: 'MF', date: '2026-09-27', amount: -16320, payee: '' }),
    item({ id: 'mf4', source: 'mf', key: 'mf:三井住友銀行', label: 'MF', date: '2026-10-27', amount: -82090, payee: '' }),
  ]);
  assert.deepEqual(r1.add.map((t) => [t.accountId, t.kind, t.category]), [
    ['bank', 'transfer', '口座間移動'], ['bank', 'income', '給与'], ['saison', 'expense', '未分類'], ['bank', 'expense', '未分類'],
  ]);
  state.tx.push(...r1.add);
  // 同じ出金の銀行メール（お店の名前つき）が後から届く → 補完
  const r2 = processSync(state, [item({ id: 'b1', source: 'smbc-bank', key: 'smbc-bank', label: 'B', date: '2026-10-27', amount: -82090, payee: 'ヤチン' })]);
  assert.equal(r2.add.length, 0);
  assert.deepEqual(r2.update.map((t) => [t.payee, t.category, t.source]), [['ヤチン', '住居', 'mf']]);
});
