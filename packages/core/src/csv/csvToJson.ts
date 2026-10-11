// CSV to JSON (spec 009, 009 T2): rules I1–I7. One pass of a small RFC 4180 state machine yields
// records (I2); the first gives the field names (I4, I5) and each other one a row (I6) of typed
// values (I7). The golden cases in tests/golden/csv/import/ encode the rules;
// tests/golden/README.md §CSV corpus lists the readings, message texts and line rules.
import { parseFieldName, type Segment } from './fieldName.js';
import { cellValue } from './values.js';
import type { CsvDelimiter, CsvImportMessage } from './types.js';

/** Spec 009 §Options for import. A key left out takes its default. */
export interface CsvToJsonOptions {
  /** Default "Detect" (I3), also spelled `'detect'`. */
  delimiter?: CsvDelimiter | 'detect';
  /** The first record holds the field names. Default on. */
  header?: boolean;
  /** "Nested objects from field names" (I5). Default on. */
  nestedObjects?: boolean;
}

export type CsvToJsonResult =
  { data: Record<string, unknown>[]; warnings: CsvImportMessage[] } | { error: CsvImportMessage };

const EMPTY = 'The CSV file is empty';
const OPEN_QUOTE = 'A quoted field is not closed';
const AFTER_QUOTE = 'Text after a closing quote is kept as part of the field';

const QUOTE = 0x22;
const CR = 0x0d;
const LF = 0x0a;
const BOM = '﻿';

/** One CSV record (I2): its fields as text, which of them were quoted, the line it starts on. */
interface CsvRecord {
  fields: string[];
  quoted: boolean[];
  line: number;
}

/** A warning with where it sorts: by line, then column, then rank (I2, I4, I5, then renames). */
interface Pending extends CsvImportMessage {
  column: number;
  rank: number;
}

/**
 * Reads `text` (no BOM) as records separated by `delimiter`, calling `visit` with each until it
 * returns false. Returns the error of a quote left open (I2), naming the line it opened on.
 */
function readRecords(
  text: string,
  delimiter: string,
  visit: (record: CsvRecord) => boolean,
  warn: (warning: Pending) => void,
): CsvImportMessage | undefined {
  const d = delimiter.charCodeAt(0);
  const n = text.length;
  let i = 0;
  let line = 1;
  while (i < n) {
    const record: CsvRecord = { fields: [], quoted: [], line };
    for (;;) {
      if (i < n && text.charCodeAt(i) === QUOTE) {
        const opened = line;
        let value = '';
        let start = i + 1;
        let j = start;
        for (;;) {
          if (j >= n) return { message: OPEN_QUOTE, line: opened };
          const c = text.charCodeAt(j);
          if (c === QUOTE) {
            if (text.charCodeAt(j + 1) === QUOTE) {
              value += text.slice(start, j + 1);
              j += 2;
              start = j;
              continue;
            }
            value += text.slice(start, j);
            j++;
            break;
          }
          if (c === CR) {
            line++;
            if (text.charCodeAt(j + 1) === LF) j++;
          } else if (c === LF) {
            line++;
          }
          j++;
        }
        // Text after the closing quote, up to the next delimiter or line end, is kept as written.
        let k = j;
        while (k < n) {
          const c = text.charCodeAt(k);
          if (c === d || c === CR || c === LF) break;
          k++;
        }
        if (k > j) {
          value += text.slice(j, k);
          warn({ message: AFTER_QUOTE, line, column: record.fields.length, rank: 0 });
        }
        record.fields.push(value);
        record.quoted.push(true);
        i = k;
      } else {
        let k = i;
        while (k < n) {
          const c = text.charCodeAt(k);
          if (c === d || c === CR || c === LF) break;
          k++;
        }
        record.fields.push(text.slice(i, k));
        record.quoted.push(false);
        i = k;
      }
      if (i < n && text.charCodeAt(i) === d) {
        i++;
        continue;
      }
      if (i < n) {
        if (text.charCodeAt(i) === CR && text.charCodeAt(i + 1) === LF) i++;
        i++;
        line++;
      }
      break;
    }
    if (!visit(record)) return undefined;
  }
  return undefined;
}

