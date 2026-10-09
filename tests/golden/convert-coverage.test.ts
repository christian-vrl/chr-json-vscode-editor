// Spec 006 criterion 2 (006 T1): `pnpm test:golden -- --coverage-only` runs this file with
// coverage.test.ts.
import { describe, expect, it } from 'vitest';
import {
  convertLocations,
  convertMissingCells,
  convertPairs,
  convertRules,
  convertTagErrors,
  loadConvertCases,
  pairRules,
} from './convert.js';

describe('conversion corpus coverage (spec 006 criterion 2)', () => {
  const cases = loadConvertCases();

  it('tags every case with known rules that apply to its pair, and a known location', () => {
    const errors = cases.flatMap((c) =>
      convertTagErrors(c).map((error) => `${c.pair}/${c.name}: ${error}`),
    );
    expect(errors).toEqual([]);
  });

  it.each(convertPairs)('covers every rule and rule × location cell for %s', (pair) => {
    expect(convertMissingCells(cases, pair)).toEqual([]);
  });
});

describe('conversion coverage helpers', () => {
  it('know every pair, rule and location of the vocabulary', () => {
    expect(Object.keys(pairRules).sort()).toEqual([...convertPairs].sort());
    expect(new Set(Object.values(pairRules).flat())).toEqual(new Set(convertRules));
    expect(convertLocations).toEqual(['root', 'nested-object', 'array']);
  });

  it('accept a case tagged with rules of its pair', () => {
    const tags = { rules: ['C1', 'C6'], location: 'array' };
    expect(convertTagErrors({ pair: 'json5-to-json', tags })).toEqual([]);
  });

  it('reject missing, unknown and misplaced tags', () => {
    const tags = { rules: ['C5', 'C8', 'C5'], locaton: 'root' } as never;
    expect(convertTagErrors({ pair: 'json5-to-jsonc', tags })).toEqual([
      'unknown tag "locaton"',
      'rule C5 does not apply to json5-to-jsonc',
      'tag "rules" has unknown value "C8"',
      'rule C5 does not apply to json5-to-jsonc',
      'tag "rules" repeats a rule',
      'missing tag "location"',
    ]);
    expect(convertTagErrors({ pair: 'json-to-json5', tags: { rules: [], location: 'x' } })).toEqual(
      ['tag "rules" must be a non-empty list', 'tag "location" has unknown value "x"'],
    );
    expect(
      convertTagErrors({ pair: 'jsonc-to-json5', tags: { rules: ['C5'], location: 'root' } }),
    ).toEqual(['rule C5 does not apply to jsonc-to-json5']);
  });

  it('list the cells no case covers', () => {
    expect(convertMissingCells([], 'jsonc-to-json')).toEqual([
      'C5',
      'C5 × location=root',
      'C5 × location=nested-object',
      'C5 × location=array',
      'C6',
    ]);
    expect(convertMissingCells([], 'json-to-jsonc')).toEqual(['C7']);
    // json5-to-json: six rules, and C1, C3, C4 and C5 by three locations.
    expect(convertMissingCells([], 'json5-to-json')).toHaveLength(6 + 4 * 3);
    // json5-to-jsonc: five rules, and C1, C3 and C4 by three locations.
    expect(convertMissingCells([], 'json5-to-jsonc')).toHaveLength(5 + 3 * 3);
    const one = { pair: 'jsonc-to-json', tags: { rules: ['C5', 'C6'], location: 'array' } };
    expect(convertMissingCells([one], 'jsonc-to-json')).toEqual([
      'C5 × location=root',
      'C5 × location=nested-object',
    ]);
  });
});
