// カテゴリ定義と自動分類ルール
import { norm, uid } from './util.js';

export const KINDS = {
  expense: '支出',
  income: '収入',
  transfer: '振替',
};

const PALETTE = [
  '#ef6c57', '#f2a541', '#e9c46a', '#8ab17d', '#2a9d8f', '#4ea8de', '#5e60ce',
  '#9d4edd', '#d6589f', '#b5838d', '#6d6875', '#7f8c8d', '#c0a080', '#3d8b7d',
  '#e07a5f', '#81b29a', '#a8a8a8',
];

const EXPENSE = [
  '食費', '外食', '日用品', 'ショッピング', '交通費', '住居', '水道光熱費', '通信費',
  'サブスク', '趣味・娯楽', '交際費', '衣服・美容', '健康・医療', '教育・教養', '保険',
  '税・社会保険', '特別な支出', '未分類',
];
const INCOME = ['給与', '賞与', '副業', '臨時収入', 'ポイント・還元', '利息・配当', 'その他収入'];
const TRANSFER = ['チャージ', 'カード支払い', '投資・積立', '現金引出', '口座間移動'];

export function defaultCategories() {
  return [
    ...EXPENSE.map((name, i) => ({ name, kind: 'expense', color: PALETTE[i % PALETTE.length] })),
    ...INCOME.map((name, i) => ({ name, kind: 'income', color: ['#2a9d8f', '#3d8b7d', '#81b29a', '#8ab17d', '#e9c46a', '#4ea8de', '#a8a8a8'][i] })),
    ...TRANSFER.map((name) => ({ name, kind: 'transfer', color: '#9aa5b1' })),
  ];
}

