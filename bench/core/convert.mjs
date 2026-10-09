// Conversion timing (006 T2, plan 006 risk R4): times `convert` from @chr-json-editor/core on the
// 002 T8 bench documents (`benchDocument` in run.mjs) next to the source format's `parse`, which
// `convert` runs first. Needs `pnpm --filter @chr-json-editor/core build` (it imports core's dist).
// Prints one line per cell; the numbers go in the PR body, not in RESULTS.md.
//
//   node --expose-gc bench/core/convert.mjs [sizes...]   default sizes: 1 10 50 (MiB)
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { convert, getAdapter } from '@chr-json-editor/core';
import { benchDocument, RUNS, SIZES_MIB } from './run.mjs';

const MIB = 1024 * 1024;
const PAIRS = [
  ['json5', 'json'],
  ['json5', 'jsonc'],
  ['jsonc', 'json'],
];

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Times one pair and size; `' '.repeat(i)` gives each run a new text, so no parse is reused. */
function cell(from, to, mib) {
  const { text } = benchDocument(from, mib * MIB);
  const parse = [];
  const conv = [];
  let losses = 0;
  for (let i = 0; i < RUNS; i++) {
    globalThis.gc?.();
    let t0 = performance.now();
    getAdapter(from).parse(text + ' '.repeat(i));
    parse.push(performance.now() - t0);
    globalThis.gc?.();
    t0 = performance.now();
    losses = convert(text + ' '.repeat(RUNS + i), from, to).losses.length;
    conv.push(performance.now() - t0);
  }
  const ms = (xs) => `${Math.round(median(xs))} ms (${xs.map(Math.round).join(', ')})`;
  console.log(
    `${from} → ${to}, ${mib} MiB: convert ${ms(conv)}; parse ${ms(parse)}; ${losses} losses`,
  );
}

const here = fileURLToPath(import.meta.url);
if (process.argv[2] === '--convert-child') {
  const [from, to, mib] = process.argv.slice(3);
  cell(from, to, Number(mib));
} else if (import.meta.url === `file://${process.argv[1]}`) {
  const sizes = process.argv.length > 2 ? process.argv.slice(2).map(Number) : SIZES_MIB;
  for (const [from, to] of PAIRS) {
    for (const mib of sizes) {
      // One Node process per cell, as run.mjs does, so cells do not share a heap. The flag differs
      // from run.mjs's `--child`, which run.mjs reads on import.
      const args = [
        '--expose-gc',
        '--max-old-space-size=8192',
        here,
        '--convert-child',
        from,
        to,
        mib,
      ];
      execFileSync(process.execPath, args.map(String), { stdio: 'inherit' });
    }
  }
}
