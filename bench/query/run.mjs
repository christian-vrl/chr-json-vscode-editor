// Query benchmark (011 T5, spec 011 criterion 12): one run of each bench query (bench/query/*.js:
// filter-map in JavaScript, filter-orderBy-map in Lodash) at 1 and 5 MiB, in the engine
// (`runQuery`: a fresh QuickJS runtime, Lodash loaded for Lodash, the data copied in, the query,
// the result copied out) beside the reference (the library's own `executeQuery` of the same
// language on the same data, in Node, where `new Function` is allowed). Each result is checked
// against the reference's. Writes the raw results as JSON; `bench/core/report.mjs` adds them to
// bench/RESULTS.md.
//
// app-shell's TypeScript sources (and engine.ts's `?raw` import of Lodash) are loaded through Vite's
// SSR module loader, as Vitest loads them for the unit tests; nothing needs building. Run with
// `--expose-gc` (the bench:core script does), so every timed call starts from a collected heap.
//
//   node --expose-gc bench/query/run.mjs <out.json> [sizes...]   default sizes: 1 5 (MiB)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createServer } from 'vite';
import { documentText, MIB } from '../generate.mjs';

export const SIZES_MIB = [1, 5];
/** More runs than core's 3: a 1 MiB run is short enough for one garbage collection to show
 *  (011 T1 REPORT §3, the noisy 1 MiB JavaScript row). */
export const RUNS = 7;
export const QUERIES = [
  { id: 'filter-map', language: 'javascript' },
  { id: 'filter-orderBy-map', language: 'lodash' },
];

const here = path.dirname(fileURLToPath(import.meta.url));
const [out, ...sizeArgs] = process.argv.slice(2);
if (!out) {
  console.error('usage: node --expose-gc bench/query/run.mjs <out.json> [sizes...]');
  process.exit(2);
}
const sizes = sizeArgs.length ? sizeArgs.map(Number) : SIZES_MIB;
const gc = globalThis.gc ?? (() => {});
if (!globalThis.gc) console.warn('bench/query: run with --expose-gc for a collected heap per call');

const appShell = path.resolve(here, '../../packages/app-shell');
const server = await createServer({
  configFile: false,
  root: appShell,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false },
});

try {
  const { loadQueryEngine, runQuery } = await server.ssrLoadModule('/src/query/run-query.ts');
  const library = await server.ssrLoadModule('vanilla-jsoneditor');
  const reference = {
    javascript: library.javascriptQueryLanguage,
    lodash: library.lodashQueryLanguage,
  };
  const t0 = performance.now();
  await loadQueryEngine(() => server.ssrLoadModule('/src/query/engine.ts'));
  const compileMs = performance.now() - t0;

  const queries = QUERIES.map((q) => ({
    ...q,
    file: `bench/query/${q.id}.js`,
    text: readFileSync(path.join(here, `${q.id}.js`), 'utf8'),
  }));

  const time = (fn) => {
    gc();
    const start = performance.now();
    const result = fn();
    return { ms: performance.now() - start, result };
  };

  // Warm-up on a small document, so neither side pays for its first compile in a timed run.
  const small = JSON.parse(documentText(256 * 1024));
  for (const q of queries) {
    runQuery(q.language, small, q.text);
    reference[q.language].executeQuery(small, q.text, JSON);
  }

  const results = [];
  for (const mib of sizes) {
    const text = documentText(mib * MIB);
    const data = JSON.parse(text);
    for (const q of queries) {
      const engine = [];
      const ref = [];
      let same = true;
      let items = 0;
      for (let run = 0; run < RUNS; run++) {
        const e = time(() => runQuery(q.language, data, q.text));
        const r = time(() => reference[q.language].executeQuery(data, q.text, JSON));
        engine.push(e.ms);
        ref.push(r.ms);
        same &&= isDeepStrictEqual(e.result, r.result);
        items = r.result.length;
      }
      results.push({
        mib,
        bytes: Buffer.byteLength(text),
        records: data.length,
        query: q.id,
        file: q.file,
        language: q.language,
        items,
        engine,
        reference: ref,
        same,
      });
      console.log(
        `${mib} MiB ${q.id} (${q.language}): engine ${engine.map(Math.round).join(', ')} ms; ` +
          `reference ${ref.map(Math.round).join(', ')} ms; same result: ${same}`,
      );
    }
  }

  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  writeFileSync(
    out,
    JSON.stringify({ node: process.version, runs: RUNS, compileMs, results }, null, 2) + '\n',
  );
} finally {
  await server.close();
}
