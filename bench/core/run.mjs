// Core parse and single-edit benchmark (002 T8, spec 002 criterion 7): for each format (json,
// jsonc, json5, jsonl) and size (1, 10, 50 MiB), times `parse` and one-operation `applyPatch` calls
// (replace, add, remove, move) on `@chr-json-editor/core` in Node, with no editor around it, and
// `parseData` next to `parse` (008 T1, spec 008 criterion 7). For jsonl it also times
// `parseData('json')` on the same records written as one JSON array (spec 012 criterion 12). It
// times `smartFormat` next to `prettyPrint` at 1 and 5 MiB (010 T2, spec 010 criterion 11).
// `json-ids` is the json document with 19-digit ids (spec 015 criterion 11), parsed as json.
// Writes the raw results as JSON; `bench/core/report.mjs` turns them into bench/RESULTS.md.
// Needs `pnpm --filter @chr-json-editor/core build` (it imports core's dist). Each format and size
// runs in its own Node process with `--expose-gc`, so every timed call starts from a collected heap.
//
//   node bench/core/run.mjs <out.json> [sizes...]   default sizes: 1 10 50 (MiB); smart format
//                                                   always runs at 1 and 5 MiB
//
// It also times core's `nodeAt` at the last record's last key and `placeOf` of that path beside
// `parse` of the same document, at 5 and 50 MiB (018 T4, spec 018 criterion 11): see PATH_SIZES_MIB.
// It also times `importData` on the bench records written as YAML, TOML and XML (017 T4, spec 017
// criterion 10, UNK-077's evidence rule): see IMPORT_SIZES_MIB.
// BENCH_CORE=<path to a core build's dist/index.js> measures that build instead, without smart
// format or import (spec 015 criterion 11: the bench job also builds the base commit's core);
// BENCH_FORMATS=json,jsonc limits the formats.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  documentText,
  IMPORT_KINDS,
  importText,
  LAST_MARKER,
  linesText,
  MIB,
} from '../generate.mjs';

const { getAdapter, importData, nodeAt, parseData, placeOf, smartFormat } = await import(
  process.env.BENCH_CORE
    ? pathToFileURL(path.resolve(process.env.BENCH_CORE)).href
    : '@chr-json-editor/core'
);

export const SIZES_MIB = [1, 10, 50];
// Spec 010 criterion 11: 1 MiB and the 5 MiB threshold above which smart format is off.
export const SMART_SIZES_MIB = [1, 5];
export const FORMATS = ['json', 'json-ids', 'jsonc', 'json5', 'jsonl'];
/** The format core parses each benchmark document as. */
const coreFormat = (format) => (format === 'json-ids' ? 'json' : format);
// The formats smart format covers (spec 010 §Scope).
export const SMART_FORMATS = ['json', 'jsonc', 'json5'];
export const RUNS = 3;
// Spec 017 criterion 10: TOML and XML at these sizes; YAML at these and 20 MiB, UNK-077's
// candidates (5, 10, 20, 50 MiB), in order until the first that misses its rule (IMPORT_RULE): a
// larger file takes longer still, and measuring a 50 MiB YAML file holds the runner for minutes.
export const IMPORT_SIZES_MIB = {
  yaml: [1, 5, 10, 20, 50],
  toml: [1, 5, 10, 50],
  xml: [1, 5, 10, 50],
};
/** UNK-077's evidence rule: the YAML limit is the largest candidate whose median `importData`
 *  time is under `ms` and whose result retains under `bytes` of heap. */
export const IMPORT_RULE = { ms: 10_000, bytes: 1.5 * 2 ** 30 };

// Spec 018 criterion 11: `nodeAt` and `placeOf` beside `parse` on the 5 and 50 MiB documents.
export const PATH_SIZES_MIB = [5, 50];
export const PATH_FORMATS = ['json', 'jsonc', 'json5', 'jsonl'];

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
  if (format === 'json' || format === 'json-ids') {
    const text = documentText(bytes, false, 'json', format === 'json-ids');
    // Every record of generate.mjs's file starts with `"id"` on its own line.
    return { text, records: text.split('\n    "id": ').length - 1 };
  }
  if (format === 'jsonl') return linesText(bytes);
  return commentedText(bytes, format === 'jsonc' ? jsoncElement : json5Element);
}