/** An empty line: a record of one empty, unquoted field (I2). */
function isEmptyLine(record: CsvRecord): boolean {
  return record.fields.length === 1 && record.fields[0] === '' && !record.quoted[0];
}

const CANDIDATES: readonly CsvDelimiter[] = [',', ';', '\t', '|'];
const DETECT_RECORDS = 10;

/**
 * I3: the first of `,` `;` tab `|` that splits each of the first 10 records (outside quotes) into
 * the same number of fields, at least 2; else `,`. Empty lines are not counted (UNK-062).
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const body = text.startsWith(BOM) ? text.slice(1) : text;
  for (const candidate of CANDIDATES) {
    let width = -1;
    let ok = true;
    let seen = 0;
    readRecords(
      body,
      candidate,
      (record) => {
        if (isEmptyLine(record)) return true;
        const count = record.fields.length;
        if (count < 2 || (width >= 0 && count !== width)) ok = false;
        width = count;
        seen++;
        return ok && seen < DETECT_RECORDS;
      },
      () => {},
    );
    if (ok && seen > 0) return candidate;
  }
  return ',';
}

/** A column: the key a cell goes under, or the path it spells (I5). */
interface Column {
  name: string;
  key: string;
  path?: Segment[];
}

/** A node of the tree of paths the columns so far use (I5 conflicts). */
interface PathNode {
  kind: 'object' | 'array' | 'leaf';
  /** The field name that made this node. */
  name: string;
  children: Map<Segment, PathNode>;
}

/**
 * `text` as JSON data: an array of one object per record, with warnings sorted by line. Errors: an
 * empty text, or a quote left open.
 */
export function csvToJson(text: string, options: CsvToJsonOptions = {}): CsvToJsonResult {
  const body = text.startsWith(BOM) ? text.slice(1) : text;
  if (body === '') return { error: { message: EMPTY, line: 1 } };
  const delimiter =
    options.delimiter === undefined || options.delimiter === 'detect'
      ? detectDelimiter(body)
      : options.delimiter;
  const header = options.header ?? true;
  const nested = options.nestedObjects ?? true;

  const pending: Pending[] = [];
  const warn = (warning: Pending) => pending.push(warning);
  const columns: Column[] = [];
  const used = new Set<string>();
  const root: PathNode = { kind: 'object', name: '', children: new Map() };

  /**
   * I4, UNK-060: `name`, or the first of `name_1`, `name_2`, … that no earlier column is named and,
   * for a flat key, that is not already a member of the row (UNK-061).
   */
  const unique = (name: string, asKey: boolean): string => {
    const taken = (n: string) => used.has(n) || (asKey && root.children.has(n));
    if (!taken(name)) return name;
    for (let k = 1; ; k++) {
      const next = `${name}_${k}`;
      if (!taken(next)) return next;
    }
  };
  const repeated = (name: string, next: string, line: number, column: number, rank: number) =>
    warn({
      message: `Field name "${name}" is repeated; this column is named "${next}"`,
      line,
      column,
      rank,
    });
  /** A column under a flat key, renamed when the key is taken (I6 extras, UNK-060, UNK-061). */
  const flatColumn = (name: string, line: number, column: number, rank: number): Column => {
    const key = unique(name, true);
    if (key !== name) repeated(name, key, line, column, rank);
    used.add(key);
    root.children.set(key, { kind: 'leaf', name, children: new Map() });
    return { name: key, key };
  };

  /** I4, I5: the columns the header record names. */
  const nameColumns = (record: CsvRecord) => {
    record.fields.forEach((field, column) => {
      const raw = field === '' ? `Field ${column}` : field;
      const name = unique(raw, false);
      if (name !== raw) repeated(raw, name, record.line, column, 1);
      used.add(name);
      const path = nested ? parseFieldName(name) : undefined;
      if (path) {
        const earlier = conflictOf(root, path);
        if (earlier === undefined) {
          insertPath(root, path, name);
          columns.push({ name, key: name, path });
          return;
        }
        warn({
          message: `Field name "${name}" conflicts with "${earlier}"; it is kept as a flat key`,
          line: record.line,
          column,
          rank: 2,
        });
      }
      used.delete(name);
      columns.push(flatColumn(name, record.line, column, 3));
    });
  };

  let named = 0;
  let records = 0;
  let width = 0;
  if (!header) {
    // UNK-059: every column up to the widest record is named, so read the widths first.
    readRecords(
      body,
      delimiter,
      (record) => {
        width = Math.max(width, record.fields.length);
        return true;
      },
      () => {},
    );
    for (let column = 0; column < width; column++) {
      columns.push(flatColumn(`Field ${column}`, 1, column, 0));
    }
    named = width;
  }

  const data: Record<string, unknown>[] = [];
  const error = readRecords(
    body,
    delimiter,
    (record) => {
      records++;
      if (header && records === 1) {
        nameColumns(record);
        named = columns.length;
        return true;
      }
      if (isEmptyLine(record) && named !== 1) return true;
      const count = record.fields.length;
      if (count > columns.length) {
        for (let column = columns.length; column < count; column++) {
          columns.push(flatColumn(`Field ${column}`, record.line, column, 0));
        }
      }
      if (count > named) {
        const extra = columns
          .slice(named, count)
          .map((c) => `"${c.name}"`)
          .join(', ');
        warn({
          message: `The record has more fields than there are field names; extra fields are kept as ${extra}`,
          line: record.line,
          column: named,
          rank: 0,
        });
      }
      data.push(rowOf(record, columns));
      return true;
    },
    warn,
  );
  if (error) return { error };
  if (records === 0) return { error: { message: EMPTY, line: 1 } };
  pending.sort((a, b) => a.line - b.line || a.column - b.column || a.rank - b.rank);
  return { data, warnings: pending.map(({ message, line }) => ({ message, line })) };
}

