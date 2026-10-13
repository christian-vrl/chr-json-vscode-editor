// Big numbers (spec 015, ADR-014). A number token whose value JavaScript cannot write back with the
// same digits (lossless-json's `isSafeNumber` is `false` for its decimal text) is a lossless-json
// `LosslessNumber` in data, holding that decimal text; every other number stays a JavaScript
// `number`, exactly as before (B1). Writers write a `LosslessNumber` as its digits and a `BigInt`
// as its decimal digits (B2).
//
// Only `LosslessNumber` instances are numbers: an object of the document that happens to have
// `isLosslessNumber` and `value` members stays an object (B5), so every check here is `instanceof`,
// never lossless-json's duck-typed `isLosslessNumber`.
import { isSafeNumber, LosslessNumber } from 'lossless-json';

export { LosslessNumber };

/** RFC 8259's number grammar, the text a `LosslessNumber` holds. */
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * Whether the number token `text[start, end)` may be big: longer than 15 characters, or with an
 * exponent. A token of at most 15 characters with no exponent has at most 15 significant digits,
 * which a float always writes back the same, so plain documents pay one length check per number.
 */
export function mayBeBig(text: string, start: number, end: number): boolean {
  if (end - start > 15) return true;
  for (let i = start; i < end; i++) {
    const c = text.charCodeAt(i);
    if (c === 101 || c === 69) return true;
  }
  return false;
}

/**
 * The data of a number whose decimal text (spec 015 §Terms) is `decimal`: a `LosslessNumber` when
 * it is a big number, else `value`, the number the parser read for it (so plain numbers stay
 * exactly what they were). A `decimal` that is not an RFC 8259 number (a parser's error recovery)
 * also gives `value`.
 */
export function numberValue(decimal: string, value: number): number | LosslessNumber {
  if (!DECIMAL.test(decimal) || isSafeNumber(decimal)) return value;
  return new LosslessNumber(decimal);
}

/**
 * A JSON5 number token's decimal text (spec 015 §Terms, as spec 006 C3 writes it): a leading `+`
 * dropped, hex as its exact decimal digits with the sign kept, `.5` as `0.5`, `5.` as `5`.
 * Undefined for `Infinity` and `NaN`, which are never big numbers.
 */
export function json5DecimalText(token: string): string | undefined {
  const sign = token[0] === '-' ? '-' : '';
  const body = token[0] === '-' || token[0] === '+' ? token.slice(1) : token;
  if (body === 'Infinity' || body === 'NaN') return undefined;
  if (body[1] === 'x' || body[1] === 'X') return sign + BigInt(body).toString();
  // A dot needs a digit on one side (JSON5): `.5` gains a 0 before it, `5.` and `5.e3` lose it.
  const leading = body[0] === '.' ? `0${body}` : body;
  return sign + leading.replace(/\.(?!\d)/, '');
}

/** Whether a JSON5 number token may be big: `mayBeBig`, or hex with more than 13 digits (up to 13
 *  hex digits is at most 52 bits, always a safe integer). */
export function json5MayBeBig(text: string, start: number, end: number): boolean {
  let digits = start;
  const c = text.charCodeAt(digits);
  if (c === 43 || c === 45) digits++;
  if (text.charCodeAt(digits) === 48 && (text.charCodeAt(digits + 1) | 0x20) === 120)
    return end - digits - 2 > 13;
  return mayBeBig(text, start, end);
}

/** A JSON5 number token's data: `value` (as the parser read it), or a `LosslessNumber` for a big
 *  number. */
export function json5NumberValue(token: string, value: number): number | LosslessNumber {
  const decimal = json5DecimalText(token);
  return decimal === undefined ? value : numberValue(decimal, value);
}

const BIG_EXPONENT = /[\d.][eE][+-]?\d{3}/;

/**
 * Whether `text` may hold a big number anywhere, strings and comments included (a false positive
 * only costs the exact path). A big number has 16 or more digits, which with at most one dot among
 * them include a run of 8, or an exponent of 3 or more digits (overflow and underflow: at most 15
 * digits with a 2-digit exponent stay within a float's range). The scan looks for runs of 8 digits
 * and checks the digits around each, so text full of short numbers is read once.
 */
