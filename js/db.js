// IndexedDB による端末内保存。起動時に全件メモリへ読み込み、変更は都度書き込む
import { defaultCategories, defaultRules } from './rules.js';

const DB_NAME = 'okane-navi';
const VERSION = 1;

let db;

function req(r) {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('tx')) d.createObjectStore('tx', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export const state = {
  tx: [], // 取引
  accounts: [], // 口座
  categories: [], // カテゴリ
  rules: [], // 分類ルール（先頭ほど優先）
  snapshots: [], // 証券・ポイントの残高記録
  budgets: {}, // カテゴリ名 → 月予算
  plan: null, // 給料・積立などの将来設定
  meta: {}, // 最終バックアップ日など
};

const KV_KEYS = ['accounts', 'categories', 'rules', 'snapshots', 'budgets', 'plan', 'meta'];

export function defaultPlan() {
  return {
    salary: 0, // 毎月の手取り
    payday: 25,
    bonus: 0, // 1回あたりの手取り賞与
    bonusMonths: [6, 12],
    living: null, // 毎月の生活費（null なら実績の平均）
    invest: 0, // 毎月の積立額
    returnRate: 4, // 想定利回り（年%）
    salaryGrowth: 1, // 昇給率（年%）
    years: 20,
    events: [], // { ym, amount, label } 大きな出費・収入の予定
  };
}

export async function load() {
  db = await open();
  const t = db.transaction(['tx', 'kv'], 'readonly');
  state.tx = await req(t.objectStore('tx').getAll());
  for (const k of KV_KEYS) {
    const v = await req(t.objectStore('kv').get(k));
    if (v !== undefined) state[k] = v;
  }
  let changed = false;
  if (!state.categories.length) { state.categories = defaultCategories(); changed = true; }
  if (!state.rules.length) { state.rules = defaultRules(); changed = true; }
  if (!state.plan) { state.plan = defaultPlan(); changed = true; }
  else state.plan = { ...defaultPlan(), ...state.plan };
  if (changed) await saveKV('categories', 'rules', 'plan');
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
}

export async function saveKV(...keys) {
  const t = db.transaction('kv', 'readwrite');
  for (const k of keys) t.objectStore('kv').put(state[k], k);
  await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
}

export async function putTx(list) {
  const arr = Array.isArray(list) ? list : [list];
  const t = db.transaction('tx', 'readwrite');
  for (const x of arr) t.objectStore('tx').put(x);
  await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
  const byId = new Map(state.tx.map((x, i) => [x.id, i]));
  for (const x of arr) {
    if (byId.has(x.id)) state.tx[byId.get(x.id)] = x;
    else state.tx.push(x);
  }
}

export async function deleteTx(ids) {
  const set = new Set(Array.isArray(ids) ? ids : [ids]);
  const t = db.transaction('tx', 'readwrite');
  for (const id of set) t.objectStore('tx').delete(id);
  await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
  state.tx = state.tx.filter((x) => !set.has(x.id));
}

export function exportAll() {
  const o = { app: 'okane-navi', version: 1, exportedAt: new Date().toISOString(), tx: state.tx };
  for (const k of KV_KEYS) o[k] = state[k];
  return o;
}

export async function importAll(o) {
  if (o?.app !== 'okane-navi') throw new Error('このアプリのバックアップファイルではありません');
  const t = db.transaction(['tx', 'kv'], 'readwrite');
  t.objectStore('tx').clear();
  for (const x of o.tx || []) t.objectStore('tx').put(x);
  for (const k of KV_KEYS) if (o[k] !== undefined) t.objectStore('kv').put(o[k], k);
  await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
  await load();
}

export async function wipe() {
  const t = db.transaction(['tx', 'kv'], 'readwrite');
  t.objectStore('tx').clear();
  t.objectStore('kv').clear();
  await new Promise((res) => { t.oncomplete = res; });
  for (const k of KV_KEYS) state[k] = Array.isArray(state[k]) ? [] : k === 'budgets' || k === 'meta' ? {} : null;
  state.tx = [];
  await load();
}
