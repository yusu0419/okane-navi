// CSV の文字コード判定とパース

// UTF-8 として正しく読めなければ Shift_JIS（銀行・カード明細に多い）として読む
export function decode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  try {
    return stripBOM(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    try {
      return new TextDecoder('shift_jis').decode(bytes);
    } catch {
      return stripBOM(new TextDecoder('utf-8').decode(bytes));
    }
  }
}

const stripBOM = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

export function detectDelimiter(text) {
  const head = text.split(/\r?\n/).slice(0, 10).join('\n');
  const tabs = (head.match(/\t/g) || []).length;
  const commas = (head.match(/,/g) || []).length;
  return tabs > commas ? '\t' : ',';
}

// RFC4180 準拠の簡易パーサ（ダブルクォート内の改行・カンマ対応）
export function parseCSV(text, delim = detectDelimiter(text)) {
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else q = false;
      } else field += c;
    } else if (c === '"' && field === '') {
      q = true;
    } else if (c === delim) {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows
    .map((r) => r.map((f) => f.trim()))
    .filter((r) => r.some((f) => f !== ''));
}

export function toCSV(rows) {
  return rows
    .map((r) => r.map((v) => {
      const s = String(v ?? '');
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(','))
    .join('\r\n');
}
