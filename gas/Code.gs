/**
 * おかねナビ 自動連携スクリプト（Google Apps Script）
 *
 * Gmail に届くカード・銀行の利用通知メールを読み取り、おかねナビに渡します。
 * iPhone のショートカット（Apple Pay で支払った時）からの記録も受け付けます。
 * あなたの Google アカウントの中だけで動き、データは他の場所に送られません。
 *
 * 使い方はアプリの「設定 → 自動連携」を見てください。
 */

const TOKEN_KEY = 'OKANE_TOKEN';
const TZ = 'Asia/Tokyo';
const SHORTCUT_PREFIX = 'sc_';
const KEEP_DAYS = 120;

// 読み取る送信元
const QUERY = '(from:statement@vpass.ne.jp OR from:mail@qa.jcb.co.jp OR from:smbc_service@dn.smbc.co.jp)';

// ---------- 最初に1回だけ実行 ----------

function setup() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty(TOKEN_KEY);
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty(TOKEN_KEY, token);
  }
  const res = collect_(daysAgo_(30));
  Logger.log('合言葉（アプリに貼り付けてください）: ' + token);
  Logger.log('直近30日で読み取れた通知: ' + res.items.length + '件 / 読み取れなかったメール: ' + res.unparsed.length + '件');
  res.items.slice(0, 5).forEach((x) => Logger.log(JSON.stringify(x)));
}

// ---------- Web アプリ ----------

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!checkToken_(p.token)) return json_({ error: 'unauthorized' });
  const since = /^\d{4}-\d{2}-\d{2}$/.test(p.since || '') ? p.since : daysAgo_(60);
  return json_(collect_(since));
}

// iPhone ショートカットからの記録
function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { body = {}; }
  const p = Object.assign({}, (e && e.parameter) || {}, body);
  if (!checkToken_(p.token)) return json_({ error: 'unauthorized' });
  const amount = parseYen_(p.amount);
  if (amount == null) return json_({ error: 'amount' });
  const now = new Date();
  const item = {
    id: 'sc-' + now.getTime() + '-' + Math.random().toString(36).slice(2, 6),
    type: 'tx',
    source: 'applepay',
    key: 'applepay:' + norm_(p.card || 'Apple Pay'),
    label: 'Apple Pay（' + norm_(p.card || 'カード') + '）',
    date: Utilities.formatDate(now, TZ, 'yyyy-MM-dd'),
    time: Utilities.formatDate(now, TZ, 'HH:mm'),
    amount: -Math.abs(amount),
    payee: norm_(p.merchant || p.payee || ''),
  };
  const props = PropertiesService.getScriptProperties();
  props.setProperty(SHORTCUT_PREFIX + item.id, JSON.stringify(item));
  cleanupShortcuts_(props);
  return json_({ ok: true, item: item });
}

// ---------- 収集 ----------

function collect_(since) {
  const items = [];
  const unparsed = [];
  const after = since.replace(/-/g, '/');
  // after: は日付の0時基準なので1日前から探して日付で絞る
  const query = QUERY + ' after:' + shiftDate_(after, -1);
  for (let start = 0; start < 1000; start += 100) {
    const threads = GmailApp.search(query, start, 100);
    if (!threads.length) break;
    for (const th of threads) {
      for (const m of th.getMessages()) {
        const date = Utilities.formatDate(m.getDate(), TZ, 'yyyy-MM-dd');
        if (date < since) continue;
        const parsed = parseMessage_(m.getFrom(), m.getSubject(), m.getPlainBody(), m.getDate(), m.getId());
        if (parsed === null) continue; // 対象外のメール
        if (!parsed.length) unparsed.push({ date: date, from: m.getFrom(), subject: m.getSubject() });
        items.push.apply(items, parsed);
      }
    }
    if (threads.length < 100) break;
  }
  const props = PropertiesService.getScriptProperties().getProperties();
  for (const k in props) {
    if (k.indexOf(SHORTCUT_PREFIX) !== 0) continue;
    try {
      const it = JSON.parse(props[k]);
      if (it.date >= since) items.push(it);
    } catch (err) { /* 壊れた記録は無視 */ }
  }
  return { ok: true, since: since, generatedAt: new Date().toISOString(), items: items, unparsed: unparsed };
}

// ---------- メールの読み取り ----------
// 戻り値: null = 対象外のメール / [] = 対象だが読み取れなかった / [item...]