/** The single-operation patches, all on the middle record so the edit lands mid-file. */
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

/** Checks the document parses to `records` records and returns the heap that one parse result
 *  keeps alive (what a host holding it pays), after a full collection. */
function checkAndMeasureRetained(adapter, text, records, label) {
  gc();
  const before = process.memoryUsage().heapUsed;
  const parsed = adapter.parse(text);
  gc();
  const bytes = process.memoryUsage().heapUsed - before;
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length) throw new Error(`${label} does not parse: ${errors[0].message}`);
  if (!Array.isArray(parsed.data) || parsed.data.length !== records) {
    throw new Error(`${label}: expected ${records} records`);
  }
  return bytes;
}

/** The heap `parseData`'s result keeps alive after a full collection, checking its records. */
function measureDataRetained(format, text, records, label) {
  gc();
  const before = process.memoryUsage().heapUsed;
  const parsed = parseData(format, text);
  gc();
  const bytes = process.memoryUsage().heapUsed - before;
  if (parsed.error) throw new Error(`${label} parseData: ${parsed.error.message}`);
  if (!Array.isArray(parsed.data) || parsed.data.length !== records) {
    throw new Error(`${label} parseData: expected ${records} records`);
  }
  return bytes;
}

/** One format and size, in a process of its own (see below). */
function measure(benchFormat, mib) {
  const bytes = mib * MIB;
  const format = coreFormat(benchFormat);
  const { text, records } = benchDocument(benchFormat, bytes);
  const adapter = getAdapter(format);
  // Warm the JIT on a small document so the first measured run is not the cold one.
  const warm = benchDocument(benchFormat, MIB / 4);
  for (let i = 0; i < 3; i++) {
    adapter.parse(warm.text);
    parseData(format, warm.text);
    for (const patch of Object.values(operations(warm.records)))
      adapter.applyPatch(warm.text, patch);
  }
  // Before any full parse of this text, so the heap it measures holds no parse cache entry of it.
  const dataRetained = measureDataRetained(format, text, records, `${format} ${mib} MiB`);
  const retained = checkAndMeasureRetained(adapter, text, records, `${format} ${mib} MiB`);
  // Core keeps the parse of the last text it saw per format (UNK-014), so calls alternate between
  // two texts of the same size that differ in one padding character: each timed call parses.
  const at = text.lastIndexOf('.');
  const texts = [text, `${text.slice(0, at)}-${text.slice(at + 1)}`];
  let last = 0;
  const unparsed = () => texts[(last = 1 - last)];
  const result = {
    format: benchFormat,
    mib,
    bytes,
    records,
    retainedHeapBytes: retained,
    parseDataRetainedHeapBytes: dataRetained,
    parse: [],
    parseData: [],
  };
  for (let run = 0; run < RUNS; run++) {
    const input = unparsed();
    result.parse.push(time(() => adapter.parse(input)).ms);
  }
  // parseData keeps nothing, so it parses whichever text it is given.
  for (let run = 0; run < RUNS; run++)
    result.parseData.push(time(() => parseData(format, text)).ms);
  if (format === 'jsonl') {
    // Spec 012 criterion 12: the same records as one JSON array, parsed in the same process.
    const array = `[\n${text.trimEnd().split('\n').join(',\n')}\n]\n`;
    if (parseData('json', array).data?.length !== records) throw new Error('jsonl: array form');
    result.parseDataArray = [];
    for (let run = 0; run < RUNS; run++)
      result.parseDataArray.push(time(() => parseData('json', array)).ms);
  }
  const edit = (name, input, patch) => {
    const { ms, result: out } = time(() => adapter.applyPatch(input, patch));
    if (typeof out !== 'string' || out === input) throw new Error(`${format} ${name}: no edit`);
    return ms;
  };
  for (const [name, patch] of Object.entries(operations(records))) {
    result[name] = [];
    result[`${name}Parsed`] = [];
    for (let run = 0; run < RUNS; run++) result[name].push(edit(name, unparsed(), patch));
    // The host's case: the text was parsed already (format badge, validation, the last edit).
    for (let run = 0; run < RUNS; run++) {
      const input = unparsed();
      adapter.parse(input);
      result[`${name}Parsed`].push(edit(name, input, patch));
    }
  }
  // Peak resident memory of this process (KiB on Linux): the source text, the parse and the edits.
  result.maxRssBytes = process.resourceUsage().maxRSS * 1024;
  return result;
}

