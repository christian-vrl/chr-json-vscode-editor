// Criterion 1 of spec 006 (006 T2): for every conversion case, `convert(input, from, to)` returns
// `expected` byte for byte and `losses` equal to losses.json, in input order, or throws the
// `ConvertError` of error.json. The JSON Lines pairs (spec 012 criterion 5) run once core converts
// them (012 T3); until then they are listed as todo.
import { ConvertError, convert } from '../../packages/core/src/index.js';
import { describe, expect, it } from 'vitest';
import { jsonlPairs, loadConvertCases } from './convert.js';

const cases = loadConvertCases();

describe.each(
  cases.filter((c) => !jsonlPairs.includes(c.pair)).map((c) => [`${c.pair}/${c.name}`, c] as const),
)('%s', (_, c) => {
  if (c.error) {
    it('convert throws the ConvertError of error.json', () => {
      const run = () => convert(c.input, c.from, c.to);
      expect(run).toThrow(ConvertError);
      expect(run).toThrow(c.error!.message);
    });
  } else {
    it('convert is byte-equal to expected, with the losses of losses.json', () => {
      const result = convert(c.input, c.from, c.to);
      expect(JSON.stringify(result.text)).toBe(JSON.stringify(c.expected));
      expect(result.losses).toEqual(c.losses);
    });
  }
});

describe('JSON Lines pairs (012 T3)', () => {
  for (const c of cases.filter((c) => jsonlPairs.includes(c.pair))) {
    it.todo(`${c.pair}/${c.name}`);
  }
});
