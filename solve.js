// solve.js — CSV reader cepat, ES module, Node 22, tanpa dependensi.
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// ---------- Jalur cepat: teks tanpa tanda kutip dan tanpa CR ----------
function parseSimple(text, s, n, header) {
  const rows = [];
  const errors = [];
  let columns = null;
  let width = -1;
  let pos = s;
  let line = 1;
  let nComma = -1;
  while (pos < n) {
    let e = text.indexOf('\n', pos);
    if (e === -1) e = n;
    if (e === pos) { pos++; line++; continue; } // baris kosong
    const rec = [];
    let p = pos;
    for (;;) {
      if (nComma < p) { nComma = text.indexOf(',', p); if (nComma === -1) nComma = n; }
      if (nComma >= e) { rec.push(text.slice(p, e)); break; }
      rec.push(text.slice(p, nComma));
      p = nComma + 1;
    }
    const len = rec.length;
    if (width < 0) {
      width = len;
      if (header) columns = rec; else rows.push(rec);
    } else if (len === width) {
      rows.push(rec);

    } else if (len < width) {
      errors.push({ code: 'short_row', line, row: rows.length, fields: len });
      while (rec.length < width) rec.push('');
      rows.push(rec);
    } else {
      errors.push({ code: 'long_row', line, row: rows.length, extra: rec.slice(width) });
      rec.length = width;
      rows.push(rec);
    }
    pos = e + 1;
    line++;
  }
  return { columns, rows, errors };
}

// ---------- Jalur umum: quotes, CR, junk, unterminated ----------
function parseGeneral(text, s, n, header, hasCR) {
  const rows = [];
  const errors = [];
  let columns = null;
  let width = -1;
  let first = true;
  let pos = s;
  let line = 1;
  let nComma = -1, nLF = -1, nCR = hasCR ? -1 : n;
  const lastQ = text.lastIndexOf('"');

  while (pos < n) {
    let c = text.charCodeAt(pos);
    if (c === 10) { pos++; line++; continue; }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line++; continue; }


    const recLine = line;
    const ri = (first && header) ? null : rows.length;
    const rec = [];
    let lastQuoted = false;

    for (;;) {
      let f = '';
      let closed = false;
      lastQuoted = pos < n && text.charCodeAt(pos) === 34;

      if (lastQuoted) {
        const q0 = pos + 1;
        let q = q0, k = -1, content = '', ok = false;
        while (q <= lastQ) {
          k = text.indexOf('"', q);
          if (text.charCodeAt(k + 1) === 34) { content += text.slice(q, k + 1); q = k + 2; }
          else { content += text.slice(q, k); ok = true; break; }
        }
        if (ok) {
          closed = true;
          if (nLF < pos) { nLF = text.indexOf('\n', pos); if (nLF === -1) nLF = n; }
          if (nCR < pos) { nCR = text.indexOf('\r', pos); if (nCR === -1) nCR = n; }
          if (nLF < k || nCR < k) {
            for (let i = q0; i < k; i++) {
              const ch = text.charCodeAt(i);
              if (ch === 10) line++;
              else if (ch === 13 && text.charCodeAt(i + 1) !== 10) line++;
            }
          }
          if (hasCR && content.indexOf('\r') !== -1) content = content.replace(/\r\n?/g, '\n');
          f = content;
          pos = k + 1;
        } else {
          errors.push({ code: 'unterminated_quote', line: recLine, row: ri });
        }
        // tidak tertutup: pos tetap di tanda kutip pembuka, dibaca ulang sebagai unquoted

      }

      // ekor field: unquoted biasa, junk setelah kutip penutup, atau unterminated
      let junk = false;
      for (;;) {
        if (nComma < pos) { nComma = text.indexOf(',', pos); if (nComma === -1) nComma = n; }
        if (nLF < pos) { nLF = text.indexOf('\n', pos); if (nLF === -1) nLF = n; }
        if (nCR < pos) { nCR = text.indexOf('\r', pos); if (nCR === -1) nCR = n; }
        let end = nComma < nLF ? nComma : nLF;
        if (nCR < end) end = nCR;
        if (end > pos) {
          f = f === '' ? text.slice(pos, end) : f + text.slice(pos, end);
          if (closed) junk = true;
          pos = end;
        }
        if (end >= n) break;
        if (text.charCodeAt(end) === 13) {
          if (text.charCodeAt(end + 1) === 10) break; // CRLF = akhir record
          errors.push({ code: 'stray_cr', line: recLine, row: ri });
          pos = end + 1;
          continue;
        }
        break; // koma atau LF
      }
      if (junk) errors.push({ code: 'quote_junk', line: recLine, row: ri });

      rec.push(f);
      if (pos >= n) break;
      c = text.charCodeAt(pos);
      if (c === 44) { pos++; continue; }
      pos += (c === 10) ? 1 : 2;
      line++;

      break;
    }

    // Baris yang hanya berisi CR liar: bukan record (error stray_cr-nya tetap).
    if (rec.length === 1 && rec[0] === '' && !lastQuoted) continue;

    const len = rec.length;
    if (first) {
      first = false;
      width = len;
      if (header) columns = rec; else rows.push(rec);
    } else if (len === width) {
      rows.push(rec);
    } else if (len < width) {
      errors.push({ code: 'short_row', line: recLine, row: ri, fields: len });
      while (rec.length < width) rec.push('');
      rows.push(rec);
    } else {
      errors.push({ code: 'long_row', line: recLine, row: ri, extra: rec.slice(width) });
      rec.length = width;
      rows.push(rec);
    }
  }
  return { columns, rows, errors };
}

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const s = (n > 0 && text.charCodeAt(0) === 0xFEFF) ? 1 : 0;
  const hasCR = text.indexOf('\r', s) !== -1;
  const out = (!hasCR && text.indexOf('"', s) === -1) ? parseSimple(text, s, n, header) : parseGeneral(text, s, n, header, hasCR);
  if (header && out.columns === null) out.columns = [];
  return out;
}

export default run;

// ---------- Harness ----------
// ASUMSI: answers.json = array hasil run(), urutan sama dengan cases.json. Cocokkan dengan kit resmi.
function main() {
  const inPath = process.env.CASES_PATH || '/input/cases.json';
  const outPath = process.env.ANSWERS_PATH || '/output/answers.json';
  const cases = JSON.parse(readFileSync(inPath, 'utf8'));
  const out = new Array(cases.length);
  for (let i = 0; i < cases.length; i++) {
    try { out[i] = run(cases[i].input); } catch (e) { out[i] = null; }
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out));
}
try {
  if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main();
} catch (e) { console.error(e); }
