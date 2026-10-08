// Node reference for spike 004 T1: the same Ajv routine on the same fixture outside VS Code. Every
// location's errors must equal these to count as "validates". Also times it in plain Node.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { compile, run } from './ajv-runner';
import { RUNS } from './protocol';

const work = process.argv[2];
if (!work) throw new Error('usage: node dist/node-reference.mjs <fixture dir>');
const { schema } = JSON.parse(readFileSync(path.join(work, 'fixture.json'), 'utf8')) as {
  schema: object;
};
const text = readFileSync(path.join(work, 'doc.json'), 'utf8');
const compiled = compile(schema);
const totalMs: number[] = [];
let errors: ReturnType<typeof run>['errors'] = [];
for (let i = 0; i < RUNS; i++) {
  const start = performance.now();
  errors = run(compiled, JSON.parse(text)).errors;
  totalMs.push(performance.now() - start);
}
writeFileSync(
  path.join(work, 'node-reference.json'),
  JSON.stringify({ errors, compileMs: compiled.compileMs, totalMs }),
);
console.log(
  `node reference: ${errors.length} errors, compile ${compiled.compileMs.toFixed(1)} ms, parse+validate ${totalMs.map((t) => t.toFixed(1)).join(' / ')} ms`,
);
