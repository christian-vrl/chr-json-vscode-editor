// Criterion 1 of spec 002 (002 T3, 002 T6): `applyPatch(input, patch)` of the case's format
// adapter is byte-equal to `expected`, and a case whose patch must fail (R9) throws. Cases come from
// `selectGoldenCases`, so `pnpm test:golden -- --format json,jsonc --op add,replace,remove` (the
// 002 T3 gate) runs exactly those cases. Whole-document actions run in `actions.test.ts`.
import { getAdapter, PatchError, type PatchOperation } from '../../packages/core/src/index.js';
import { describe, expect, it } from 'vitest';
import { filterFromEnv, selectGoldenCases } from './filter.js';
import { loadGoldenCases, wholeDocumentOps } from './load.js';

const cases = selectGoldenCases(loadGoldenCases(), filterFromEnv()).filter(
  (c) => !wholeDocumentOps.includes(c.tags.op),
);

// A filter such as `--op sort` selects no patch case here.
if (cases.length === 0) it.skip('no patch case selected', () => {});

describe.each(cases.map((c) => [`${c.format}/${c.name}`, c] as const))('%s', (_, c) => {
  const patch = c.patch as unknown as PatchOperation[];
  if (c.tags.op === 'test-fail') {
    it('applyPatch fails and the caller keeps the input (R9)', () => {
      expect(() => getAdapter(c.format).applyPatch(c.input, patch)).toThrow(PatchError);
    });
  } else {
    it('applyPatch is byte-equal to expected', () => {
      expect(getAdapter(c.format).applyPatch(c.input, patch)).toBe(c.expected);
    });
  }
});