function parseMessage_(from, subject, body, dateObj, msgId) {
  from = String(from || '').toLowerCase();
  subject = norm_(subject);
  const text = norm_(body);
  const received = Utilities.formatDate(dateObj, TZ, 'yyyy-MM-dd');

  // 三井住友カード
  if (from.indexOf('vpass.ne.jp') >= 0) {
    if (subject.indexOf('ご利用のお知らせ') < 0) return null;
    const card = pick_(text, /ご利用カード\s*[:：]\s*(.+)/) || '三井住友カード';
    let date = pick_(text, /利用日(?:時)?\s*[:：]\s*(\d{4}\/\d{1,2}\/\d{1,2})/);
    let time = pick_(text, /利用日(?:時)?\s*[:：]\s*\d{4}\/\d{1,2}\/\d{1,2}\s+(\d{1,2}:\d{2})/);
    let payee = pick_(text, /利用先\s*[:：]\s*(.+)/);
    let kind = pick_(text, /利用取引\s*[:：]\s*(.+)/) || '';
    let amount = parseYen_(pick_(text, /利用金額\s*[:：]\s*([\d,]+)\s*円/));
    if (amount == null) {
      // HTML 形式「ご利用日時：2026/01/01 12:00 お店（買物） 1,000円」
      const m = text.match(/ご利用日時\s*[:：]\s*(\d{4}\/\d{1,2}\/\d{1,2})\s+(\d{1,2}:\d{2})\s+(.+?)[(（]([^)）]*)[)）]\s*([\d,]+)\s*円/);
      if (m) { date = m[1]; time = m[2]; payee = m[3]; kind = m[4]; amount = parseYen_(m[5]); }
    }
    if (amount == null || !date) return [];
    const refund = /取消|返品|キャンセル/.test(kind);
    return [{
      id: 'm-' + msgId, type: 'tx', source: 'smbc-card',
      key: 'smbc-card:' + card, label: '三井住友カード（' + card + '）',
      date: isoDate_(date), time: time || '', amount: refund ? amount : -amount, payee: payee || '',
    }];
  }

  // JCB
  if (from.indexOf('jcb.co.jp') >= 0) {
    if (subject.indexOf('ご利用のお知らせ') < 0) return null;
    const card = pick_(text, /カード名称\s*[:：]\s*(.+)/) || 'JCBカード';
    const date = pick_(text, /【ご利用日時[^】]*】\s*(\d{4}\/\d{1,2}\/\d{1,2})/);
    const time = pick_(text, /【ご利用日時[^】]*】\s*\d{4}\/\d{1,2}\/\d{1,2}\s+(\d{1,2}:\d{2})/);
    const amount = parseYen_(pick_(text, /【ご利用金額】\s*([\d,]+)\s*円/));
    const payee = pick_(text, /【ご利用先】\s*(.+)/);
    if (amount == null || !date) return [];
    return [{
      id: 'm-' + msgId, type: 'tx', source: 'jcb',
      key: 'jcb:' + card, label: 'JCB（' + card + '）',
      date: isoDate_(date), time: time || '', amount: -amount, payee: payee || '',
    }];
  }

  // 三井住友銀行
  if (from.indexOf('smbc.co.jp') >= 0) {
    const base = { source: 'smbc-bank', key: 'smbc-bank', label: '三井住友銀行' };
    if (subject.indexOf('口座出金') >= 0) {
      const date = jpDate_(pick_(text, /出金日\s*[:：]\s*(\d{4}年\d{1,2}月\d{1,2}日)/)) || received;
      const out = [];
      const re = /出金額\s*[:：]\s*([\d,]+)\s*円\s*\n\s*内容\s*[:：]\s*(.+)/g;
      let m, n = 0;
      while ((m = re.exec(text))) {
        out.push(Object.assign({ id: 'm-' + msgId + '-' + n++, type: 'tx', date: date, time: '', amount: -parseYen_(m[1]), payee: m[2].trim() }, base));
      }
      return out;
    }
    if (subject.indexOf('引き落としの事前') >= 0 || subject.indexOf('引落しの事前') >= 0) {
      const date = jpDate_(pick_(text, /引落予定日\s*[:：]\s*(\d{4}年\d{1,2}月\d{1,2}日)/));
      if (!date) return [];
      const out = [];
      const re = /引落金額\s*[:：]\s*([\d,]+)\s*円\s*\n\s*内容\s*[:：]\s*(.+)/g;
      let m, n = 0;
      while ((m = re.exec(text))) {
        out.push(Object.assign({ id: 'm-' + msgId + '-' + n++, type: 'scheduled', date: date, amount: -parseYen_(m[1]), payee: m[2].trim() }, base));
      }
      return out;
    }
    if (subject.indexOf('振込入金') >= 0) {
      // このメールには金額が書かれていないため、お知らせだけ渡す
      return [Object.assign({ id: 'm-' + msgId, type: 'notice', date: received, text: '振込入金がありました' }, base)];
    }
    return null;
  }
  return null;
}

// ---------- 小物 ----------

function norm_(s) {
  return String(s == null ? '' : s).normalize('NFKC').replace(/\r/g, '').replace(/[ \t　]+$/gm, '').trim();
}

function pick_(text, re) {
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

function parseYen_(s) {
  if (s == null) return null;
  const v = Number(String(s).normalize('NFKC').replace(/[^\d.\-]/g, ''));
  return isFinite(v) && String(s).match(/\d/) ? v : null;
}

function pad_(n) { return ('0' + n).slice(-2); }

function isoDate_(s) {
  const m = String(s).match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  return m ? m[1] + '-' + pad_(m[2]) + '-' + pad_(m[3]) : null;
}

function jpDate_(s) {
  const m = String(s || '').match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  return m ? m[1] + '-' + pad_(m[2]) + '-' + pad_(m[3]) : null;
}

function daysAgo_(n) {
  return Utilities.formatDate(new Date(Date.now() - n * 86400000), TZ, 'yyyy-MM-dd');
}

function shiftDate_(ymdSlash, days) {
  const p = ymdSlash.split('/').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
  return d.getUTCFullYear() + '/' + pad_(d.getUTCMonth() + 1) + '/' + pad_(d.getUTCDate());
}

function checkToken_(t) {
  const token = PropertiesService.getScriptProperties().getProperty(TOKEN_KEY);
  return !!token && t === token;
}

function cleanupShortcuts_(props) {
  const limit = daysAgo_(KEEP_DAYS);
  const all = props.getProperties();
  for (const k in all) {
    if (k.indexOf(SHORTCUT_PREFIX) !== 0) continue;
    try { if (JSON.parse(all[k]).date < limit) props.deleteProperty(k); } catch (err) { props.deleteProperty(k); }
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
