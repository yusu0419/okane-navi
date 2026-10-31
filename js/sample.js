// お試し用のサンプルデータ
import { uid, addMonths, thisMonth, today, pad, daysInMonth, hash } from './util.js';
import { categorize } from './rules.js';

export async function loadSample(state, { putTx, saveKV }) {
  let seed = 42;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pickOne = (a) => a[Math.floor(rnd() * a.length)];
  const mk = (type, name, extra = {}) => {
    const a = { id: uid(), type, name, opening: 0, ...extra };
    state.accounts.push(a);
    return a;
  };
  const bank = mk('bank', 'サンプル銀行');
  const pp = mk('paypay', 'PayPay（サンプル）');
  const card = mk('card', 'カード（サンプル）', { closingDay: 31, payDay: 27 });
  const sec = mk('securities', '証券（サンプル）');
  const ana = mk('points', 'ANAマイル（サンプル）', { unit: 'マイル', rate: 1.5 });

  const tx = [];
  const now = today();
  const add = (acc, date, amount, payee) => {
    if (date > now) return;
    const t = { id: uid(), accountId: acc.id, date, amount, payee, content: '', memo: '', source: 'sample' };
    t.extId = 'sample:' + hash(acc.id + date + amount + payee + tx.length);
    categorize(t, state.rules, acc.type);
    tx.push(t);
  };
  const start = addMonths(thisMonth(), -6);
  for (let i = 0; i <= 6; i++) {
    const ym = addMonths(start, i);
    const d = (n) => `${ym}-${pad(Math.min(n, daysInMonth(ym)))}`;
    add(bank, d(25), 280000, '給与 カ）サンプルショウジ');
    if (ym.endsWith('-06') || ym.endsWith('-12')) add(bank, d(10), 450000, '賞与 カ）サンプルショウジ');
    add(bank, d(27), -85000, '家賃 サンプルフドウサン');
    add(bank, d(5), -30000, 'SBI証券 積立');
    add(bank, d(1), -20000, 'PAYPAY チャージ');
    add(pp, d(1), 20000, 'PayPayチャージ');
    add(bank, d(15), -2000, 'ATM');
    add(bank, d(26), -(7000 + Math.round(rnd() * 3000)), '東京電力');
    add(bank, d(26), -(3000 + Math.round(rnd() * 2000)), '東京ガス');
    for (let k = 0; k < 14; k++) {
      const day = 1 + Math.floor(rnd() * 28);
      add(pp, d(day), -(200 + Math.round(rnd() * 1200)), pickOne(['セブン-イレブン', 'ファミリーマート', 'ローソン', 'まいばすけっと', 'スターバックス', '松屋']));
    }
    for (let k = 0; k < 10; k++) {
      const day = 1 + Math.floor(rnd() * 28);
      add(card, d(day), -(800 + Math.round(rnd() * 6000)), pickOne(['イオン', 'Amazon.co.jp', 'ユニクロ', 'マツモトキヨシ', 'JR東日本', '居酒屋サンプル', 'ヨドバシカメラ', '紀伊國屋書店']));
    }
    add(card, d(3), -1490, 'Netflix');
    add(card, d(8), -2970, 'ahamo');
    add(card, d(12), -600, 'Amazon Prime');
    add(card, d(20), -3000, 'Claude.ai Subscription');
    // 前月分のカード引き落とし
    add(bank, d(27), -(30000 + Math.round(rnd() * 15000)), 'カード引落 サンプルカード');
    // 投資の評価額
    const v = 600000 + i * 30000 + Math.round(rnd() * 40000 - 10000);
    if (`${ym}-01` <= now) state.snapshots.push({ id: uid(), accountId: sec.id, date: d(28) > now ? now : d(28), value: v, cost: 600000 + i * 30000 });
  }
  state.snapshots.push({ id: uid(), accountId: bank.id, date: `${start}-01`, value: 800000 });
  state.snapshots.push({ id: uid(), accountId: ana.id, date: now, value: 23500, expiry: `${addMonths(thisMonth(), 1)}-28`, expiringValue: 3000 });
  if (!state.plan.salary) Object.assign(state.plan, { salary: 280000, payday: 25, bonus: 450000, invest: 30000 });
  await putTx(tx);
  await saveKV('accounts', 'snapshots', 'plan');
}
