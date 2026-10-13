// TOML import (spec 017 TM1–TM5): `smol-toml` 1.9.0 parses; a walk with an explicit stack turns its
// output into our data (A2 big numbers, TM2's 64-bit range, TM3 and A3 floats, TM4 dates, A4
// members, A5 depth). `smol-toml` gives no position for values, so the few that need a line or a
// column (TM2's error, A3's warnings) are found by `locateValues`, a scan of the text's structure
// that runs only when one of them is there (corpus README, readings 4 and 5).
import { parse, TomlDate, TomlError } from 'smol-toml';
import {
  ImportFailure,
  integerData,
  Lines,
  MAX_DEPTH,
  nonFinite,
  pointer,
  setMember,
  tooDeep,
  Warnings,
  type ImportResult,
} from './common.js';

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

type Path = (string | number)[];

export function importToml(text: string): ImportResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = parse(text, { integersAsBigInt: 'asNeeded' });
  } catch (error) {
    if (error instanceof TomlError) {
      if (/excessively nested/.test(error.message)) throw tooDeep();
      const message = error.message.split('\n')[0]!.replace(/^Invalid TOML document: /, '');
      throw new ImportFailure(message, error.line, error.column);
    }
    throw error;
  }

  const lines = new Lines(text);
  const warnings = new Warnings(lines);
  let located: Map<string, Located> | undefined;
  const locate = (path: Path): Located => {
    located ??= locateValues(text);
    return located.get(pointer(path)) ?? { offset: 0, text: '' };
  };
  const outOfRange: Located[] = [];

  const root: Record<string, unknown> = {};
  const stack: { from: object; to: object; path: Path; depth: number }[] = [
    { from: parsed, to: root, path: [], depth: 1 },
  ];
  for (let frame = stack.pop(); frame; frame = stack.pop()) {
    const { from, to, path, depth } = frame;
    if (depth > MAX_DEPTH) throw tooDeep();
    const entries: [string | number, unknown][] = Array.isArray(from)
      ? from.map((v, i) => [i, v])
      : Object.keys(from).map((k) => [k, (from as Record<string, unknown>)[k]]);
    for (const [key, value] of entries) {
      let data: unknown = value;
      if (typeof value === 'bigint') {
        if (value < INT64_MIN || value > INT64_MAX) outOfRange.push(locate([...path, key]));
        data = integerData(value);
      } else if (typeof value === 'number' && !Number.isFinite(value)) {
        const at = locate([...path, key]);
        warnings.add(nonFinite([...path, key], at.text), at.offset);
        data = null;
      } else if (value instanceof TomlDate) {
        data = value.toISOString();
      } else if (typeof value === 'object' && value !== null) {
        data = Array.isArray(value) ? new Array<unknown>(value.length) : {};
        stack.push({ from: value, to: data as object, path: [...path, key], depth: depth + 1 });
      }
      if (Array.isArray(to)) to[key as number] = data;
      else setMember(to as Record<string, unknown>, key as string, data);
    }
  }

  if (outOfRange.length > 0) {
    // TM2: the first one in the file, named as written.
    const first = outOfRange.reduce((a, b) => (b.offset < a.offset ? b : a));
    throw new ImportFailure(
      `Integer ${first.text} is outside the 64-bit range TOML allows`,
      lines.line(first.offset),
      lines.column(first.offset),
    );
  }
  return { data: root, warnings: warnings.sorted() };
}

interface Located {
  /** Offset of the value's first character. */
  offset: number;
  /** The value as written. */
  text: string;
}

/**
 * The offset and text of every scalar value that is not a string in a TOML text, keyed by its JSON
 * Pointer in the data. It reads the structure only (tables, arrays of tables, dotted keys, arrays,
 * inline tables, strings and comments) and expects a text `smol-toml` accepted.
 */
