// Query benchmark (011 T5, spec 011 criterion 12): one run of each bench query (bench/query/*.js:
// filter-map in JavaScript, filter-orderBy-map in Lodash) at 1 and 5 MiB, in the engine
// (`runQuery`: a fresh QuickJS runtime, Lodash loaded for Lodash, the data copied in, the query,
// the result copied out) beside the reference (the library's own `executeQuery` of the same
// language on the same data, in Node, where `new Function` is allowed). Each result is checked
// against the reference's.
//
// Also (014 T4, spec 014 criterion 10) the JSONPath bench queries (bench/query/jsonpath-*.jsonpath:
// a filter, a descendant search, a filter with `match` and a pick) at the same sizes in JSONPath
// (RFC 9535) (`executeJsonpathRfc9535`, json-p3 as the Transform dialog runs it) beside JSONPath
// (Goessner) (the library's `jsonpathQueryLanguage.executeQuery`, jsonpath-plus), each result
// checked against the other's. Goessner has no `match`: its query for that one is the same filter
// with a script regular expression (JSONPATH_GOESSNER). Writes the raw results as JSON;
// `bench/core/report.mjs` adds them to bench/RESULTS.md.
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
/** Spec 014 criterion 10's bench queries, in bench/query/<id>.jsonpath (RFC 9535 text). */
export const JSONPATH_QUERIES = [
  'jsonpath-filter',
  'jsonpath-descendant',
  'jsonpath-match',
  'jsonpath-pick',
];
/** Goessner's text where RFC 9535's is not Goessner JSONPath: `match` is RFC 9535's own function,
 *  a full match, so Goessner gets an anchored script regular expression for the same records. */
export const JSONPATH_GOESSNER = { 'jsonpath-match': '$[?(@.name.match(/^alpha-.*$/))]' };

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
  const { executeJsonpathRfc9535 } = await server.ssrLoadModule('/src/query/jsonpath-rfc9535.ts');
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

  const jsonpathQueries = JSONPATH_QUERIES.map((id) => {
    const rfc9535 = readFileSync(path.join(here, `${id}.jsonpath`), 'utf8').trim();
    return {
      id,
      file: `bench/query/${id}.jsonpath`,
      rfc9535,
      goessner: JSONPATH_GOESSNER[id] ?? rfc9535,
    };
  });
  const goessner = library.jsonpathQueryLanguage;

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
  for (const q of jsonpathQueries) {
    executeJsonpathRfc9535(small, q.rfc9535);
    goessner.executeQuery(small, q.goessner, JSON);
  }

  const results = [];
  const jsonpath = [];
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
    for (const q of jsonpathQueries) {
      const rfc = [];
      const old = [];
      let same = true;
      let items = 0;
      for (let run = 0; run < RUNS; run++) {
        const r = time(() => executeJsonpathRfc9535(data, q.rfc9535));
        const g = time(() => goessner.executeQuery(data, q.goessner, JSON));
        rfc.push(r.ms);
        old.push(g.ms);
        same &&= isDeepStrictEqual(r.result, g.result);
        items = r.result.length;
      }
      jsonpath.push({
        mib,
        bytes: Buffer.byteLength(text),
        records: data.length,
        query: q.id,
        file: q.file,
        rfc9535Query: q.rfc9535,
        goessnerQuery: q.goessner,
        items,
        rfc9535: rfc,
        goessner: old,
        same,
      });
      console.log(
        `${mib} MiB ${q.id}: RFC 9535 ${rfc.map(Math.round).join(', ')} ms; ` +
          `Goessner ${old.map(Math.round).join(', ')} ms; same result: ${same}`,
      );
    }
  }

  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  writeFileSync(
    out,
    JSON.stringify({ node: process.version, runs: RUNS, compileMs, results, jsonpath }, null, 2) +
      '\n',
  );
} finally {
  await server.close();
}
