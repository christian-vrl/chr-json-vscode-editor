// What the three importers share (spec 017): rule A1's text checks, A2's numbers, A4's members, A5's
// depth, and warnings with lines.
import { isSafeNumber } from 'lossless-json';
import { LosslessNumber } from '../formats/numbers.js';

export type ImportKind = 'yaml' | 'toml' | 'xml';

export interface ImportWarning {
  message: string;
  /** 1-based line of the input. */
  line: number;
}

export interface ImportError {
  message: string;
  /** 1-based line of the input. */
  line: number;
  /** 1-based column, when the parser gives one. */
  column?: number;
}

export type ImportResult = { data: unknown; warnings: ImportWarning[] } | { error: ImportError };

/** Deepest data A5 converts: the root container is level 1. */
export const MAX_DEPTH = 1000;
export const A1_MESSAGE = 'Only UTF-8 files can be converted';
export const A5_MESSAGE = 'The file is nested too deeply to convert (more than 1,000 levels)';

/** Ends a conversion with an error result (thrown inside an importer, caught by `importData`). */
export class ImportFailure extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column?: number,
  ) {
    super(message);
  }

  get result(): ImportError {
    return this.column === undefined
      ? { message: this.message, line: this.line }
      : { message: this.message, line: this.line, column: this.column };
  }
}

export const tooDeep = (): ImportFailure => new ImportFailure(A5_MESSAGE, 1);

/**
 * A1: the text without a leading BOM. A UTF-16 or UTF-32 BOM arrives as U+FFFD U+FFFD when the
 * bytes are decoded as UTF-8 (corpus README, reading 1), after two NULs for UTF-32 BE; such a text
 * is an error.
 */
export function utf8Text(text: string): string {
  const start = text.startsWith('\u0000\u0000') ? 2 : 0;
  if (text.startsWith('\ufffd\ufffd', start)) throw new ImportFailure(A1_MESSAGE, 1);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Offsets to 1-based lines and columns (columns in UTF-16 code units). */
export class Lines {
  private starts: number[] | undefined;
  constructor(private readonly text: string) {}

  private index(): number[] {
    if (this.starts) return this.starts;
    const starts = [0];
    const text = this.text;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 10) starts.push(i + 1);
      else if (c === 13 && text.charCodeAt(i + 1) !== 10) starts.push(i + 1);
    }
    return (this.starts = starts);
  }

  /** The 0-based line index of `offset`. */
  private row(offset: number): number {
    const starts = this.index();
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  line(offset: number): number {
    return this.row(offset) + 1;
  }

  column(offset: number): number {
    return offset - this.index()[this.row(offset)]! + 1;
  }
}

/** Warnings collected with the offset they belong to, given out by line, in document order within
 *  a line (corpus README, reading 5). */
export class Warnings {
  private readonly list: { message: string; offset: number; order: number }[] = [];
  constructor(private readonly lines: Lines) {}

  add(message: string, offset: number): void {
    this.list.push({ message, offset, order: this.list.length });
  }

  sorted(): ImportWarning[] {
    return this.list
      .sort((a, b) => a.offset - b.offset || a.order - b.order)
      .map(({ message, offset }) => ({ message, line: this.lines.line(offset) }));
  }
}

/** A4: `key` as an own member of `object`, `__proto__` included, keeping its first position when
 *  it is already there. */
export function setMember(object: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(object, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/** A JSON Pointer (RFC 6901) for A3's warnings (corpus README, reading 2). */
export function pointer(path: readonly (string | number)[]): string {
  let text = '';
  for (const token of path) text += '/' + String(token).replace(/~/g, '~0').replace(/\//g, '~1');
  return text;
}

/** A3's warning. */
export const nonFinite = (path: readonly (string | number)[], written: string): string =>
  `${pointer(path)}: ${written} has no JSON form; written as null`;

/** A2: an integer as data, a `number` when it is a safe integer, else its big number value. */
export function integerData(value: bigint): number | LosslessNumber {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : new LosslessNumber(value.toString());
}

const RFC8259_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * A2 for a decimal text: a `number`, or its big number value when it is a big number (spec 015
 * §Terms). `undefined` when `decimal` is not an RFC 8259 number.
 */
export function decimalData(decimal: string): number | LosslessNumber | undefined {
  if (!RFC8259_NUMBER.test(decimal)) return undefined;
  return isSafeNumber(decimal) ? Number(decimal) : new LosslessNumber(decimal);
}
