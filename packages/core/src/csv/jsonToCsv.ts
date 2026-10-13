// JSON to CSV (spec 009, 009 T2): rules X1–X7. Two passes over the row source: the first collects
// the field names (X2), the second writes one record per row. The golden cases in
// tests/golden/csv/export/ encode the rules; tests/golden/README.md §CSV corpus lists the readings.
import { jsonText, LosslessNumber } from '../formats/numbers.js';
import { itemName, memberName } from './fieldName.js';
import { readsAsScalar } from './values.js';
import type { CsvDelimiter, CsvExportMessage } from './types.js';

/** Spec 009 §Options for export. A key left out takes its default. */
export interface JsonToCsvOptions {
  /** Default `,`. */
  delimiter?: CsvDelimiter;
  /** Write the header row. Default on. */
  header?: boolean;
  /** "Flatten nested objects". Default on. */
  flattenObjects?: boolean;
  /** "Flatten nested arrays". Default off. */
  flattenArrays?: boolean;
  /** "UTF-8 BOM (for Excel)". Default off. */
  bom?: boolean;
}

export type JsonToCsvResult = { text: string } | { error: CsvExportMessage };

const NOT_ROWS = 'CSV export needs an array or an object';
const BOM = '﻿';
const EOL = '\r\n';

/**
 * `data` as CSV text. An array gives one row per item, an object one row (X1); a row source with no
 * column at all (`[]`, rows of `{}` only) gives an empty text, the BOM aside (UNK-057).
 */
export function jsonToCsv(data: unknown, options: JsonToCsvOptions = {}): JsonToCsvResult {
  const delimiter = options.delimiter ?? ',';
  const flatten: Flatten = {
    objects: options.flattenObjects ?? true,
    arrays: options.flattenArrays ?? false,
  };
  let rows: readonly unknown[];
  if (Array.isArray(data)) rows = data;
  else if (isObject(data)) rows = [data];
  else return { error: { message: NOT_ROWS } };

  // X2: the union of field names in order of first appearance, row by row, member by member.
  const columns = new Map<string, number>();
  for (const row of rows) {
    eachCell(row, flatten, (name) => {
      if (!columns.has(name)) columns.set(name, columns.size);
    });
  }

  const out: string[] = [];
  if (options.bom) out.push(BOM);
  if (columns.size === 0) return { text: out.join('') };
  const width = columns.size;
  const quote = (text: string, isString: boolean) => quoted(text, isString, delimiter);
  if (options.header ?? true) {
    out.push([...columns.keys()].map((name) => quote(name, true)).join(delimiter), EOL);
  }
  const cells: string[] = new Array<string>(width);
  for (const row of rows) {
    cells.fill('');
    eachCell(row, flatten, (name, value) => {
      cells[columns.get(name)!] = cellText(value, quote);
    });
    out.push(cells.join(delimiter), EOL);
  }
  return { text: out.join('') };
}

interface Flatten {
  objects: boolean;
  arrays: boolean;
}

/**
 * Calls `visit` with the field name and value of each cell of `row`, in member order. An item that
 * is not an object sits under the empty field name (X2); with "Flatten nested arrays" on, an array
 * item is spread from that name over `[0]`, `[1]`, … (UNK-058). `undefined` members are skipped, as
 * `JSON.stringify` skips them.
 */
function eachCell(
  row: unknown,
  flatten: Flatten,
  visit: (name: string, value: unknown) => void,
): void {
  if (isObject(row)) {
    for (const key of Object.keys(row)) walk(memberName('', key), row[key], flatten, visit);
  } else {
    walk('', row, flatten, visit);
  }
}

/** X3, X4: spreads a non-empty nested object or array when its option is on. */
function walk(
  name: string,
  value: unknown,
  flatten: Flatten,
  visit: (name: string, value: unknown) => void,
): void {
  if (value === undefined) return;
  if (flatten.objects && isObject(value)) {
    const keys = Object.keys(value);
    if (keys.length > 0) {
      for (const key of keys) walk(memberName(name, key), value[key], flatten, visit);
      return;
    }
  } else if (flatten.arrays && Array.isArray(value) && value.length > 0) {
    for (let i = 0; i < value.length; i++) walk(itemName(name, i), value[i], flatten, visit);
    return;
  }
  visit(name, value);
}

/** X5: a cell's text, quoted per X6. */
function cellText(value: unknown, quote: (text: string, isString: boolean) => string): string {
  switch (typeof value) {
    case 'string':
      return quote(value, true);
    case 'number':
      // `JSON.stringify` writes -0 as `0`; NaN and the infinities are written as words.
      return Number.isFinite(value) ? JSON.stringify(value) : String(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'object':
      // A big number (spec 015 B9) is written as its decimal text, unquoted like a number, and
      // big numbers inside a JSON cell as their digits too.
      if (value instanceof LosslessNumber) return value.value;
      return value === null ? '' : quote(jsonText(value)!, false);
    default:
      return '';
  }
}

const NEEDS_QUOTES = /["\r\n]|^\s|\s$/;

/**
 * X6: `text` quoted, each `"` doubled, when it holds the delimiter, `"`, CR or LF, starts or ends
 * with white space (JavaScript's `\s`, CSV reading 7), or, for a string, is empty or reads back
 * (I7) as a number, `true`, `false` or `null`.
 */
function quoted(text: string, isString: boolean, delimiter: string): string {
  const needed =
    text.includes(delimiter) ||
    NEEDS_QUOTES.test(text) ||
    (isString && (text === '' || readsAsScalar(text)));
  return needed ? `"${text.replaceAll('"', '""')}"` : text;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof LosslessNumber)
  );
}
