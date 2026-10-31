import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile } from '../js/reconcile.js';

test('CSV confirms provisional, adds new, flags missing', () => {
  const stateTx = [
    { id: 'p1', accountId: 'c', date: '2026-10-03', amount: -1000, payee: '', kind: 'expense', category: '未分類', source: 'mf' },
    { id: 'p2', accountId: 'c', date: '2026-10-05', amount: -500, payee: 'セブン', kind: 'expense', category: '外食', userSet: true, source: 'mail' },
    { id: 'p3', accountId: 'c', date: '2026-10-07', amount: -800, payee: '取消された店', kind: 'expense', category: '未分類', source: 'mail' },
    { id: 'p4', accountId: 'c', date: '2026-10-30', amount: -300, payee: '月末', kind: 'expense', category: '未分類', source: 'mail' },
    { id: 'old', accountId: 'c', date: '2026-10-01', amount: -100, payee: 'x', source: 'csv', extId: 'E0' },
  ];
  const list = [
    { id: 'n1', accountId: 'c', date: '2026-10-04', amount: -1000, payee: 'イオン', kind: 'expense', category: '食費', source: 'csv', extId: 'E1' },
    { id: 'n2', accountId: 'c', date: '2026-10-05', amount: -500, payee: 'セブンイレブン', kind: 'expense', category: '食費', source: 'csv', extId: 'E2' },
    { id: 'n3', accountId: 'c', date: '2026-10-20', amount: -4000, payee: '電気', kind: 'expense', category: '水道光熱費', source: 'csv', extId: 'E3' },
    { id: 'n4', accountId: 'c', date: '2026-10-31', amount: -100, payee: 'y', kind: 'expense', category: '未分類', source: 'csv', extId: 'E0' },
  ];
  const r = reconcile(stateTx, list);
  assert.deepEqual(r.fresh.map((t) => t.id), ['n3']);
  assert.equal(r.dup, 1);
  assert.deepEqual(r.confirm.map((t) => [t.id, t.payee, t.category, t.confirmed, t.source]), [
    ['p1', 'イオン', '食費', true, 'csv'],
    ['p2', 'セブンイレブン', '外食', true, 'csv'], // 手で直した分類は残す
  ]);
  // p3 は明細の期間内なのに無い → 要確認。p4 は明細の末尾3日以内なので対象外
  assert.deepEqual(r.review.map((t) => t.id), ['p3']);
});