export function mayHoldBigNumber(text: string): boolean {
  if (BIG_EXPONENT.test(text)) return true;
  const eight = /\d{8}/g;
  for (let m = eight.exec(text); m; m = eight.exec(text)) {
    let start = m.index;
    let end = eight.lastIndex;
    while (start > 0 && isDigitOrDot(text.charCodeAt(start - 1))) start--;
    while (end < text.length && isDigitOrDot(text.charCodeAt(end))) end++;
    let digits = 0;
    for (let i = start; i < end; i++) if (text.charCodeAt(i) !== 46) digits++;
    if (digits >= 16) return true;
    eight.lastIndex = end;
  }
  return false;
}

const isDigitOrDot = (c: number) => (c >= 48 && c <= 57) || c === 46;

/** Whether `value` holds a `LosslessNumber` or a `BigInt` anywhere. */
export function holdsBigNumber(value: unknown): boolean {
  if (typeof value === 'bigint' || value instanceof LosslessNumber) return true;
  if (typeof value !== 'object' || value === null) return false;
  const stack: object[] = [value];
  for (let next = stack.pop(); next; next = stack.pop()) {
    const members: unknown[] = Array.isArray(next) ? next : Object.values(next);
    for (const member of members) {
      if (typeof member === 'bigint' || member instanceof LosslessNumber) return true;
      if (typeof member === 'object' && member !== null) stack.push(member);
    }
  }
  return false;
}

/**
 * `JSON.stringify(value, null, unit)` with big numbers (B2): a `LosslessNumber` is written as its
 * `value` and a `BigInt` as its digits, where `JSON.stringify` would write an object or throw.
 * Everything else is written exactly as `JSON.stringify` writes it.
 */
export function jsonText(value: unknown, unit?: string): string | undefined {
  if (!holdsBigNumber(value)) return JSON.stringify(value, null, unit);
  return writeJson(value, unit);
}

/** `jsonText`'s writer, always taken (exported for the test that it equals `JSON.stringify` on
 *  data with no big number). Follows ECMAScript's SerializeJSONProperty: `toJSON`, boxed
 *  primitives, `undefined`, functions and symbols, non-finite numbers. */
export function writeJson(value: unknown, unit?: string): string | undefined {
  const gap = unit ?? '';
  const property = (key: string, v: unknown, indent: string): string | undefined => {
    if (v instanceof LosslessNumber) return v.value;
    if (typeof v === 'object' && v !== null) {
      const toJSON = (v as { toJSON?: unknown }).toJSON;
      if (typeof toJSON === 'function') v = toJSON.call(v, key) as unknown;
    }
    if (v instanceof LosslessNumber) return v.value;
    if (v instanceof Number || v instanceof String || v instanceof Boolean) v = v.valueOf();
    if (v === null || typeof v === 'boolean' || typeof v === 'string' || typeof v === 'number')
      return JSON.stringify(v);
    if (typeof v === 'bigint') return v.toString();
    if (typeof v !== 'object') return undefined;
    return Array.isArray(v) ? array(v, indent) : object(v as Record<string, unknown>, indent);
  };
  const array = (items: readonly unknown[], indent: string): string => {
    if (items.length === 0) return '[]';
    const inner = indent + gap;
    const parts = Array.from(items, (item, i) => property(String(i), item, inner) ?? 'null');
    return gap === ''
      ? `[${parts.join(',')}]`
      : `[\n${inner}${parts.join(`,\n${inner}`)}\n${indent}]`;
  };
  const object = (record: Record<string, unknown>, indent: string): string => {
    const inner = indent + gap;
    const parts: string[] = [];
    for (const key of Object.keys(record)) {
      const text = property(key, record[key], inner);
      if (text !== undefined) parts.push(`${JSON.stringify(key)}:${gap === '' ? '' : ' '}${text}`);
    }
    if (parts.length === 0) return '{}';
    return gap === ''
      ? `{${parts.join(',')}}`
      : `{\n${inner}${parts.join(`,\n${inner}`)}\n${indent}}`;
  };
  return property('', value, '');
}

/**
 * `data` with each `LosslessNumber` replaced by its nearest number, `Number(value)` (spec 015
 * §Terms): what Ajv validates (B6) and what readers that compare floats get. Containers holding
 * none are returned as they are; the others are copied, with `__proto__` keys kept as members.
 */
export function nearestNumbers(data: unknown): unknown {
  if (data instanceof LosslessNumber) return Number(data.value);
  if (typeof data !== 'object' || data === null || !holdsBigNumber(data)) return data;
  if (Array.isArray(data)) return data.map(nearestNumbers);
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data))
    Object.defineProperty(copy, key, {
      value: nearestNumbers(value),
      writable: true,
      enumerable: true,
      configurable: true,
    });
  return copy;
}
