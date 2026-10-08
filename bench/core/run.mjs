// Core parse and single-edit benchmark (002 T8, spec 002 criterion 7): for each format (json,
// jsonc, json5) and size (1, 10, 50 MiB), times `parse` and one-operation `applyPatch` calls
// (replace, add, remove, move) on `@chr-json-editor/core` in Node, with no editor around it.
// Writes the raw results as JSON; `bench/core/report.mjs` turns them into bench/RESULTS.md.
// Needs `pnpm --filter @chr-json-editor/core build` (it imports core's dist). Run with
// `--expose-gc` so every timed call starts from a collected heap.
//
//   node --expose-gc bench/core/run.mjs <out.json> [sizes...]   default sizes: 1 10 50 (MiB)
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { getAdapter } from '@chr-json-editor/core';
import { documentText, LAST_MARKER, MIB } from '../generate.mjs';

export const SIZES_MIB = [1, 10, 50];
export const FORMATS = ['json', 'jsonc', 'json5'];
export const RUNS = 3;

const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];

/** The fields of record `i`, as `bench/generate.mjs` writes them for the JSON file. */
function fields(i, note) {
  const word = WORDS[i % WORDS.length];
  return {
    id: i,
    name: `${word}-${i}`,
    active: i % 3 !== 0,
    score: Math.round(((i * 7919) % 100000) / 7) / 100,
    tags: [word, WORDS[(i + 3) % WORDS.length]],
    street: `${i % 999} ${word} street`,
    zip: String(10000 + (i % 89999)),
    note,
  };
}

/** A JSONC record: a `//` comment before it, a block comment inside it and a trailing comma in
 *  its nested object, so the parser and the edit layer see every JSONC feature on every record. */
function jsoncElement(i, note) {
  const r = fields(i, note);
  return [
    `  // record ${i}`,
    '  {',
    `    "id": ${r.id},`,
    `    "name": ${JSON.stringify(r.name)}, /* display name */`,
    `    "active": ${r.active},`,
    `    "score": ${r.score},`,
    `    "tags": [${r.tags.map((t) => JSON.stringify(t)).join(', ')}],`,
    `    "address": { "street": ${JSON.stringify(r.street)}, "zip": ${JSON.stringify(r.zip)}, },`,
    `    "note": ${JSON.stringify(r.note)}`,
    '  }',
  ].join('\n');
}

const single = (s) => (s === null ? 'null' : `'${s}'`);

/** A JSON5 record: unquoted keys, single quotes, a hex number, comments and trailing commas. */
function json5Element(i, note) {
  const r = fields(i, note);
  return [
    `  // record ${i}`,
    '  {',
    `    id: ${r.id},`,
    `    name: ${single(r.name)}, /* display name */`,
    `    active: ${r.active},`,
    `    score: ${r.score},`,
    `    flags: 0x${(i % 256).toString(16).padStart(2, '0')},`,
    `    tags: [${r.tags.map(single).join(', ')},],`,
    `    address: { street: ${single(r.street)}, zip: ${single(r.zip)}, },`,
    `    note: ${single(r.note)},`,
    '  }',
  ].join('\n');
}

/** `[\n<records>\n]\n` (JSONC and JSON5 add a trailing comma after the last record) of exactly
 *  `bytes` bytes, padded inside the last record's note like `bench/generate.mjs`. */
function commentedText(bytes, element) {
  const open = '[\n';
  const close = ',\n]\n';
  const parts = [];
  let length = open.length + close.length;
  for (let i = 0; ; i++) {
    const next = element(i, null);
    const added = (parts.length ? 2 : 0) + next.length;
    if (length + added + element(i + 1, LAST_MARKER).length + 2 > bytes) break;
    parts.push(next);
    length += added;
  }
  const n = parts.length;
  const pad = bytes - length - (n ? 2 : 0) - element(n, LAST_MARKER).length;
  if (pad < 0) throw new Error(`size ${bytes} is too small`);
  parts.push(element(n, LAST_MARKER + '.'.repeat(pad)));
  const text = open + parts.join(',\n') + close;
  if (text.length !== bytes) throw new Error(`wrote ${text.length} bytes, wanted ${bytes}`);
  return { text, records: n + 1 };
}

export function benchDocument(format, bytes) {
  if (format === 'json') {
    const text = documentText(bytes);
    // Every record of generate.mjs's file starts with `"id"` on its own line.
    return { text, records: text.split('\n    "id": ').length - 1 };
  }
  return commentedText(bytes, format === 'jsonc' ? jsoncElement : json5Element);
}

/** The single-operation patches, all on the middle record so the edit lands mid-file. `move`
 *  re-parses between its remove and add (002 T6), so it is timed separately. */
export function operations(records) {
  const mid = Math.floor(records / 2);
  return {
    replace: [{ op: 'replace', path: `/${mid}/name`, value: 'edited' }],
    add: [{ op: 'add', path: `/${mid}/extra`, value: { added: true } }],
    remove: [{ op: 'remove', path: `/${mid}` }],
    move: [{ op: 'move', from: `/${mid}`, path: '/-' }],
  };
}

const gc = globalThis.gc ?? (() => {});

function time(fn) {
  gc();
  const start = performance.now();
  const result = fn();
  return { ms: performance.now() - start, result };
}

function measure(format, mib) {
  const bytes = mib * MIB;
  const { text, records } = benchDocument(format, bytes);
  const adapter = getAdapter(format);
  const parsed = adapter.parse(text);
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length) throw new Error(`${format} ${mib} MiB does not parse: ${errors[0].message}`);
  if (!Array.isArray(parsed.data) || parsed.data.length !== records) {
    throw new Error(`${format} ${mib} MiB: expected ${records} records`);
  }
  const result = { mib, bytes, records, parse: [] };
  for (let run = 0; run < RUNS; run++) result.parse.push(time(() => adapter.parse(text)).ms);
  for (const [name, patch] of Object.entries(operations(records))) {
    result[name] = [];
    for (let run = 0; run < RUNS; run++) {
      const { ms, result: out } = time(() => adapter.applyPatch(text, patch));
      if (typeof out !== 'string' || out === text) throw new Error(`${format} ${name}: no edit`);
      result[name].push(ms);
    }
  }
  console.log(
    `bench core: ${format} ${mib} MiB parse ${result.parse.map(Math.round).join('/')} ms, ` +
      `replace ${result.replace.map(Math.round).join('/')} ms, move ${result.move.map(Math.round).join('/')} ms`,
  );
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [out, ...sizeArgs] = process.argv.slice(2);
  if (!out) {
    console.error('usage: node --expose-gc bench/core/run.mjs <out.json> [sizes...]');
    process.exit(2);
  }
  if (!globalThis.gc) console.warn('bench core: run with --expose-gc for stable numbers');
  const sizes = sizeArgs.length ? sizeArgs.map(Number) : SIZES_MIB;
  // Warm the JIT on a small document per format so the first measured run is not the cold one.
  for (const format of FORMATS) {
    const { text, records } = benchDocument(format, MIB / 4);
    const adapter = getAdapter(format);
    for (let i = 0; i < 3; i++) {
      adapter.parse(text);
      for (const patch of Object.values(operations(records))) adapter.applyPatch(text, patch);
    }
  }
  const formats = FORMATS.map((format) => ({
    format,
    sizes: sizes.map((mib) => measure(format, mib)),
  }));
  writeFileSync(
    out,
    JSON.stringify(
      { node: process.version, runs: RUNS, gc: Boolean(globalThis.gc), formats },
      null,
      2,
    ) + '\n',
  );
  console.log(`bench core: wrote ${out}`);
}