export function locateValues(text: string): Map<string, Located> {
  const found = new Map<string, Located>();
  /** Lengths of the arrays of tables, by the pointer of the array. */
  const tableArrays = new Map<string, number>();
  let i = 0;
  let table: Path = [];

  const skipSpace = (newlines: boolean) => {
    for (;;) {
      const c = text[i];
      if (c === ' ' || c === '\t' || (newlines && (c === '\n' || c === '\r'))) i++;
      else if (c === '#') while (i < text.length && text[i] !== '\n') i++;
      else return;
    }
  };

  const readString = (): string => {
    const quote = text[i]!;
    const triple = text.startsWith(quote.repeat(3), i);
    const start = i;
    i += triple ? 3 : 1;
    for (;;) {
      if (i >= text.length) break;
      const c = text[i];
      if (quote === '"' && c === '\\') {
        i += 2;
        continue;
      }
      if (c === quote && (!triple || text.startsWith(quote.repeat(3), i))) {
        i += triple ? 3 : 1;
        // Up to two more quotes may close a multi-line string (`""""` is `"` then `"""`).
        if (triple) while (text[i] === quote) i++;
        break;
      }
      i++;
    }
    return text.slice(start, i);
  };

  const keyPart = (): string => {
    if (text[i] === '"' || text[i] === "'") {
      const raw = readString();
      return raw[0] === "'" ? raw.slice(1, -1) : basicString(raw.slice(1, -1));
    }
    const start = i;
    while (i < text.length && /[A-Za-z0-9_-]/.test(text[i]!)) i++;
    return text.slice(start, i);
  };

  const dottedKey = (): string[] => {
    const parts = [keyPart()];
    for (;;) {
      skipSpace(false);
      if (text[i] !== '.') return parts;
      i++;
      skipSpace(false);
      parts.push(keyPart());
    }
  };

  /** A header's keys as a data path: each array of tables on the way stands for its last table. */
  const resolve = (keys: string[], arrayOfTables: boolean): Path => {
    const path: Path = [];
    keys.forEach((key, n) => {
      path.push(key);
      const length = tableArrays.get(pointer(path));
      if (n === keys.length - 1 && arrayOfTables) {
        tableArrays.set(pointer(path), (length ?? 0) + 1);
        path.push(length ?? 0);
      } else if (length !== undefined) {
        path.push(length - 1);
      }
    });
    return path;
  };

  const value = (path: Path): void => {
    const c = text[i];
    if (c === '"' || c === "'") {
      readString();
    } else if (c === '[') {
      i++;
      for (let index = 0; ; index++) {
        skipSpace(true);
        if (text[i] === ']' || i >= text.length) break;
        value([...path, index]);
        skipSpace(true);
        if (text[i] === ',') i++;
      }
      i++;
    } else if (c === '{') {
      i++;
      for (;;) {
        skipSpace(false);
        if (text[i] === '}' || i >= text.length) break;
        const keys = dottedKey();
        skipSpace(false);
        i++; // '='
        skipSpace(false);
        value([...path, ...keys]);
        skipSpace(false);
        if (text[i] === ',') i++;
      }
      i++;
    } else {
      const start = i;
      while (i < text.length && !/[\s,\]}#]/.test(text[i]!)) i++;
      // A local date and a time separated by a space form one offset or local date-time.
      if (/^\d{4}-\d\d-\d\d$/.test(text.slice(start, i)) && /^ \d\d:/.test(text.slice(i, i + 4))) {
        i++;
        while (i < text.length && !/[\s,\]}#]/.test(text[i]!)) i++;
      }
      found.set(pointer(path), { offset: start, text: text.slice(start, i) });
    }
  };

  while (i < text.length) {
    skipSpace(true);
    if (i >= text.length) break;
    if (text[i] === '[') {
      const arrayOfTables = text[i + 1] === '[';
      i += arrayOfTables ? 2 : 1;
      skipSpace(false);
      table = resolve(dottedKey(), arrayOfTables);
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    const keys = dottedKey();
    skipSpace(false);
    if (text[i] !== '=') {
      // Not TOML `smol-toml` would accept; nothing more to find.
      break;
    }
    i++;
    skipSpace(false);
    value([...table, ...keys]);
  }
  return found;
}

/** The value of a TOML basic string's content (escapes per TOML 1.0.0). */
function basicString(content: string): string {
  const named: Record<string, string> = {
    b: '\b',
    t: '\t',
    n: '\n',
    f: '\f',
    r: '\r',
    '"': '"',
    '\\': '\\',
  };
  return content.replace(/\\(u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|.)/g, (_, e: string) =>
    e.length > 1 ? String.fromCodePoint(Number.parseInt(e.slice(1), 16)) : (named[e] ?? e),
  );
}
