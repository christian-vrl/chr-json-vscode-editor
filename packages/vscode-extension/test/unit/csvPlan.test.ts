// csvPlan (009 T4): what the CSV panel reads, writes and says, without VS Code. The e2e suite
// (test/e2e/csv.cjs) runs the same through the panel.
import { describe, expect, it } from 'vitest';
import { parseData } from '@chr-json-editor/core';
import {
  brokenMessage,
  exportSource,
  importSource,
  newJsonText,
  panelTitle,
  renamed,
  replacedText,
  rowSourceAt,
  tooLargeMessage,
} from '../../src/csvPlan';

describe('csvPlan', () => {
  it('names the new files after the source', () => {
    expect(renamed('people.json', 'csv')).toBe('people.csv');
    expect(renamed('data.v2.json5', 'csv')).toBe('data.v2.csv');
    expect(renamed('people.csv', 'json')).toBe('people.json');
    expect(renamed('.hidden', 'json')).toBe('.hidden.json');
    expect(renamed('README', 'csv')).toBe('README.csv');
  });

  const data = { people: [{ a: 1 }, { a: 2 }], count: 2, 'x/y': { '~': [] } };

  it('exports the value at the pointer only when it is an array or an object (criterion 7)', () => {
    expect(rowSourceAt(data, '')).toEqual({ pointer: '', value: data });
    expect(rowSourceAt(data, '/people')).toEqual({ pointer: '/people', value: data.people });
    expect(rowSourceAt(data, '/people/1')).toEqual({ pointer: '/people/1', value: { a: 2 } });
    expect(rowSourceAt(data, '/x~1y/~0')).toEqual({ pointer: '/x~1y/~0', value: [] });
    for (const pointer of ['/count', '/people/0/a', '/missing', '/people/2', '/people/01']) {
      expect(rowSourceAt(data, pointer)).toEqual({ pointer: '', value: data });
    }
    // An own member only: not one from the prototype.
    expect(rowSourceAt({}, '/constructor')).toEqual({ pointer: '', value: {} });
  });

  it('sends the export preview as JSON5 that keeps NaN, Infinity and -0', () => {
    const rows = Array.from({ length: 150 }, (_, i) => ({ i, n: i ? NaN : -0, inf: -Infinity }));
    const source = exportSource('data.json5', '/rows', rows);
    expect(source).toMatchObject({
      mode: 'export',
      name: 'data.json5',
      pointer: '/rows',
      rowCount: 150,
    });
    const read = parseData('json5', source.preview);
    expect('data' in read && read.data).toEqual(rows.slice(0, 100));
    expect('data' in read && Object.is((read.data as { n: number }[])[0]!.n, -0)).toBe(true);
    expect(
      exportSource('a.json', '', { a: 1 }).mode === 'export' &&
        exportSource('a.json', '', { a: 1 }),
    ).toMatchObject({ rowCount: 1 });
    expect(exportSource('a.json', '', 'text')).toMatchObject({ rowCount: 0, preview: '"text"' });
  });

  it('sends the import preview up to the 100th row', () => {
    const text = `a,b\r\n${Array.from({ length: 150 }, (_, i) => `${i},x\r\n`).join('')}`;
    const source = importSource('big.csv', text, true);
    expect(source).toMatchObject({
      mode: 'import',
      name: 'big.csv',
      complete: false,
      canReplace: true,
    });
    expect(source.preview.split('\r\n').length - 1).toBe(101);
    expect(importSource('small.csv', 'a\n1\n', false)).toEqual({
      mode: 'import',
      name: 'small.csv',
      preview: 'a\n1\n',
      complete: true,
      canReplace: false,
    });
  });

  it('titles the panel with the row source', () => {
    expect(panelTitle(exportSource('people.json', '', []))).toBe('Export people.json to CSV');
    expect(panelTitle(exportSource('people.json', '/people', []))).toBe(
      'Export /people of people.json to CSV',
    );
    expect(panelTitle(importSource('people.csv', 'a\n', false))).toBe('Import people.csv');
  });

  it('writes a new JSON file with two spaces and a final newline', () => {
    expect(newJsonText([{ a: 1, b: { c: null } }])).toBe(
      '[\n  {\n    "a": 1,\n    "b": {\n      "c": null\n    }\n  }\n]\n',
    );
  });

  it('replaces document data through diff and applyPatch, keeping comments (criterion 4)', () => {
    const text = '[\n  // first\n  {"a": 1}, // one\n  {"a": 2}\n]\n';
    expect(replacedText(text, 'jsonc', [{ a: 1 }, { a: 3 }])).toEqual({
      text: '[\n  // first\n  {"a": 1}, // one\n  {"a": 3}\n]\n',
    });
    expect(replacedText(text, 'jsonc', [{ a: 1 }, { a: 2 }])).toEqual({ text });
    expect(replacedText('{"a": }', 'json', [])).toEqual({ error: { offset: 6 } });
  });

  it('says why nothing was exported or read', () => {
    expect(brokenMessage('jsonc', 2, 8)).toBe(
      "CHR JSON Editor: can't export to CSV: the document is not valid JSONC (error at line 2, " +
        'column 8). Fix it or run "Repair JSON" first.',
    );
    expect(tooLargeMessage('huge.csv', 50 * 1024 * 1024 + 1)).toBe(
      'CHR JSON Editor: huge.csv is 50.0 MiB, too large for CSV import (the limit is 50 MiB).',
    );
  });
});
