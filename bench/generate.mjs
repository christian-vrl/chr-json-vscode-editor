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

/** Spec 015 criterion 11: the first id of 19-digit ids, so every record's id is a big number
 *  (beyond ±(2^53 − 1)) that `JSON.parse` would round. */
export const BIG_ID_BASE = 1_000_000_000_000_000_000n;

/** The document text of exactly `bytes` bytes: `[\n<records>\n]\n`, padded inside the last note.
 *  With `changed`, the 007 T5 changed copy (same length, see changedRecord); `format` writes it
 *  as JSON, JSONC or JSON5. With `bigIds` (JSON only, spec 015 criterion 11) record `i`'s id is
 *  written as the 19 digits of BIG_ID_BASE + i; the padding still makes the size exact. */
export function documentText(bytes, changed = false, format = 'json', bigIds = false) {
  const element_ = bigIds
    ? (value) =>
        element(value, format).replace(
          /"id": (\d+)/,
          (_, id) => `"id": ${BIG_ID_BASE + BigInt(id)}`,
        )
    : (value) => element(value, format);
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

/** The same records as JSON Lines (spec 012 criterion 12), one `JSON.stringify(record)` per line,
 *  each ended by `\n`, exactly `bytes` bytes, padded inside the last note. */
export function linesText(bytes) {
  const lastLine = (i, pad) =>
    JSON.stringify({ ...record(i), note: LAST_MARKER + '.'.repeat(pad) });
  const lines = [];
  let length = 0;
  for (let i = 0; ; i++) {
    const next = JSON.stringify(record(i));
    // At least one padding dot, so a benchmark can vary the text by that character.
    if (length + next.length + 1 + lastLine(i + 1, 1).length + 1 > bytes) break;
    lines.push(next);
    length += next.length + 1;
  }
  const pad = bytes - length - lastLine(lines.length, 0).length - 1;
  if (pad < 1) throw new Error(`size ${bytes} is too small`);
  lines.push(lastLine(lines.length, pad));
  const text = lines.join('\n') + '\n';
  if (text.length !== bytes) throw new Error(`wrote ${text.length} bytes, wanted ${bytes}`);
  return { text, records: lines.length };
}

/** Spec 017 criterion 10: the kinds `importText` writes. */
export const IMPORT_KINDS = ['yaml', 'toml', 'xml'];

/** Record `i` as YAML, TOML or XML (spec 017 T4's bench). Every kind holds the same fields as the
 *  JSON file; TOML has no null, so its records leave out `note` but the last one's. */
const importRecord = {
  yaml: (r) =>
    [
      `- id: ${r.id}`,
      `  name: ${r.name}`,
      `  active: ${r.active}`,
      `  score: ${r.score}`,
      '  tags:',
      ...r.tags.map((t) => `    - ${t}`),
      '  address:',
      `    street: ${r.address.street}`,
      `    zip: "${r.address.zip}"`,
      `  note: ${r.note === null ? 'null' : r.note}`,
      '',
    ].join('\n'),
  toml: (r) =>
    [
      '[[records]]',
      `id = ${r.id}`,
      `name = "${r.name}"`,
      `active = ${r.active}`,
      `score = ${Number.isInteger(r.score) ? `${r.score}.0` : r.score}`,
      `tags = [${r.tags.map((t) => `"${t}"`).join(', ')}]`,
      ...(r.note === null ? [] : [`note = "${r.note}"`]),
      `address = { street = "${r.address.street}", zip = "${r.address.zip}" }`,
      '',
      '',
    ].join('\n'),
  xml: (r) =>
    [
      '  <record>',
      `    <id>${r.id}</id>`,
      `    <name>${r.name}</name>`,
      `    <active>${r.active}</active>`,
      `    <score>${r.score}</score>`,
      ...r.tags.map((t) => `    <tags>${t}</tags>`),
      `    <address><street>${r.address.street}</street><zip>${r.address.zip}</zip></address>`,
      r.note === null ? '    <note/>' : `    <note>${r.note}</note>`,
      '  </record>',
      '',
    ].join('\n'),
};

const IMPORT_FRAME = {
  yaml: ['', ''],
  toml: ['', ''],
  xml: ['<?xml version="1.0" encoding="UTF-8"?>\n<records>\n', '</records>\n'],
};

/** The bench records as YAML (a block sequence), TOML (an array of tables `records`) or XML (a
 *  `records` element of `record` elements), exactly `bytes` bytes, padded inside the last record's
 *  note like `documentText` (spec 017 criterion 10). */
export function importText(kind, bytes) {
  const [open, close] = IMPORT_FRAME[kind];
  const write = importRecord[kind];
  const last = (i, pad) => write({ ...record(i), note: LAST_MARKER + '.'.repeat(pad) });
  const parts = [];
  let length = open.length + close.length;
  for (let i = 0; ; i++) {
    const next = write(record(i));
    if (length + next.length + last(i + 1, 1).length > bytes) break;
    parts.push(next);
    length += next.length;
  }
  const pad = bytes - length - last(parts.length, 0).length;
  if (pad < 1) throw new Error(`size ${bytes} is too small`);
  parts.push(last(parts.length, pad));
  const text = open + parts.join('') + close;
  if (text.length !== bytes) throw new Error(`wrote ${text.length} bytes, wanted ${bytes}`);
  return { text, records: parts.length };
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