/** Smart format and Format (`prettyPrint`) of one format and size, in a process of its own. Like
 *  `measure`, calls alternate between two texts so each one parses the text it formats. */
function measureSmart(format, mib) {
  const bytes = mib * MIB;
  const { text, records } = benchDocument(format, bytes);
  const adapter = getAdapter(format);
  const warm = benchDocument(format, MIB / 4);
  for (let i = 0; i < 3; i++) {
    smartFormat(warm.text, format);
    adapter.prettyPrint(warm.text);
  }
  const at = text.lastIndexOf('.');
  const texts = [text, `${text.slice(0, at)}-${text.slice(at + 1)}`];
  let last = 0;
  const unparsed = () => texts[(last = 1 - last)];
  const result = { format, mib, bytes, records, smartFormat: [], prettyPrint: [] };
  let formatted = '';
  for (let run = 0; run < RUNS; run++) {
    const input = unparsed();
    const timed = time(() => smartFormat(input, format));
    formatted = timed.result;
    result.smartFormat.push(timed.ms);
  }
  for (let run = 0; run < RUNS; run++) {
    const input = unparsed();
    result.prettyPrint.push(time(() => adapter.prettyPrint(input)).ms);
  }
  // The output is the same document: it parses to the same number of records.
  const parsed = adapter.parse(formatted);
  if (parsed.diagnostics.some((d) => d.severity === 'error') || parsed.data.length !== records)
    throw new Error(`${format} ${mib} MiB: smart format changed the document`);
  result.smartBytes = Buffer.byteLength(formatted);
  return result;
}

/** The offset of the last record's last key (`note`, first character, quote included) and its
 *  path: where criterion 11 runs `nodeAt`, and the path it runs `placeOf` on. */
export function lastKey(format, text, records) {
  const key = format === 'json5' ? 'note:' : '"note"';
  return { offset: text.lastIndexOf(key), path: [records - 1, 'note'] };
}

/** `nodeAt` and `placeOf` beside `parse` of one format and size, in a process of its own (spec
 *  018 criterion 11). Like `measure`, `parse` alternates between two texts so each call parses;
 *  neither path function reads core's parse cache, so they run on the one text. */
function measurePaths(format, mib) {
  const bytes = mib * MIB;
  const { text, records } = benchDocument(format, bytes);
  const adapter = getAdapter(format);
  const target = lastKey(format, text, records);
  const warm = benchDocument(format, MIB / 4);
  const warmTarget = lastKey(format, warm.text, warm.records);
  for (let i = 0; i < 3; i++) {
    adapter.parse(warm.text);
    nodeAt(format, warm.text, warmTarget.offset);
    placeOf(format, warm.text, warmTarget.path);
  }
  // The functions find the key: the node at its offset is its path, and its path's place is it.
  const found = nodeAt(format, text, target.offset);
  if (JSON.stringify(found.path) !== JSON.stringify(target.path))
    throw new Error(`${format} ${mib} MiB nodeAt: ${JSON.stringify(found)}`);
  if (placeOf(format, text, target.path) !== target.offset)
    throw new Error(`${format} ${mib} MiB placeOf: not at the key`);
  const at = text.lastIndexOf('.');
  const texts = [text, `${text.slice(0, at)}-${text.slice(at + 1)}`];
  let last = 0;
  const unparsed = () => texts[(last = 1 - last)];
  const result = {
    format,
    mib,
    bytes,
    records,
    offset: target.offset,
    parse: [],
    nodeAt: [],
    placeOf: [],
  };
  for (let run = 0; run < RUNS; run++) {
    const input = unparsed();
    result.parse.push(time(() => adapter.parse(input)).ms);
  }
  for (let run = 0; run < RUNS; run++)
    result.nodeAt.push(time(() => nodeAt(format, text, target.offset)).ms);
  for (let run = 0; run < RUNS; run++)
    result.placeOf.push(time(() => placeOf(format, text, target.path)).ms);
  return result;
}

