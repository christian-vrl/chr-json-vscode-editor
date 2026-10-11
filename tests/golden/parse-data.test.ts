// Spec 008 criterion 6 (008 T1): on every golden input and expected text, of the format corpus and
// the conversion corpus, `parseData` agrees with the full `parse` in each of the three formats.
import { describe, it } from 'vitest';
import { expectAgrees } from '../../packages/core/test/parse-data-agrees.js';
import { loadConvertCases } from './convert.js';
import { filterFromEnv, selectGoldenCases } from './filter.js';
import { goldenFormats, loadGoldenCases } from './load.js';

const texts = [
  ...selectGoldenCases(loadGoldenCases(), filterFromEnv()).map(
    (c) => [`${c.format}/${c.name}`, c.input, c.expected] as const,
  ),
  ...loadConvertCases().map((c) => [`convert/${c.pair}/${c.name}`, c.input, c.expected] as const),
];

describe.each(texts)('%s', (_, input, expected) => {
  it.each(goldenFormats)('parseData agrees with parse as %s', (format) => {
    expectAgrees(format, input);
    expectAgrees(format, expected);
  });
});
