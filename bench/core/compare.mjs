// Core compare benchmark (007 T5, evidence for UNK-037): for each size (1, 5, 10, 50 MiB), the
// extension host's share of the compare panel in Node, with no editor around it, on
// bench/generate.mjs's document (left) against its changed copy (right, about 1% of the records
// changed):
//   parse   — both sides parsed as the panel parses a strict JSON side (`JSON.parse`, compareModel.ts);
//   compare — `compare(left, right)` alone (plan 007 R3: array diffs);
//   copy    — one difference copied from right into left, as the panel's "Copy to left" does:
//             `copyDifference` (which re-runs `diff` on each array it walks through, plan 007 R6,
//             timed alone as `copyPatch`) and the json adapter's `applyPatch` on the left text.
//             The panel parses a strict JSON side with `JSON.parse`, not core, so core has no parse
//             of the text cached when a copy comes: each timed copy gets a text core has not parsed.
// Each size runs in its own Node process (`--expose-gc`, heap collected before every timed call).
// Writes the raw results as JSON; bench/compare-report.mjs puts them in bench/compare.md.
// Needs `pnpm --filter @chr-json-editor/core build` (it imports core's dist).
//
//   node bench/core/compare.mjs <out.json> [sizes...]   default sizes: 1 5 10 50 (MiB)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { compare, copyDifference, getAdapter } from '@chr-json-editor/core';
import { changedCount, documentText, MIB, SIZES_MIB } from '../generate.mjs';

export const RUNS = 3;

const gc = globalThis.gc ?? (() => {});

function time(fn) {
  gc();
  const start = performance.now();
  const result = fn();
  return { ms: performance.now() - start, result };
}

/** One size, in a process of its own (see below). */
function measure(mib) {
  const bytes = mib * MIB;
  const leftText = documentText(bytes);
  const rightText = documentText(bytes, true);
  const adapter = getAdapter('json');
  // Warm the JIT on a small pair so the first measured run is not the cold one.
  const warmLeft = JSON.parse(documentText(MIB / 4));
  const warmRight = JSON.parse(documentText(MIB / 4, true));
  for (let i = 0; i < 3; i++) compare(warmLeft, warmRight);

  const result = { mib, bytes, parse: [], compare: [], copyPatch: [], copy: [] };
  let left;
  let right;
  for (let run = 0; run < RUNS; run++) {
    result.parse.push(
      time(() => {
        left = JSON.parse(leftText);
        right = JSON.parse(rightText);
      }).ms,
    );
  }
  result.records = left.length;
  const expected = changedCount(left.length);
  let differences;
  for (let run = 0; run < RUNS; run++) {
    const timed = time(() => compare(left, right));
    differences = timed.result;
    result.compare.push(timed.ms);
  }
  if (differences.length !== expected || differences.some((d) => d.kind !== 'changed')) {
    throw new Error(`${mib} MiB: expected ${expected} changed, got ${differences.length}`);
  }
  result.differences = differences.length;
  // The middle difference, so the copy lands mid-file.
  const difference = differences[Math.floor(differences.length / 2)];
  // Core keeps the parse of the last text it saw (UNK-014), so copies alternate between two left
  // texts that differ in one padding character (the last record's note, which no copy touches).
  const at = leftText.lastIndexOf('.');
  const texts = [leftText, `${leftText.slice(0, at)}-${leftText.slice(at + 1)}`];
  let copied;
  for (let run = 0; run < RUNS; run++) {
    result.copyPatch.push(time(() => copyDifference(right, left, difference, 'right')).ms);
    const text = texts[run % 2];
    result.copy.push(
      time(() => {
        const patch = copyDifference(right, left, difference, 'right');
        copied = adapter.applyPatch(text, patch);
      }).ms,
    );
  }
  // RUNS is odd, so the last copy went into the left text itself.
  if (compare(JSON.parse(copied), right).length !== expected - 1) {
    throw new Error(`${mib} MiB: the copy did not remove exactly its difference`);
  }
  result.maxRssBytes = process.resourceUsage().maxRSS * 1024;
  return result;
}

// As bench/core/run.mjs: Node's default heap (about 2 GiB on the runner) is too small at 50 MiB.
const HEAP_MIB = 6144;
const here = fileURLToPath(import.meta.url);

if (process.argv[2] === '--child') {
  process.stdout.write(JSON.stringify(measure(Number(process.argv[3]))) + '\n');
} else if (import.meta.url === `file://${process.argv[1]}`) {
  const [out, ...sizeArgs] = process.argv.slice(2);
  if (!out) {
    console.error('usage: node bench/core/compare.mjs <out.json> [sizes...]');
    process.exit(2);
  }
  const sizes = sizeArgs.length ? sizeArgs.map(Number) : SIZES_MIB;
  const results = { node: process.version, runs: RUNS, heapMiB: HEAP_MIB, sizes: [] };
  for (const mib of sizes) {
    console.log(`bench: compare in core at ${mib} MiB`);
    const output = execFileSync(
      process.execPath,
      ['--expose-gc', `--max-old-space-size=${HEAP_MIB}`, here, '--child', String(mib)],
      { encoding: 'utf8', maxBuffer: 1 << 20 },
    );
    const entry = JSON.parse(output.trim().split('\n').at(-1));
    console.log(`bench: ${JSON.stringify(entry)}`);
    results.sizes.push(entry);
  }
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  writeFileSync(out, JSON.stringify(results, null, 2) + '\n');
}
