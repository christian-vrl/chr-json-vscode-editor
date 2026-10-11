// CSV timing (009 T2, plan 009 risk R5): times `jsonToCsv` and `csvToJson` from
// @chr-json-editor/core on the 003 T11 documents (`documentText` in bench/generate.mjs: arrays of
// records with a nested object, an array and a null per record), default options, next to the
// `JSON.parse` the export needs first, and `csvToJson` on a CSV file of each size. Peak heap is the most `heapUsed` seen right after each step.
// Needs `pnpm --filter @chr-json-editor/core build` (it imports core's dist). Prints one line per
// size; the numbers go in the PR body, not in RESULTS.md.
//
//   node --expose-gc bench/core/csv.mjs [sizes...]   default sizes: 1 10 50 (MiB)
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { csvToJson, jsonToCsv } from '@chr-json-editor/core';
import { documentText, MIB } from '../generate.mjs';
import { RUNS, SIZES_MIB } from './run.mjs';

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const mib = (bytes) => `${(bytes / MIB).toFixed(1)} MiB`;

function cell(size) {
  const text = documentText(size * MIB);
  const times = { parse: [], export: [], import: [], csvFile: [] };
  let peak = 0;
  let csvLength = 0;
  let rows = 0;
  const step = (name, run) => {
    globalThis.gc?.();
    const t0 = performance.now();
    const value = run();
    times[name].push(performance.now() - t0);
    peak = Math.max(peak, process.memoryUsage().heapUsed);
    return value;
  };
  for (let i = 0; i < RUNS; i++) {
    const data = step('parse', () => JSON.parse(text));
    const exported = step('export', () => jsonToCsv(data));
    if (!('text' in exported)) throw new Error(exported.error.message);
    csvLength = exported.text.length;
    const imported = step('import', () => csvToJson(exported.text));
    if (!('data' in imported)) throw new Error(imported.error.message);
    rows = imported.data.length;
  }
  // A CSV file of `size` MiB itself (plan 009 R5): the exported records repeated, cut at a record.
  const exported = jsonToCsv(JSON.parse(text));
  const [head, ...records] = exported.text.split('\r\n');
  const body = records.slice(0, -1).join('\r\n') + '\r\n';
  let csv = head + '\r\n' + body.repeat(Math.ceil((size * MIB) / body.length));
  csv = csv.slice(0, csv.lastIndexOf('\r\n', size * MIB) + 2);
  let csvRows = 0;
  for (let i = 0; i < RUNS; i++) {
    const imported = step('csvFile', () => csvToJson(csv + ' '.repeat(i)));
    csvRows = imported.data.length;
  }
  const ms = (xs) => `${Math.round(median(xs))} ms (${xs.map(Math.round).join(', ')})`;
  console.log(
    `${size} MiB JSON (${rows} rows, CSV ${mib(csvLength)}): export ${ms(times.export)}; ` +
      `import ${ms(times.import)}; JSON.parse ${ms(times.parse)}; ` +
      `import of a ${size} MiB CSV (${csvRows} rows) ${ms(times.csvFile)}; peak heap ${mib(peak)}`,
  );
}

const here = fileURLToPath(import.meta.url);
if (process.argv[2] === '--csv-child') {
  cell(Number(process.argv[3]));
} else if (import.meta.url === `file://${process.argv[1]}`) {
  const sizes = process.argv.length > 2 ? process.argv.slice(2).map(Number) : SIZES_MIB;
  for (const size of sizes) {
    // One Node process per size, as run.mjs does, so sizes do not share a heap.
    const args = ['--expose-gc', '--max-old-space-size=8192', here, '--csv-child', size];
    execFileSync(process.execPath, args.map(String), { stdio: 'inherit' });
  }
}
