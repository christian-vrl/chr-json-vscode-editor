// Writes the benchmark documents for 003 T11 (UNK-014): one pretty-printed JSON array of records
// per size, exactly <size> MiB (2^20 bytes, the unit VS Code's own file-size limits use), ASCII
// only so bytes equal UTF-16 code units. Deterministic, so every run measures the same bytes.
//
// With `--changed` it also writes, per size, the right side of 007 T5's compare benchmark: the same
// document with about 1% of the records changed (every 100th record's name in capitals: same
// length, so the same bytes count and the same records, and `compare` reports one `changed`
// difference per changed record).
//
// With `--formats` it writes, per size, the same records as JSON, JSONC and JSON5 (008 T5's
// large-file benchmark): JSONC puts a line comment above each record, JSON5 writes keys unquoted,
// strings in single quotes and a trailing comma in each object. Every file is exactly <size> MiB.
//
//   node bench/generate.mjs [--changed | --formats] [outDir] [sizes...]
//   default: bench/.data 1 5 10 50
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// 100 MiB is left out: VS Code does not hand files above 50 MB to extensions (bench/vscode-open.md).
export const SIZES_MIB = [1, 5, 10, 50];
export const MIB = 1024 * 1024;
/** A string that only the last record holds, so a test can tell the whole document was read. */
export const LAST_MARKER = 'chr-bench-last-record';

const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];

function record(i) {
  const word = WORDS[i % WORDS.length];
  return {
    id: i,
    name: `${word}-${i}`,
    active: i % 3 !== 0,
    score: Math.round(((i * 7919) % 100000) / 7) / 100,
    tags: [word, WORDS[(i + 3) % WORDS.length]],
    address: { street: `${i % 999} ${word} street`, zip: String(10000 + (i % 89999)) },
    note: null,
  };
}

/** 007 T5: which records the changed copy changes (record i where i % CHANGED_EVERY is this). */
export const CHANGED_EVERY = 100;
const CHANGED_AT = 50;

/** Record `i` as the changed copy holds it: every CHANGED_EVERY-th record's name in capitals. */
function changedRecord(i) {
  const r = record(i);
  return i % CHANGED_EVERY === CHANGED_AT ? { ...r, name: r.name.toUpperCase() } : r;
}

/** How many records of a document of `records` records the changed copy changes. */
export function changedCount(records) {
  return Math.floor((records - 1 - CHANGED_AT) / CHANGED_EVERY) + 1;
}

const INDENT = '  ';

/** The formats `--formats` writes, with their file extensions. */
export const FORMATS = ['json', 'jsonc', 'json5'];

/** One array element as JSON.stringify(record, null, 2) would print it inside the array; JSONC
 *  and JSON5 as described at the top. The benchmark's strings hold no quotes or backslashes. */
function element(value, format = 'json') {
  let text = JSON.stringify(value, null, 2);
  if (format === 'json5') {
    text = text
      .replace(/"(\w+)": /g, '$1: ')
      .replace(/"([^"]*)"/g, "'$1'")
      .replace(/([^{[,\s])\n(\s*)}/g, '$1,\n$2}');
  }
  const lines = INDENT + text.split('\n').join('\n' + INDENT);
  return format === 'jsonc' ? `${INDENT}// record ${value.id}\n${lines}` : lines;
}

/** The document text of exactly `bytes` bytes: `[\n<records>\n]\n`, padded inside the last note.
 *  With `changed`, the 007 T5 changed copy (same length, see changedRecord); `format` writes it
 *  as JSON, JSONC or JSON5. */
export function documentText(bytes, changed = false, format = 'json') {
  const element_ = (value) => element(value, format);
  const recordAt = changed ? changedRecord : record;
  const lastRecord = (i, pad) => ({ ...recordAt(i), note: LAST_MARKER + '.'.repeat(pad) });
  const parts = [];
  let length = '[\n'.length + '\n]\n'.length;
  for (let i = 0; ; i++) {
    const next = element_(recordAt(i));
    const added = (parts.length ? ',\n'.length : 0) + next.length;
    // Leave room for the last record, written below with its padding.
    if (length + added + element_(lastRecord(i + 1, 0)).length + 2 > bytes) break;
    parts.push(next);
    length += added;
  }
  const last = lastRecord(parts.length, 0);
  const base = element_(last).length + (parts.length ? 2 : 0);
  const pad = bytes - length - base;
  if (pad < 0) throw new Error(`size ${bytes} is too small`);
  parts.push(element_(lastRecord(parts.length, pad)));
  const text = `[\n${parts.join(',\n')}\n]\n`;
  if (text.length !== bytes) throw new Error(`wrote ${text.length} bytes, wanted ${bytes}`);
  return text;
}

export function fileName(mib, changed = false, format = 'json') {
  return changed ? `${mib}mib-changed.json` : `${mib}mib.${format}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const withChanged = args[0] === '--changed';
  const withFormats = args[0] === '--formats';
  const [outDir = 'bench/.data', ...sizeArgs] = withChanged || withFormats ? args.slice(1) : args;
  const sizes = sizeArgs.length ? sizeArgs.map(Number) : SIZES_MIB;
  mkdirSync(outDir, { recursive: true });
  for (const mib of sizes) {
    for (const changed of withChanged ? [false, true] : [false]) {
      for (const format of withFormats ? FORMATS : ['json']) {
        const file = path.join(outDir, fileName(mib, changed, format));
        writeFileSync(file, documentText(mib * MIB, changed, format));
        console.log(`bench: wrote ${file} (${mib * MIB} bytes)`);
      }
    }
  }
}
