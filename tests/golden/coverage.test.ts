// Spec 002 criterion 4 (002 T1): `pnpm test:golden -- --coverage-only` runs only this file.
import { describe, expect, it } from 'vitest';
import { missingCells, tagErrors, tagNames, vocabularyFormats } from './coverage.js';
import { goldenFormats, loadGoldenCases, type GoldenFormat } from './load.js';

describe('golden corpus coverage (spec 002 criterion 4)', () => {
  const cases = loadGoldenCases();

  it('tags every case with known values', () => {
    const errors = cases.flatMap((c) =>
      tagErrors(c).map((error) => `${c.format}/${c.name}: ${error}`),
    );
    expect(errors).toEqual([]);
  });

  it.each(goldenFormats)('covers every cell for %s', (format) => {
    expect(missingCells(cases, format)).toEqual([]);
  });
});

describe('coverage helpers', () => {
  const tags = {
    op: 'add',
    location: 'root',
    comments: 'none',
    trailingComma: 'no',
    quote: 'double',
    keyStyle: 'quoted',
    special: 'none',
  };

  it('share their formats with the loader', () => {
    expect(vocabularyFormats).toEqual(goldenFormats);
    expect(tagNames).toEqual([
      'op',
      'location',
      'comments',
      'trailingComma',
      'quote',
      'keyStyle',
      'special',
    ]);
  });

  it('accept a fully tagged case', () => {
    expect(tagErrors({ format: 'json', tags })).toEqual([]);
  });

  it('reject missing, unknown and misspelled tags', () => {
    const rest: Record<string, string> = { ...tags };
    delete rest.special;
    expect(tagErrors({ format: 'json5', tags: { ...rest, locaton: 'root', op: 'ad' } })).toEqual([
      'unknown tag "locaton"',
      'tag "op" has unknown value "ad"',
      'missing tag "special"',
    ]);
  });

  it('reject tags a format cannot vary', () => {
    expect(tagErrors({ format: 'jsonc', tags: { ...tags, quote: 'single' } })).toEqual([
      'tag "quote" must be "double" in jsonc (got "single")',
    ]);
    expect(tagErrors({ format: 'json', tags: { ...tags, comments: 'before' } })).toEqual([
      'tag "comments" must be "none" in json (got "before")',
    ]);
  });

  it('list the cells no case covers', () => {
    const ops = ['add', 'replace', 'remove', 'move', 'copy', 'test', 'test-fail'];
    const locations = ['root', 'nested-object', 'array-start', 'array-middle', 'array-end'];
    const format: GoldenFormat = 'json';
    const all = ops.flatMap((op) =>
      locations.map((location) => ({ format, tags: { ...tags, op, location } })),
    );
    expect(missingCells(all, 'json')).toEqual([]);
    expect(missingCells(all.slice(1), 'json')).toEqual(['op=add × location=root']);
    expect(missingCells(all, 'jsonc')).toHaveLength(35 + 28 + 2);
    expect(missingCells([], 'json5')).toEqual(
      expect.arrayContaining([
        'op=test-fail × comments=inline',
        'trailingComma=yes',
        'quote=single',
        'keyStyle=unquoted',
        'special=hex',
        'special=infinity-nan',
        'special=multiline-string',
      ]),
    );
    expect(missingCells([], 'json5')).not.toContain('special=none');
  });
});
