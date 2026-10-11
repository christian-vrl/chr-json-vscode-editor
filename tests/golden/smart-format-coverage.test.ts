// Spec 010 criterion 2 (010 T1): `pnpm test:golden -- --coverage-only` runs this file with the
// other coverage tests.
import { describe, expect, it } from 'vitest';
import { goldenFormats } from './load.js';
import {
  loadSmartFormatCases,
  smartFormatCells,
  smartFormatMissingCells,
  smartFormatTagErrors,
  type SmartFormatCase,
} from './smart-format.js';

describe('smart-format corpus coverage (spec 010 criterion 2)', () => {
  const cases = loadSmartFormatCases();

  it('tags every case with known values its format allows', () => {
    const errors = cases.flatMap((c) =>
      smartFormatTagErrors(c).map((error) => `${c.format}/${c.name}: ${error}`),
    );
    expect(errors).toEqual([]);
  });

  it.each(goldenFormats)('covers every criterion 2 cell for %s', (format) => {
    expect(smartFormatMissingCells(cases, format)).toEqual([]);
  });
});

describe('smart-format coverage helpers', () => {
  const tags = {
    layout: ['inline'],
    comments: ['none'],
    trailingComma: 'no',
    special: ['none'],
    style: ['indent-2'],
  };
  const make = (format: SmartFormatCase['format'], overrides: object = {}) =>
    ({ format, tags: { ...tags, ...overrides } }) as SmartFormatCase;

  it('list the cells of criterion 2 for each format', () => {
    const layoutAndStyle = [
      'layout=inline',
      'layout=compact-array',
      'layout=table',
      'layout=expanded',
      'style=indent-tab',
      'style=indent-2',
      'style=indent-4',
      'style=crlf',
      'style=no-final-newline',
      'style=bom',
      'style=one-line-input',
      'special=key-order',
    ];
    const comments = [
      'comments=before',
      'comments=after',
      'comments=inline',
      'comments=standalone',
      'comments=multi-line-block',
      'comments=between-key-and-value',
      'comments=header',
      'comments=footer',
      'trailingComma=yes',
      'trailingComma=no',
    ];
    expect(smartFormatCells('json')).toEqual([...layoutAndStyle, 'comments=with-warning']);
    expect(smartFormatCells('jsonc')).toEqual([...layoutAndStyle, ...comments]);
    expect(smartFormatCells('json5')).toEqual([
      ...layoutAndStyle,
      ...comments,
      'special=unquoted-key',
      'special=single-quote',
      'special=hex',
      'special=infinity-nan',
      'special=plus-sign',
      'special=leading-dot',
      'special=line-continuation',
    ]);
  });

  it('accept a well-tagged case', () => {
    expect(smartFormatTagErrors(make('json'))).toEqual([]);
    expect(
      smartFormatTagErrors(
        make('json5', {
          comments: ['header', 'footer'],
          trailingComma: 'yes',
          special: ['hex', 'key-order'],
          style: ['one-line-input', 'bom'],
        }),
      ),
    ).toEqual([]);
  });

  it('reject missing, unknown, repeated and misplaced tags', () => {
    expect(
      smartFormatTagErrors({
        format: 'json',
        tags: { layout: [], comments: ['none', 'before'], trailingComma: 'yes', extra: 1 },
      } as unknown as SmartFormatCase),
    ).toEqual([
      'unknown tag "extra"',
      'tag "layout" must be a non-empty list',
      'tag "comments" value "before" is not allowed in json',
      'tag "comments" holds "none" with other values',
      'tag "trailingComma" value "yes" is not allowed in json',
      'missing tag "special"',
      'missing tag "style"',
    ]);
    expect(
      smartFormatTagErrors(
        make('jsonc', {
          layout: ['grid'],
          comments: ['with-warning'],
          special: ['hex', 'hex'],
          style: ['indent-2', 'indent-tab'],
        }),
      ),
    ).toEqual([
      'tag "layout" has unknown value "grid"',
      'tag "comments" value "with-warning" is not allowed in jsonc',
      'tag "special" value "hex" is not allowed in jsonc',
      'tag "special" value "hex" is not allowed in jsonc',
      'tag "special" repeats a value',
      'tag "style" needs exactly one of indent-tab, indent-2, indent-4, one-line-input',
    ]);
  });

  it('list the cells no case of the format covers', () => {
    const missing = smartFormatMissingCells(
      [
        make('json', { layout: ['table', 'expanded'], style: ['indent-4', 'crlf'] }),
        make('jsonc', { layout: ['inline'] }),
      ],
      'json',
    );
    expect(missing).not.toContain('layout=table');
    expect(missing).not.toContain('style=crlf');
    expect(missing).toContain('layout=inline');
    expect(missing).toContain('comments=with-warning');
    const jsonc = smartFormatMissingCells([make('jsonc', { trailingComma: 'yes' })], 'jsonc');
    expect(jsonc).not.toContain('trailingComma=yes');
    expect(jsonc).toContain('trailingComma=no');
  });
});
