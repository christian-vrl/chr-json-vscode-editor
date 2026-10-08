// Criterion 1 of spec 002 (002 T3): `applyPatch(input, patch)` of the case's format adapter is
// byte-equal to `expected`, and a case whose patch must fail (R9) throws. Cases come from
// `selectGoldenCases`, so `pnpm test:golden -- --format json,jsonc --op add,replace,remove` (the
// 002 T3 gate) runs exactly those cases.
//
// A run without filters lists the format and op pairs no task has implemented yet as todo, so the
// whole corpus stays runnable. A filtered run never skips: naming a pair runs every case of it.
// 002 T5 (json5) and 002 T6 (move, copy, test) extend `implemented`, and remove it once it covers
// every pair.
import { getAdapter, type PatchOperation } from '../../packages/core/src/index.js';
import { describe, expect, it } from 'vitest';
import { filterFromEnv, selectGoldenCases } from './filter.js';
import { loadGoldenCases, type GoldenCase } from './load.js';

const implemented: Record<string, readonly string[]> = {
  json: ['add', 'replace', 'remove'],
  jsonc: ['add', 'replace', 'remove'],
};

const filter = filterFromEnv();
const filtered = filter.formats !== undefined || filter.ops !== undefined;
const cases = selectGoldenCases(loadGoldenCases(), filter);
const runs = (c: GoldenCase) => filtered || (implemented[c.format]?.includes(c.tags.op) ?? false);

describe.each(cases.map((c) => [`${c.format}/${c.name}`, c] as const))('%s', (_, c) => {
  const patch = c.patch as unknown as PatchOperation[];
  if (!runs(c)) {
    it.todo('applyPatch matches expected (not implemented yet)');
  } else if (c.tags.op === 'test-fail') {
    it('applyPatch fails and the caller keeps the input (R9)', () => {
      expect(() => getAdapter(c.format).applyPatch(c.input, patch)).toThrow();
    });
  } else {
    it('applyPatch is byte-equal to expected', () => {
      expect(getAdapter(c.format).applyPatch(c.input, patch)).toBe(c.expected);
    });
  }
});