/** The records `importData` gives for the bench text of `kind` (generate.mjs `importText`). */
function importedRecords(kind, data) {
  if (kind === 'yaml') return data;
  return kind === 'toml' ? data?.records : data?.records?.record;
}

/** Checks `importData` reads every record of the bench text with no warning, and returns the heap
 *  its result keeps alive after a full collection. */
function checkAndMeasureImport(kind, text, records, label) {
  gc();
  const before = process.memoryUsage().heapUsed;
  const imported = importData(text, kind);
  gc();
  const bytes = process.memoryUsage().heapUsed - before;
  if ('error' in imported) throw new Error(`${label}: ${imported.error.message}`);
  const got = importedRecords(kind, imported.data);
  if (!Array.isArray(got) || got.length !== records)
    throw new Error(`${label}: expected ${records} records`);
  if (imported.warnings.length) throw new Error(`${label}: warnings`);
  if (!JSON.stringify(got.at(-1)).includes(LAST_MARKER))
    throw new Error(`${label}: the last record was not read`);
  return bytes;
}

/** `importData` of the bench records as `kind` at `mib`, in a process of its own: the heap its
 *  result retains, then 3 timed runs. */
function measureImport(kind, mib) {
  const bytes = mib * MIB;
  const { text, records } = importText(kind, bytes);
  const warm = importText(kind, MIB / 4).text;
  for (let i = 0; i < 3; i++) importData(warm, kind);
  const retainedHeapBytes = checkAndMeasureImport(kind, text, records, `${kind} ${mib} MiB`);
  const result = { kind, mib, bytes, records, retainedHeapBytes, importData: [] };
  for (let run = 0; run < RUNS; run++)
    result.importData.push(time(() => importData(text, kind)).ms);
  result.maxRssBytes = process.resourceUsage().maxRSS * 1024;
  return result;
}

/** Whether a measured import meets UNK-077's rule. */
export function meetsImportRule(result) {
  const sorted = [...result.importData].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return median < IMPORT_RULE.ms && result.retainedHeapBytes < IMPORT_RULE.bytes;
}

// Heap ceiling for the measuring processes. Node's default (about 2 GiB on the 8 GiB runner) is too
// small for one 50 MiB parse; the default is recorded so the report can say which sizes exceed it.
const HEAP_MIB = 6144;
const here = fileURLToPath(import.meta.url);

