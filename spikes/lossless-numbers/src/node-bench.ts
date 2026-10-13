// The parser bench in Node 22 (reference for the webview numbers): reads the texts run.mjs wrote
// and writes results/node.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { benchText, type BenchText } from './bench';

const [dir, out] = process.argv.slice(2);
if (!dir || !out) throw new Error('usage: node-bench.mjs <fixtureDir> <out.json>');
const list = JSON.parse(readFileSync(path.join(dir, 'texts.json'), 'utf8')) as (BenchText & {
  runs: number;
})[];
const results: Record<string, unknown> = {};
for (const item of list) {
  const text = readFileSync(path.join(dir, `${item.id}.json`), 'utf8');
  console.log(`node bench ${item.id}`);
  results[item.id] = await benchText({ ...item, text }, item.runs);
}
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(
  out,
  JSON.stringify({ node: process.version, texts: list.map((t) => ({ ...t })), results }, null, 2) +
    '\n',
);
