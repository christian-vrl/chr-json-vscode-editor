// What a host sends the CSV panel's preview (009 T3, csv-preview.ts): the first 100 items of a row
// source, and the start of a CSV text that reads to the same first 100 rows, warnings and errors as
// the whole text, whichever delimiter and header setting the panel shows.
import { csvToJson, jsonToCsv, type CsvDelimiter } from '@chr-json-editor/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CSV_PREVIEW_ROWS, csvPreviewText, previewRows } from '../src/csv-preview.js';

const DELIMITERS: readonly CsvDelimiter[] = [',', ';', '\t', '|'];

/** A CSV text of `rows` records after a header, each `line(i)`. */
function csv(rows: number, line: (i: number) => string, eol = '\n'): string {
  let text = `id,label${eol}`;
  for (let i = 1; i <= rows; i++) text += line(i) + eol;
  return text;
}

/** The import options the panel offers, minus Detect (its pick is checked separately). */
const OPTIONS = DELIMITERS.flatMap((delimiter) =>
  [true, false].map((header) => ({ delimiter, header })),
);

/** `csvToJson` on the preview gives the whole text's first 100 rows, its warnings on those rows'
 *  lines, and its error when the error is on those lines. */
function expectSameStart(text: string): void {
  const { text: preview, complete } = csvPreviewText(text);
  expect(text.startsWith(preview)).toBe(true);
  expect(complete).toBe(preview === text);
  for (const options of [...OPTIONS, { delimiter: 'detect' as const, header: true }]) {
    const full = csvToJson(text, options);
    const part = csvToJson(preview, options);
    if ('error' in part) {
      expect(full, JSON.stringify(options)).toEqual(part);
      continue;
    }
    if ('error' in full) {
      // Only past the preview: the preview stopped at a line end outside every quote.
      expect(complete).toBe(false);
      continue;
    }
    expect(part.data.slice(0, CSV_PREVIEW_ROWS), JSON.stringify(options)).toEqual(
      full.data.slice(0, CSV_PREVIEW_ROWS),
    );
  }
}

describe('previewRows', () => {
  it('keeps the first 100 items of an array and any other value as it is', () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ i }));
    expect(previewRows(many)).toEqual(many.slice(0, 100));
    expect(previewRows(many.slice(0, 100))).toHaveLength(100);
    const one = { a: 1 };
    expect(previewRows(one)).toBe(one);
    expect(previewRows('text')).toBe('text');
  });
});

describe('csvPreviewText', () => {
  it('is the whole text when it has 100 rows or fewer', () => {
    const text = csv(100, (i) => `${i},row ${i}`);
    expect(csvPreviewText(text)).toEqual({ text, complete: true });
    expect(csvPreviewText('')).toEqual({ text: '', complete: true });
  });

  it('ends after the header and 100 rows, and after the 101st record with the header off', () => {
    const text = csv(250, (i) => `${i},row ${i}`);
    const { text: preview, complete } = csvPreviewText(text);
    expect(complete).toBe(false);
    expect(preview).toBe(csv(100, (i) => `${i},row ${i}`));
    expectSameStart(text);
  });

  it('counts CR LF once and keeps a leading BOM', () => {
    const text = '﻿' + csv(150, (i) => `${i},x`, '\r\n');
    const { text: preview } = csvPreviewText(text);
    expect(preview).toBe('﻿' + csv(100, (i) => `${i},x`, '\r\n'));
    expectSameStart(text);
  });

  it('does not count empty lines', () => {
    const text = csv(150, (i) => `${i},x\n`);
    const { text: preview } = csvPreviewText(text);
    expect(preview.split('\n').filter(Boolean)).toHaveLength(101);
    expectSameStart(text);
  });

  it('never ends inside a quoted field, with line breaks and doubled quotes in it', () => {
    const text = csv(150, (i) => `${i},"say ""hi""\n${i}\r\nagain"`, '\r\n');
    const { text: preview } = csvPreviewText(text);
    expect(csvToJson(preview)).toMatchObject({ data: { length: 100 }, warnings: [] });
    expectSameStart(text);
  });

  it('ends where every delimiter reads a record end, not only the one detected', () => {
    // Under `;` the quote opens a field and holds the line breaks; under `,` it is text inside
    // `100;"a` (I2), and `,` reads 101 records before the field closes. The preview ends after it.
    const text = csv(150, (i) => (i === 100 ? `${i};"a\nb\nc"` : `${i};x`));
    expectSameStart(text);
    const { text: preview } = csvPreviewText(text);
    expect(preview.endsWith('100;"a\nb\nc"\n')).toBe(true);
  });

  it('is the whole text when a quote stays open, so the error shows in the preview', () => {
    const text = csv(50, (i) => `${i},x`) + '51,"open\n' + csv(100, (i) => `${i},x`);
    expect(csvPreviewText(text)).toEqual({ text, complete: true });
  });

  it('leaves an error past the 100th row to the full conversion', () => {
    const text = csv(150, (i) => `${i},x`) + '151,"open\n152,x\n';
    const { complete } = csvPreviewText(text);
    expect(complete).toBe(false);
    expectSameStart(text);
  });

  it('reads the first 100 rows of any exported table the same (property)', () => {
    const cell = fc.oneof(
      fc.string({ unit: fc.constantFrom('a', ',', ';', '\t', '|', '"', '\n', '\r', ' ') }),
      fc.integer(),
      fc.boolean(),
      fc.constant(null),
    );
    fc.assert(
      fc.property(
        fc.array(fc.tuple(cell, cell), { minLength: 0, maxLength: 140 }),
        fc.constantFrom(...DELIMITERS),
        fc.boolean(),
        (pairs, delimiter, header) => {
          const rows = pairs.map(([a, b]) => ({ a, b }));
          const result = jsonToCsv(rows, { delimiter, header });
          if ('error' in result) throw new Error(result.error.message);
          expectSameStart(result.text);
        },
      ),
      { seed: 20261011, numRuns: 300 },
    );
  });
});
