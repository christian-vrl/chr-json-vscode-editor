// Criterion 1 of spec 006 (006 T2): for every conversion case, `convert(input, from, to)` returns
// `expected` byte for byte and `losses` equal to losses.json, in input order.
import { convert } from '../../packages/core/src/index.js';
import { describe, expect, it } from 'vitest';
import { loadConvertCases } from './convert.js';

describe.each(loadConvertCases().map((c) => [`${c.pair}/${c.name}`, c] as const))('%s', (_, c) => {
  it('convert is byte-equal to expected, with the losses of losses.json', () => {
    const result = convert(c.input, c.from, c.to);
    expect(JSON.stringify(result.text)).toBe(JSON.stringify(c.expected));
    expect(result.losses).toEqual(c.losses);
  });
});
