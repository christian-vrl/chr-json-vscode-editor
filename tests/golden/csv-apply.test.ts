// Criterion 1 of spec 009 (009 T2): for every export case, `jsonToCsv(input, options)` gives
// expected.csv byte for byte, or the error in error.json; for every import case,
// `csvToJson(input, options)` gives data deep-equal to expected.json, key order included, and
// warnings equal to warnings.json, or the error in error.json.
import { isDeepStrictEqual } from 'node:util';
import { csvToJson, jsonToCsv } from '../../packages/core/src/index.js';
import { describe, expect, it } from 'vitest';
import { loadCsvCases } from './csv.js';

/** The data with every object's keys listed in order, so key order counts in a comparison. */
function keyOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(keyOrder);
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).map(([key, item]) => [key, keyOrder(item)]);
  }
  return value;
}

describe.each(loadCsvCases().map((c) => [`${c.direction}/${c.name}`, c] as const))('%s', (_, c) => {
  it('matches the expected bytes, data, warnings or error', () => {
    if (c.direction === 'export') {
      const result = jsonToCsv(c.input, c.options);
      if (c.error) expect(result).toEqual({ error: c.error });
      else
        expect(JSON.stringify('text' in result ? result.text : result)).toBe(
          JSON.stringify(c.expected),
        );
      return;
    }
    const result = csvToJson(c.input, c.options);
    if (c.error) {
      expect(result).toEqual({ error: c.error });
      return;
    }
    if (!('data' in result)) throw new Error(`unexpected error ${JSON.stringify(result.error)}`);
    expect(isDeepStrictEqual(result.data, c.expected)).toBe(true);
    expect(keyOrder(result.data)).toEqual(keyOrder(c.expected));
    expect(result.warnings).toEqual(c.warnings);
  });
});