// [キーワード, 種別, カテゴリ, 対象口座タイプ（省略時は全て）]
// 上から順に評価され、最初に一致したものが使われる
const DEFAULT_RULES = [
  // 収入
  ['給与', 'income', '給与', ['bank']],
  ['給料', 'income', '給与', ['bank']],
  ['キュウヨ', 'income', '給与', ['bank']],
  ['賞与', 'income', '賞与', ['bank']],
  ['ショウヨ', 'income', '賞与', ['bank']],
  ['利息', 'income', '利息・配当', ['bank']],
  ['リソク', 'income', '利息・配当', ['bank']],
  ['配当', 'income', '利息・配当'],
  // 振替（自分の口座間のお金の移動。収支には含めない）
  ['カード', 'transfer', 'カード支払い', ['bank']],
  ['JCB', 'transfer', 'カード支払い', ['bank']],
  ['セゾン', 'transfer', 'カード支払い', ['bank']],
  ['エポス', 'transfer', 'カード支払い', ['bank']],
  ['カ-ド', 'transfer', 'カード支払い', ['bank']],
  ['PayPayチャージ', 'transfer', 'チャージ'],
  ['ペイペイ', 'transfer', 'チャージ', ['bank']],
  ['PAYPAY', 'transfer', 'チャージ', ['bank']],
  ['モバイルSuicaチャージ', 'transfer', 'チャージ'],
  ['証券', 'transfer', '投資・積立', ['bank', 'card']],
  ['ショウケン', 'transfer', '投資・積立', ['bank']],
  ['ATM', 'transfer', '現金引出', ['bank']],
  // 税金・社保（「保険」より先に）
  ['住民税', 'expense', '税・社会保険'],
  ['所得税', 'expense', '税・社会保険'],
  ['固定資産税', 'expense', '税・社会保険'],
  ['自動車税', 'expense', '税・社会保険'],
  ['国民年金', 'expense', '税・社会保険'],
  ['国民健康保険', 'expense', '税・社会保険'],
  ['ふるさと納税', 'expense', '税・社会保険'],
  // サブスク（Amazon より先に）
  ['Amazon Prime', 'expense', 'サブスク'],
  ['Netflix', 'expense', 'サブスク'],
  ['Spotify', 'expense', 'サブスク'],
  ['YouTube', 'expense', 'サブスク'],
  ['Apple.com', 'expense', 'サブスク'],
  ['iCloud', 'expense', 'サブスク'],
  ['Disney', 'expense', 'サブスク'],
  ['U-NEXT', 'expense', 'サブスク'],
  ['Hulu', 'expense', 'サブスク'],
  ['DAZN', 'expense', 'サブスク'],
  ['ChatGPT', 'expense', 'サブスク'],
  ['OpenAI', 'expense', 'サブスク'],
  ['Anthropic', 'expense', 'サブスク'],
  ['Claude', 'expense', 'サブスク'],
  // 外食
  ['Uber Eats', 'expense', '外食'],
  ['出前館', 'expense', '外食'],
  ['マクドナルド', 'expense', '外食'],
  ['スターバックス', 'expense', '外食'],
  ['ドトール', 'expense', '外食'],
  ['タリーズ', 'expense', '外食'],
  ['すき家', 'expense', '外食'],
  ['吉野家', 'expense', '外食'],
  ['松屋', 'expense', '外食'],
  ['ガスト', 'expense', '外食'],
  ['サイゼリヤ', 'expense', '外食'],
  ['スシロー', 'expense', '外食'],
  ['くら寿司', 'expense', '外食'],
  ['ケンタッキー', 'expense', '外食'],
  ['モスバーガー', 'expense', '外食'],
  ['丸亀製麺', 'expense', '外食'],
  ['居酒屋', 'expense', '外食'],
  // 食費（コンビニ・スーパー）
  ['セブン-イレブン', 'expense', '食費'],
  ['セブンイレブン', 'expense', '食費'],
  ['ファミリーマート', 'expense', '食費'],
  ['ローソン', 'expense', '食費'],
  ['ミニストップ', 'expense', '食費'],
  ['デイリーヤマザキ', 'expense', '食費'],
  ['まいばすけっと', 'expense', '食費'],
  ['イオン', 'expense', '食費'],
  ['西友', 'expense', '食費'],
  ['ライフ', 'expense', '食費'],
  ['業務スーパー', 'expense', '食費'],
  ['オーケー', 'expense', '食費'],
  ['成城石井', 'expense', '食費'],
  ['イトーヨーカドー', 'expense', '食費'],
  ['マルエツ', 'expense', '食費'],
  ['サミット', 'expense', '食費'],
  ['ヤオコー', 'expense', '食費'],
  ['コストコ', 'expense', '食費'],
  ['スーパー', 'expense', '食費'],
  // 日用品
  ['マツモトキヨシ', 'expense', '日用品'],
  ['ウエルシア', 'expense', '日用品'],
  ['スギ薬局', 'expense', '日用品'],
  ['ツルハ', 'expense', '日用品'],
  ['サンドラッグ', 'expense', '日用品'],
  ['ココカラファイン', 'expense', '日用品'],
  ['ダイソー', 'expense', '日用品'],
  ['セリア', 'expense', '日用品'],
  ['ニトリ', 'expense', '日用品'],
  ['無印良品', 'expense', '日用品'],
  ['カインズ', 'expense', '日用品'],
  ['ドラッグ', 'expense', '日用品'],
  // ショッピング
  ['Amazon', 'expense', 'ショッピング'],
  ['アマゾン', 'expense', 'ショッピング'],
  ['楽天市場', 'expense', 'ショッピング'],
  ['Yahoo!ショッピング', 'expense', 'ショッピング'],
  ['ヨドバシ', 'expense', 'ショッピング'],
  ['ビックカメラ', 'expense', 'ショッピング'],
  ['メルカリ', 'expense', 'ショッピング'],
  // 交通
  ['JR', 'expense', '交通費'],
  ['Suica', 'expense', '交通費'],
  ['PASMO', 'expense', '交通費'],
  ['ICOCA', 'expense', '交通費'],
  ['メトロ', 'expense', '交通費'],
  ['鉄道', 'expense', '交通費'],
  ['バス', 'expense', '交通費'],
  ['タクシー', 'expense', '交通費'],
  ['全日空', 'expense', '交通費'],
  ['日本航空', 'expense', '交通費'],
  ['ENEOS', 'expense', '交通費'],
  ['出光', 'expense', '交通費'],
  ['駐車場', 'expense', '交通費'],
  ['タイムズ', 'expense', '交通費'],
  // 通信
  ['docomo', 'expense', '通信費'],
  ['ドコモ', 'expense', '通信費'],
  ['ahamo', 'expense', '通信費'],
  ['KDDI', 'expense', '通信費'],
  ['povo', 'expense', '通信費'],
  ['ソフトバンク', 'expense', '通信費'],
  ['SoftBank', 'expense', '通信費'],
  ['LINEMO', 'expense', '通信費'],
  ['楽天モバイル', 'expense', '通信費'],
  ['ワイモバイル', 'expense', '通信費'],
  ['UQ', 'expense', '通信費'],
  ['NURO', 'expense', '通信費'],
  // 光熱費
  ['電力', 'expense', '水道光熱費'],
  ['電気', 'expense', '水道光熱費'],
  ['ガス', 'expense', '水道光熱費'],
  ['水道', 'expense', '水道光熱費'],
  ['デンキ', 'expense', '水道光熱費'],
  // 住居
  ['家賃', 'expense', '住居'],
  ['ヤチン', 'expense', '住居'],
  ['管理費', 'expense', '住居'],
  // 保険・医療
  ['保険', 'expense', '保険'],
  ['ホケン', 'expense', '保険'],
  ['病院', 'expense', '健康・医療'],
  ['クリニック', 'expense', '健康・医療'],
  ['医院', 'expense', '健康・医療'],
  ['歯科', 'expense', '健康・医療'],
  ['薬局', 'expense', '健康・医療'],
  // 衣服・美容
  ['ユニクロ', 'expense', '衣服・美容'],
  ['ZARA', 'expense', '衣服・美容'],
  ['しまむら', 'expense', '衣服・美容'],
  ['美容', 'expense', '衣服・美容'],
  ['ヘアサロン', 'expense', '衣服・美容'],
  // 教養・娯楽
  ['書店', 'expense', '教育・教養'],
  ['紀伊國屋', 'expense', '教育・教養'],
  ['Kindle', 'expense', '教育・教養'],
  ['Udemy', 'expense', '教育・教養'],
  ['映画', 'expense', '趣味・娯楽'],
  ['TOHOシネマズ', 'expense', '趣味・娯楽'],
  ['Steam', 'expense', '趣味・娯楽'],
  ['Nintendo', 'expense', '趣味・娯楽'],
  ['PlayStation', 'expense', '趣味・娯楽'],
  ['カラオケ', 'expense', '趣味・娯楽'],
];

