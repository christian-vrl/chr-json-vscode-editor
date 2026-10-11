// The reference (spec 011 Terms): the library's own executeQuery of each bench query, in Node, on
// the same fixtures. Writes <dir>/node-reference.json with times and result hashes.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { javascriptQueryLanguage, lodashQueryLanguage } from 'vanilla-jsoneditor';
import { BENCH_QUERIES } from './probes';
import { fnv1a } from './hash';

const dir = process.argv[2]!;
const runs = Number(process.argv[3] ?? 5);
const languages = { javascript: javascriptQueryLanguage, lodash: lodashQueryLanguage };
const out: Record<
  string,
  Record<string, { ms: number[]; resultHash: string; resultLength: number }>
> = {};
for (const id of ['1mib', '5mib']) {
  const data: unknown = JSON.parse(readFileSync(path.join(dir, `${id}.json`), 'utf8'));
  out[id] = {};
  for (const query of BENCH_QUERIES) {
    const ms: number[] = [];
    let text = '';
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      // The library's call shape: executeQuery(json, query, parser); the result leaves as JSON.
      const result = languages[query.language].executeQuery(data, query.query, JSON);
      text = JSON.stringify(result);
      ms.push(performance.now() - t0);
    }
    out[id][query.id] = { ms, resultHash: fnv1a(text), resultLength: text.length };
  }
}
writeFileSync(
  path.join(dir, 'node-reference.json'),
  JSON.stringify({ node: process.versions.node, runs, results: out }),
);
console.log(
  'node reference:',
  JSON.stringify(out, (key, value: unknown) =>
    key === 'ms' ? (value as number[]).map(Math.round) : value,
  ),
);
