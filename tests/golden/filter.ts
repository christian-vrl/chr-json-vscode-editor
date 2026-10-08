// Case filters for `pnpm test:golden -- --format a,b --op a,b` (002 T1). scripts/test-golden.mjs
// validates the flags and passes them as GOLDEN_FORMAT and GOLDEN_OP; tests that run per case
// take their cases from `selectGoldenCases` so the filters reach them.
import type { GoldenCase } from './load.js';

export interface GoldenFilter {
  formats?: string[];
  ops?: string[];
}

export function filterFromEnv(env: Record<string, string | undefined> = process.env): GoldenFilter {
  const list = (value: string | undefined) => (value ? value.split(',') : undefined);
  return { formats: list(env.GOLDEN_FORMAT), ops: list(env.GOLDEN_OP) };
}

/** The cases the filter selects. Throws when some named format and op pair has no case, so a
 *  gate such as `--format json,jsonc --op add` fails instead of passing on fewer tests. */
export function selectGoldenCases(
  cases: GoldenCase[],
  filter: GoldenFilter = filterFromEnv(),
): GoldenCase[] {
  const selected = cases.filter(
    (c) =>
      (!filter.formats || filter.formats.includes(c.format)) &&
      (!filter.ops || filter.ops.includes(c.tags.op)),
  );
  // Every named format, every named op, and every named (format, op) pair needs a case.
  const formats = filter.formats ?? [undefined];
  const ops = filter.ops ?? [undefined];
  const empty = formats.flatMap((format) =>
    ops
      .filter(
        (op) =>
          (format !== undefined || op !== undefined) &&
          !selected.some(
            (c) =>
              (format === undefined || c.format === format) &&
              (op === undefined || c.tags.op === op),
          ),
      )
      .map((op) => `format ${format ?? 'any'} × op ${op ?? 'any'}`),
  );
  if (empty.length > 0) {
    throw new Error(`golden filter selects no case for ${empty.join('; ')}`);
  }
  return selected;
}
