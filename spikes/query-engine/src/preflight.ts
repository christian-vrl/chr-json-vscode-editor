// Node preflight for spike 011 T1 (not the gate): runs every probe and bench query through the same
// engine module outside VS Code, so a probe that never stops is found before it hangs a webview.
import { loadEngine, QueryError } from './engine';
import { BENCH_QUERIES, NEXT_QUERY, PROBES } from './probes';

const engine = await loadEngine();
for (const probe of PROBES) {
  const t0 = performance.now();
  let outcome: string;
  try {
    outcome = JSON.stringify(engine.runQuery(probe.language, [1, 2, 3], probe.query));
  } catch (error) {
    outcome =
      error instanceof QueryError
        ? `QueryError ${error.message} (${error.engineError})`
        : String(error);
  }
  const ms = Math.round(performance.now() - t0);
  const next = engine.runQuery('javascript', [1, 2, 3], NEXT_QUERY);
  console.log(
    `${probe.id}: ${ms} ms, ${outcome.slice(0, 400)}; next query → ${JSON.stringify(next)}`,
  );
}
const data: unknown = JSON.parse(
  process.argv[2] ? (await import('node:fs')).readFileSync(process.argv[2], 'utf8') : '[]',
);
for (const bench of BENCH_QUERIES) {
  const { timings, resultText } = engine.runQueryTimed(bench.language, data, bench.query);
  console.log(bench.id, JSON.stringify(timings), resultText.length);
}