export function defaultRules() {
  return DEFAULT_RULES.map(([keyword, kind, category, accountTypes]) => ({
    id: uid(),
    keyword,
    kind,
    category,
    accountTypes: accountTypes || null,
    builtin: true,
  }));
}

// ルール配列から一致するものを探す。user ルールが先頭に来る前提
export function matchRule(rules, text, accountType) {
  const t = norm(text);
  if (!t) return null;
  for (const r of rules) {
    if (r.accountTypes && accountType && !r.accountTypes.includes(accountType)) continue;
    const k = norm(r.keyword);
    if (k && t.includes(k)) return r;
  }
  return null;
}

// 取引に分類を付与（kind/category が確定していないものだけ）
export function categorize(tx, rules, accountType, fallbackKind = null) {
  const text = [tx.payee, tx.content, tx.memo].filter(Boolean).join(' ');
  const r = matchRule(rules, text, accountType);
  if (r) {
    tx.kind = r.kind;
    tx.category = r.category;
    return tx;
  }
  if (!tx.kind) tx.kind = fallbackKind || (tx.amount >= 0 ? 'income' : 'expense');
  if (!tx.category) tx.category = tx.kind === 'income' ? 'その他収入' : tx.kind === 'transfer' ? '口座間移動' : '未分類';
  return tx;
}
