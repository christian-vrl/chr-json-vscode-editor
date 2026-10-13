// Criterion 1 of spec 017 (017 T2): for every case in tests/golden/import/, the output text of
// `importData(input, kind).data` (`stringify(data, 'json', IMPORT_OUTPUT_STYLE)`) is byte-equal to
// expected.json and `warnings` equals warnings.json, in order, or the error equals error.json. A
// parser's own error text is not fixed by any rule, so where error.json has no `message` only the
// line and column are compared (corpus README, reading 4).
import { importData, IMPORT_OUTPUT_STYLE, stringify } from '../../packages/core/src/index.js';
import { describe, expect, it } from 'vitest';
import { loadImportCases } from './import.js';

describe.each(loadImportCases().map((c) => [`${c.kind}/${c.name}`, c] as const))('%s', (_, c) => {
  it('gives the expected text and warnings, or the error', () => {
    const result = importData(c.input, c.kind);
    if (c.error) {
      if (!('error' in result)) throw new Error('expected an error, got data');
      const { message, ...place } = result.error;
      expect(c.error.message === undefined ? place : { message, ...place }).toEqual(c.error);
      return;
    }
    if ('error' in result) throw new Error(`unexpected error ${JSON.stringify(result.error)}`);
    expect(stringify(result.data, 'json', IMPORT_OUTPUT_STYLE)).toBe(c.expected);
    expect(result.warnings).toEqual(c.warnings);
  });
});