/** The earlier field `path` conflicts with (I5, CSV reading 5), or `undefined`. */
function conflictOf(root: PathNode, path: Segment[]): string | undefined {
  let node = root;
  for (const segment of path) {
    if (node.kind === 'leaf') return node.name;
    if (node.kind !== (typeof segment === 'number' ? 'array' : 'object')) return node.name;
    const child = node.children.get(segment);
    if (!child) return undefined;
    node = child;
  }
  return node.name;
}

function insertPath(root: PathNode, path: Segment[], name: string): void {
  let node = root;
  path.forEach((segment, i) => {
    let child = node.children.get(segment);
    if (!child) {
      const next = path[i + 1];
      const kind = next === undefined ? 'leaf' : typeof next === 'number' ? 'array' : 'object';
      child = { kind, name, children: new Map() };
      node.children.set(segment, child);
    }
    node = child;
  });
}

/** I6: one row, members in column order; fields past the record's end are left out. */
function rowOf(record: CsvRecord, columns: Column[]): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  let arrays: unknown[][] | undefined;
  const { fields, quoted } = record;
  for (let i = 0; i < fields.length; i++) {
    const column = columns[i]!;
    const value = cellValue(fields[i]!, quoted[i]!);
    const path = column.path;
    if (!path || path.length === 1) {
      put(row, path ? (path[0] as string) : column.key, value);
      continue;
    }
    let container: Record<string, unknown> | unknown[] = row;
    for (let p = 0; p < path.length - 1; p++) {
      const segment = path[p]!;
      let next = getOwn(container, segment) as Record<string, unknown> | unknown[] | undefined;
      if (next === undefined) {
        if (typeof path[p + 1] === 'number') {
          next = [];
          (arrays ??= []).push(next);
        } else {
          next = {};
        }
        put(container, segment, next);
      }
      container = next;
    }
    put(container, path[path.length - 1]!, value);
  }
  // I5: indices missing below the highest one given are null.
  if (arrays) {
    for (const array of arrays) {
      for (let i = 0; i < array.length; i++) if (!(i in array)) array[i] = null;
    }
  }
  return row;
}

function getOwn(container: Record<string, unknown> | unknown[], segment: Segment): unknown {
  return Object.hasOwn(container, segment)
    ? (container as Record<Segment, unknown>)[segment]
    : undefined;
}

/** Sets an own member, `__proto__` included (an assignment would set the prototype instead). */
function put(
  container: Record<string, unknown> | unknown[],
  segment: Segment,
  value: unknown,
): void {
  if (segment === '__proto__') {
    Object.defineProperty(container, segment, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  } else {
    (container as Record<Segment, unknown>)[segment] = value;
  }
}
