// Cell text to JSON values (spec 009 I7, UNK-043 ★ "Exact"), shared with export's quoting (X6).
// Big numbers (spec 015 B9, UNK-067 ★ "Exact number"): an unquoted cell that is an RFC 8259 number
// and a big number becomes that big number, its text kept; a JSON cell's big numbers keep their
// digits.
import { isSafeNumber } from 'lossless-json';
import { LosslessNumber, mayHoldBigNumber } from '../formats/numbers.js';
import { parseData } from '../formats/parse-data.js';

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** An unquoted cell that I7 reads as a number: RFC 8259 syntax and written back unchanged, or a
 *  big number (`007`, `1.50` and `1e3` stay strings). Spec 017 XM6 reads XML text the same way. */
export function asNumber(text: string): number | LosslessNumber | undefined {
  if (!NUMBER.test(text)) return undefined;
  if (!isSafeNumber(text)) return new LosslessNumber(text);
  const value = Number(text);
  return JSON.stringify(value) === text ? value : undefined;
}

/** Whether I7 reads the unquoted cell `text` as a number, `true`, `false` or `null`. */
export function readsAsScalar(text: string): boolean {
  return text === 'true' || text === 'false' || text === 'null' || asNumber(text) !== undefined;
}

/**
 * The object or array whose JSON text `text` is, or `undefined`. The text must start with `{` or
 * `[` and end with `}` or `]` (CSV reading 9): `" [1]"` and `"[1] "` stay strings.
 */
function asContainer(text: string): object | undefined {
  const first = text.charCodeAt(0);
  const last = text.charCodeAt(text.length - 1);
  // `{` `[` and `}` `]`.
  if ((first !== 0x7b && first !== 0x5b) || (last !== 0x7d && last !== 0x5d)) return undefined;
  let data: object;
  try {
    data = JSON.parse(text) as object;
  } catch {
    return undefined;
  }
  // Strict JSON that may hold a big number: core's reading keeps its digits (spec 015 B1).
  if (!mayHoldBigNumber(text)) return data;
  const exact = parseData('json', text);
  return 'data' in exact ? (exact.data as object) : data;
}

/** I7: the value of a cell. */
export function cellValue(text: string, wasQuoted: boolean): unknown {
  if (wasQuoted) return asContainer(text) ?? text;
  if (text === '') return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  const first = text.charCodeAt(0);
  if (first === 0x2d || (first >= 0x30 && first <= 0x39)) {
    const number = asNumber(text);
    if (number !== undefined) return number;
  }
  return asContainer(text) ?? text;
}