if (process.argv[2] === '--child') {
  const [format, mib] = process.argv.slice(3);
  process.stdout.write(JSON.stringify(measure(format, Number(mib))) + '\n');
} else if (process.argv[2] === '--import-child') {
  const [kind, mib] = process.argv.slice(3);
  process.stdout.write(JSON.stringify(measureImport(kind, Number(mib))) + '\n');
} else if (process.argv[2] === '--paths-child') {
  const [format, mib] = process.argv.slice(3);
  process.stdout.write(JSON.stringify(measurePaths(format, Number(mib))) + '\n');
} else if (process.argv[2] === '--smart-child') {
  const [format, mib] = process.argv.slice(3);
  process.stdout.write(JSON.stringify(measureSmart(format, Number(mib))) + '\n');
} else if (import.meta.url === `file://${process.argv[1]}`) {
  const [out, ...sizeArgs] = process.argv.slice(2);
  if (!out) {
    console.error('usage: node bench/core/run.mjs <out.json> [sizes...]');
    process.exit(2);
  }
  const sizes = sizeArgs.length ? sizeArgs.map(Number) : SIZES_MIB;
  mkdirSync(path.dirname(out), { recursive: true });
  const defaultHeapLimitBytes = Number(
    execFileSync(
      process.execPath,
      ['-p', 'require("node:v8").getHeapStatistics().heap_size_limit'],
      {
        encoding: 'utf8',
      },
    ).trim(),
  );
  // One process per format and size, so the heap, the JIT and maxRSS of one cell never carry over.
  const only = process.env.BENCH_FORMATS?.split(',');
  const formats = FORMATS.filter((format) => !only || only.includes(format)).map((format) => ({
    format,
    sizes: sizes.map((mib) => {
      const stdout = execFileSync(
        process.execPath,
        ['--expose-gc', `--max-old-space-size=${HEAP_MIB}`, here, '--child', format, String(mib)],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 20 },
      );
      const result = JSON.parse(stdout.trim().split('\n').pop());
      const round = (runs) => runs.map(Math.round).join('/');
      console.log(
        `bench core: ${format} ${mib} MiB parse ${round(result.parse)} ms, parseData ${round(result.parseData)} ms, replace ${round(result.replace)} ms, ` +
          `move ${round(result.move)} ms, retained heap ${Math.round(result.retainedHeapBytes / MIB)} MiB ` +
          `(parseData ${Math.round(result.parseDataRetainedHeapBytes / MIB)} MiB), ` +
          `max RSS ${Math.round(result.maxRssBytes / MIB)} MiB`,
      );
      return result;
    }),
  }));
  // The base commit's core (BENCH_CORE) is measured for parse only.
  const smart = (process.env.BENCH_CORE ? [] : SMART_FORMATS).map((format) => ({
    format,
    sizes: SMART_SIZES_MIB.map((mib) => {
      const stdout = execFileSync(
        process.execPath,
        [
          '--expose-gc',
          `--max-old-space-size=${HEAP_MIB}`,
          here,
          '--smart-child',
          format,
          String(mib),
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 20 },
      );
      const result = JSON.parse(stdout.trim().split('\n').pop());
      const round = (runs) => runs.map(Math.round).join('/');
      console.log(
        `bench core: ${format} ${mib} MiB smartFormat ${round(result.smartFormat)} ms, prettyPrint ${round(result.prettyPrint)} ms`,
      );
      return result;
    }),
  }));
  const paths = (process.env.BENCH_CORE ? [] : PATH_FORMATS).map((format) => ({
    format,
    sizes: PATH_SIZES_MIB.map((mib) => {
      const stdout = execFileSync(
        process.execPath,
        [
          '--expose-gc',
          `--max-old-space-size=${HEAP_MIB}`,
          here,
          '--paths-child',
          format,
          String(mib),
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 20 },
      );
      const result = JSON.parse(stdout.trim().split('\n').pop());
      const round = (runs) => runs.map(Math.round).join('/');
      console.log(
        `bench core: ${format} ${mib} MiB parse ${round(result.parse)} ms, nodeAt ${round(result.nodeAt)} ms, placeOf ${round(result.placeOf)} ms`,
      );
      return result;
    }),
  }));
  const imports = (process.env.BENCH_CORE ? [] : IMPORT_KINDS).map((kind) => {
    const measured = [];
    for (const mib of IMPORT_SIZES_MIB[kind]) {
      const stdout = execFileSync(
        process.execPath,
        [
          '--expose-gc',
          `--max-old-space-size=${HEAP_MIB}`,
          here,
          '--import-child',
          kind,
          String(mib),
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 20 },
      );
      const result = JSON.parse(stdout.trim().split('\n').pop());
      console.log(
        `bench core: ${kind} ${mib} MiB importData ${result.importData.map(Math.round).join('/')} ms, ` +
          `retained heap ${Math.round(result.retainedHeapBytes / MIB)} MiB, ` +
          `max RSS ${Math.round(result.maxRssBytes / MIB)} MiB`,
      );
      measured.push(result);
      if (kind === 'yaml' && mib >= 5 && !meetsImportRule(result)) break;
    }
    return { kind, sizes: measured };
  });
  writeFileSync(
    out,
    JSON.stringify(
      {
        commit: process.env.BENCH_COMMIT || process.env.GITHUB_SHA || 'local',
        node: process.version,
        runs: RUNS,
        heapMiB: HEAP_MIB,
        defaultHeapLimitBytes,
        formats,
        smart,
        paths,
        imports,
        importRule: IMPORT_RULE,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`bench core: wrote ${out}`);
}
