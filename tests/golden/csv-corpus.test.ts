// Checks the hand-written CSV corpus (009 T1) against facts that do not depend on core's CSV code,
// so a typo in an expected.csv, expected.json or tag fails before `jsonToCsv` and `csvToJson` exist
// (009 T2 runs criterion 1 on the same cases):
// - export: expected.csv starts with a BOM exactly when the `bom` option is on (X7); read as RFC
//   4180 with the case's delimiter, every record ends with CR LF, the last included, no quote is
//   left open and no text follows a closing quote (X6, X7); every record has the same number of
//   fields, and there is one record per row (X1) plus the header when it is on;
// - export errors come only from a row source that is neither an array nor an object (X1);
// - import: expected.json is an array of objects (I6); each warning's and the error's line is a
//   line of input.csv;
// - the `values` tags name values the case really has: for export, a cell value in the input (a
//   nested object or array under "json"; an empty string under "empty"); for import, a value in
//   expected.json (`null` under both "null" and "empty"), with an empty cell in input.csv under
//   "empty" and the word `null` under "null";
// - `one-column-null-row`: one column, and a row whose cell is empty (export: an empty line in
//   expected.csv; import: `null` in expected.json from an empty line in input.csv).
import { describe, expect, it } from 'vitest';
import { effectiveDelimiter, loadCsvCases, type CsvExportCase, type CsvImportCase } from './csv.js';

const cases = loadCsvCases();
const exportCases = cases.filter((c): c is CsvExportCase => c.direction === 'export');
const importCases = cases.filter((c): c is CsvImportCase => c.direction === 'import');

const withoutBom = (text: string) => (text.startsWith('\uFEFF') ? text.slice(1) : text);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Strict RFC 4180 reading of exported text: fields per record, or a reason it is malformed. */
function strictRecords(text: string, delimiter: string): string[][] | string {
  const records: string[][] = [];
  let i = 0;
  while (i < text.length) {
    const record: string[] = [];
    for (;;) {
      let field = '';
      if (text[i] === '"') {
        i++;
        for (;;) {
          if (i >= text.length) return 'a quote is left open';
          if (text[i] === '"') {
            if (text[i + 1] !== '"') break;
            i++;
          }
          field += text[i++];
        }
        i++;
        if (i < text.length && text[i] !== delimiter && text[i] !== '\r') {
          return `text follows a closing quote at offset ${i}`;
        }
      } else {
        while (i < text.length && text[i] !== delimiter && text[i] !== '\r' && text[i] !== '\n') {
          field += text[i++];
        }
      }
      record.push(field);
      if (text[i] === delimiter) {
        i++;
        continue;
      }
      if (text.startsWith('\r\n', i)) {
        i += 2;
        break;
      }
      return `record ${records.length + 1} does not end with CR LF`;
    }
    records.push(record);
  }
  return records;
}

/** Leaves of a row as cells see them: values below the row that are not spread over columns. */
function cellValues(row: unknown): unknown[] {
  if (!isObject(row)) return [row];
  return Object.values(row).flatMap(function leaves(value): unknown[] {
    if (isObject(value) && Object.keys(value).length > 0)
      return Object.values(value).flatMap(leaves);
    if (Array.isArray(value) && value.length > 0) return [value, ...value.flatMap(leaves)];
    return [value];
  });
}

const hasType: Record<string, (value: unknown) => boolean> = {
  number: (v) => typeof v === 'number',
  true: (v) => v === true,
  false: (v) => v === false,
  null: (v) => v === null,
  text: (v) => typeof v === 'string' && v !== '',
  json: (v) => typeof v === 'object' && v !== null,
};

describe('CSV export cases (spec 009 X1–X7)', () => {
  it.each(exportCases.map((c) => [c.name, c] as const))('%s', (_, c) => {
    if (c.error) {
      expect(Array.isArray(c.input) || isObject(c.input)).toBe(false);
      expect(c.error).toEqual({ message: 'CSV export needs an array or an object' });
      return;
    }
    const text = c.expected!;
    expect(text.startsWith('\uFEFF')).toBe(c.options.bom === true);
    const records = strictRecords(withoutBom(text), effectiveDelimiter(c));
    if (typeof records === 'string') throw new Error(records);
    const rows = Array.isArray(c.input) ? c.input : [c.input];
    expect(records).toHaveLength(rows.length + (c.options.header === false ? 0 : 1));
    expect(new Set(records.map((record) => record.length)).size).toBe(1);

    const values = rows.flatMap(cellValues);
    for (const tag of c.tags.values ?? []) {
      const found =
        tag === 'empty'
          ? values.includes('')
          : tag === 'json'
            ? rows.some((row) => isObject(row) && Object.values(row).some((v) => hasType.json(v)))
            : values.some(hasType[tag]!);
      expect(found, `value tag ${tag}`).toBe(true);
    }
    if (c.tags.features?.includes('one-column-null-row')) {
      expect(records[0]).toHaveLength(1);
      expect(records.slice(c.options.header === false ? 0 : 1)).toContainEqual(['']);
    }
  });
});

describe('CSV import cases (spec 009 I1–I7)', () => {
  it.each(importCases.map((c) => [c.name, c] as const))('%s', (_, c) => {
    const lines = c.input.split(/\r\n|\r|\n/).length;
    for (const message of [...(c.warnings ?? []), ...(c.error ? [c.error] : [])]) {
      expect(message.line).toBeLessThanOrEqual(Math.max(lines, 1));
    }
    if (c.error) return;
    expect(Array.isArray(c.expected)).toBe(true);
    const rows = c.expected as unknown[];
    expect(rows.every(isObject)).toBe(true);

    const values = rows
      .flatMap((row) => Object.values(row as object) as unknown[])
      .flatMap(function all(value: unknown): unknown[] {
        return typeof value === 'object' && value !== null
          ? [value, ...(Object.values(value) as unknown[]).flatMap(all)]
          : [value];
      });
    const body = withoutBom(c.input);
    for (const tag of c.tags.values ?? []) {
      const type = tag === 'empty' ? 'null' : tag;
      expect(values.some(hasType[type]!), `value tag ${tag}`).toBe(true);
      if (tag === 'null') expect(body).toMatch(/(^|[,;\t|\r\n])null($|[,;\t|\r\n])/);
      if (tag === 'empty') expect(body).toMatch(/(^|[,;\t|\r\n])([,;\t|]|\r\n|\r|\n)|[,;\t|]$/m);
    }
    if (c.tags.features?.includes('one-column-null-row')) {
      expect(rows.every((row) => Object.keys(row as object).length <= 1)).toBe(true);
      expect(rows.some((row) => Object.values(row as object)[0] === null)).toBe(true);
      expect(body).toMatch(/\r\n\r\n|\n\n|\r\r/);
    }
  });
});
