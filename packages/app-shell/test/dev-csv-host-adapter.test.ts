// DevCsvHostAdapter (009 T3): what the standalone CSV page's host sends for the preview, and what
// it writes for each request, checked on the fixtures in tests/csv.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CSV_EXPORT_DEFAULTS, CSV_IMPORT_DEFAULTS } from '../src/csv-host-adapter.js';
import { DevCsvHostAdapter } from '../src/dev-csv-host-adapter.js';

const DIR = path.resolve(__dirname, '../../../tests/csv');
const read = (file: string) => readFileSync(path.join(DIR, file), 'utf8');
const json = (file: string): unknown => JSON.parse(read(file));

describe('DevCsvHostAdapter', () => {
  it('sends an export source with the first 100 rows and the full row count', async () => {
    const data = json('export/many.json') as unknown[];
    const host = new DevCsvHostAdapter({ mode: 'export', name: 'many.json', data });
    const source = await host.open();
    expect(source).toMatchObject({ mode: 'export', name: 'many.json', pointer: '', rowCount: 250 });
    expect(source.mode === 'export' && source.preview).toEqual(data.slice(0, 100));
  });

  it('counts one row for an object and none for another value (X1)', async () => {
    const one = new DevCsvHostAdapter({
      mode: 'export',
      name: 'a.json',
      data: { a: 1 },
      pointer: '/x',
    });
    expect(await one.open()).toMatchObject({ rowCount: 1, pointer: '/x' });
    const none = new DevCsvHostAdapter({ mode: 'export', name: 'a.json', data: 'text' });
    expect(await none.open()).toMatchObject({ rowCount: 0, preview: 'text' });
  });

  it('sends an import source cut after the 100th row', async () => {
    const text = read('import/many.csv');
    const host = new DevCsvHostAdapter({ mode: 'import', name: 'many.csv', text });
    const source = await host.open();
    expect(source).toMatchObject({ mode: 'import', complete: false, canReplace: false });
    if (source.mode !== 'import') throw new Error('not an import');
    expect(text.startsWith(source.preview)).toBe(true);
    expect(source.preview.endsWith('100,"row 100\nsecond line"\r\n')).toBe(true);
  });

  it('saves and copies the full export with the options given', async () => {
    const data = json('export/people.json');
    const host = new DevCsvHostAdapter({ mode: 'export', name: 'people.json', data });
    expect(await host.run({ action: 'save', options: { ...CSV_EXPORT_DEFAULTS } })).toEqual({
      done: true,
    });
    const options = { ...CSV_EXPORT_DEFAULTS, delimiter: ';' as const, flattenObjects: false };
    expect(await host.run({ action: 'copy', options })).toEqual({ done: true });
    expect(host.writes).toEqual([
      {
        action: 'save',
        options: CSV_EXPORT_DEFAULTS,
        name: 'people.csv',
        text:
          'name,address.city,address.zip,tags,address\r\n' +
          'Ada,London,NW1,"[""math"",""poetry""]",\r\n' +
          'Grace,New York,,"[""navy""]",\r\n' +
          '"Linus, Jr.",,,[],{}\r\n',
      },
      {
        action: 'copy',
        options,
        text:
          'name;address;tags\r\n' +
          'Ada;"{""city"":""London"",""zip"":""NW1""}";"[""math"",""poetry""]"\r\n' +
          'Grace;"{""city"":""New York"",""zip"":null}";"[""navy""]"\r\n' +
          'Linus, Jr.;{};[]\r\n',
      },
    ]);
  });

  it('refuses an export that X1 refuses, writing nothing', async () => {
    const host = new DevCsvHostAdapter({ mode: 'export', name: 'a.json', data: 'text' });
    expect(await host.run({ action: 'copy', options: { ...CSV_EXPORT_DEFAULTS } })).toEqual({
      error: { message: 'CSV export needs an array or an object' },
    });
    expect(host.writes).toEqual([]);
  });

  it('creates a JSON file beside the CSV and replaces document data', async () => {
    const text = read('import/people.csv');
    const host = new DevCsvHostAdapter({
      mode: 'import',
      name: 'people.csv',
      text,
      canReplace: true,
    });
    const data = [
      { name: 'Ada', address: { city: 'London', zip: 'NW1' }, tags: ['math', 'poetry'] },
      { name: 'Grace', address: { city: 'New York', zip: null }, tags: ['navy', null] },
    ];
    expect(await host.run({ action: 'createFile', options: { ...CSV_IMPORT_DEFAULTS } })).toEqual({
      done: true,
    });
    expect(await host.run({ action: 'replaceData', options: { ...CSV_IMPORT_DEFAULTS } })).toEqual({
      done: true,
    });
    expect(host.writes).toEqual([
      {
        action: 'createFile',
        options: CSV_IMPORT_DEFAULTS,
        name: 'people.json',
        text: JSON.stringify(data, null, 2) + '\n',
      },
      { action: 'replaceData', options: CSV_IMPORT_DEFAULTS, data },
    ]);
  });

  it('refuses Replace Document Data without a document, and an error past the preview', async () => {
    const alone = new DevCsvHostAdapter({
      mode: 'import',
      name: 'people.csv',
      text: read('import/people.csv'),
    });
    expect(await alone.run({ action: 'replaceData', options: { ...CSV_IMPORT_DEFAULTS } })).toEqual(
      { error: { message: 'There is no document to replace' } },
    );
    const late = new DevCsvHostAdapter({
      mode: 'import',
      name: 'late.csv',
      text: read('import/late-open-quote.csv'),
    });
    const source = await late.open();
    expect(source).toMatchObject({ complete: false });
    expect(await late.run({ action: 'createFile', options: { ...CSV_IMPORT_DEFAULTS } })).toEqual({
      error: { message: 'A quoted field is not closed', line: 152 },
    });
    expect(alone.writes).toEqual([]);
    expect(late.writes).toEqual([]);
  });
});
