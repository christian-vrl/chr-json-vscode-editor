// Big numbers (spec 015, ADR-014). A number token whose value JavaScript cannot write back with the
// same digits (lossless-json's `isSafeNumber` is `false` for its decimal text) is a lossless-json
// `LosslessNumber` in data, holding that decimal text; every other number stays a JavaScript
// `number`, exactly as before (B1). Writers write a `LosslessNumber` as its digits and a `BigInt`
// as its decimal digits (B2).
//
// Only `LosslessNumber` instances are numbers: an object of the document that happens to have
// `isLosslessNumber` and `value` members stays an object (B5), so every check here is `instanceof`,
// never lossless-json's duck-typed `isLosslessNumber`.
import { isSafeNumber, LosslessNumber, parse as losslessParse } from 'lossless-json';

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

/** A key the text may spell `__proto__` with: literally, or with a `\u` escape of one of its
 *  letters or underscores (U+005F to U+0074). */
const PROTO_KEY = /__proto__|\\u00[5-7][0-9a-fA-F]/;

/**
 * Strict JSON (RFC 8259) read with its big numbers exact (B1). `big(decimal)` makes the value of each
 * big number (a `LosslessNumber` unless given); plain numbers are `Number(text)`, as `JSON.parse`
 * reads them. A duplicate key's last value wins in the first one's place, as `JSON.parse` does.
 * Undefined when the text is not strict JSON, and for a text that may hold a `__proto__` key, which
 * lossless-json assigns (setting the object's prototype) where `JSON.parse` defines a member: the
 * caller reads those with core's parser.
 *
 * `JSON.parse` does the reading (spec 015 criterion 11, UNK-089): each big number token outside a
 * string is first written as a marked string (`readMarked`). Texts that path cannot decide go to
 * lossless-json's parser, as before.
 */
export function readJsonExact(
  text: string,
  big: (decimal: string) => unknown = (decimal) => new LosslessNumber(decimal),
): { data: unknown } | undefined {
  if (PROTO_KEY.test(text)) return undefined;
  const read = readMarked(text, big);
  if (read !== UNDECIDED) return read;
  const number = (token: string): unknown =>
    (token.length > 15 || token.includes('e') || token.includes('E')) && !isSafeNumber(token)
      ? big(token)
      : Number(token);
  try {
    const data = losslessParse(text, null, {
      parseNumber: number,
      onDuplicateKey: ({ newValue }) => newValue,
    });
    return { data };
  } catch {
    return undefined;
  }
}

const UNDECIDED = Symbol('undecided');

/** A number token that may be big (`mayBeBig`): 16 or more characters, or an exponent. It starts
 *  after no digit or dot, so outside strings of valid JSON it matches whole tokens. */
const BIG_CANDIDATE = /(?<![\d.])-?\d(?:[\d.eE+-]{15,}|[\d.]*[eE][+-]?\d+)/g;

/** The mark a big number's string starts with: U+0001, which JSON can only write as this escape
 *  (a raw control character is not allowed in a string). */
const MARK = '\\u0001';

/**
 * `readJsonExact` through `JSON.parse`: each big number token outside a string is written as the
 * string `"\u0001<token>"`, the text is read by `JSON.parse`, and a walk turns each string starting
 * with U+0001 back into `big(token)`. When the text holds no `\u0001` escape, such strings are
 * exactly the marked numbers, so the rewritten text is valid exactly when the text is: undefined
 * when `JSON.parse` refuses it. `UNDECIDED` when the text holds that escape, or when fewer marked
 * strings come back than were written (a duplicate key's dropped value, or one marked in a key
 * place, which only an invalid text has): lossless-json's parser decides those.
 */
function readMarked(
  text: string,
  big: (decimal: string) => unknown,
): { data: unknown } | undefined | typeof UNDECIDED {
  if (text.includes(MARK)) return UNDECIDED;
  let marked = '';
  let last = 0;
  let count = 0;
  // Whether the scan is inside a string at `quote`, the next `"` not yet passed.
  let inString = false;
  let quote = text.indexOf('"');
  const candidates = new RegExp(BIG_CANDIDATE);
  for (let match = candidates.exec(text); match; match = candidates.exec(text)) {
    const at = match.index;
    while (quote !== -1 && quote < at) {
      if (!inString || !isEscaped(text, quote)) inString = !inString;
      quote = text.indexOf('"', quote + 1);
    }
    const token = match[0];
    if (inString || !DECIMAL.test(token) || isSafeNumber(token)) continue;
    marked += `${text.slice(last, at)}"${MARK}${token}"`;
    last = candidates.lastIndex;
    count++;
  }
  let data: unknown;
  try {
    data = JSON.parse(count === 0 ? text : marked + text.slice(last));
  } catch {
    return undefined;
  }
  if (count === 0) return { data };
  let found = 0;
  const unmark = (value: unknown): unknown => {
    if (typeof value !== 'string' || value.charCodeAt(0) !== 1) return value;
    found++;
    return big(value.slice(1));
  };
  // A document that is one big number.
  if (typeof data === 'string') data = unmark(data);
  const stack: unknown[] = typeof data === 'object' ? [data] : [];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    if (typeof next !== 'object' || next === null) continue;
    if (Array.isArray(next)) {
      for (let i = 0; i < next.length; i++) {
        const value: unknown = next[i];
        if (typeof value === 'object') stack.push(value);
        else if (typeof value === 'string') next[i] = unmark(value);
      }
      continue;
    }
    const record = next as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const value = record[key];
      if (typeof value === 'object') stack.push(value);
      else if (typeof value === 'string' && value.charCodeAt(0) === 1) {
        // A `__proto__` member is defined, not assigned, so it stays a member.
        if (key === '__proto__') Object.defineProperty(record, key, { value: unmark(value) });
        else record[key] = unmark(value);
      }
    }
  }
  return found === count ? { data } : UNDECIDED;
}

/** Whether the `"` at `quote`, inside a string, is escaped: an odd run of backslashes before it. */
function isEscaped(text: string, quote: number): boolean {
  let before = quote - 1;
  while (text.charCodeAt(before) === 92) before--;
  return (quote - 1 - before) % 2 === 1;
}

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
 *  primitives, `undefined`, functions and symbols, non-finite numbers. `numberText` writes the
 *  plain numbers (`JSON.stringify`'s way unless given). */
export function writeJson(
  value: unknown,
  unit?: string,
  numberText: (n: number) => string = JSON.stringify,
): string | undefined {
  const gap = unit ?? '';
  const property = (key: string, v: unknown, indent: string): string | undefined => {
    if (v instanceof LosslessNumber) return v.value;
    if (typeof v === 'object' && v !== null) {
      const toJSON = (v as { toJSON?: unknown }).toJSON;
      if (typeof toJSON === 'function') v = toJSON.call(v, key) as unknown;
    }
    if (v instanceof LosslessNumber) return v.value;
    if (v instanceof Number || v instanceof String || v instanceof Boolean) v = v.valueOf();
    if (typeof v === 'number') return numberText(v);
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
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
 * A document value as one line of JSON text that `parseData('json', text)` reads back as the same
 * value (spec 015 B5, the protocol's `valueText`): `jsonText` with big numbers as their digits, and
 * `-0` written as `-0`, where `JSON.stringify` writes `0`. `NaN` and the infinities are written as
 * JSON5 writes them, so the JSON reader refuses the text rather than reading `null`; so is a value
 * JSON has no text for (`undefined`, a function), written as `undefined`.
 */
export function valueText(value: unknown): string {
  const numberText = (n: number) =>
    Object.is(n, -0) ? '-0' : Number.isFinite(n) ? JSON.stringify(n) : String(n);
  return writeJson(value, undefined, numberText) ?? 'undefined';
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

// --- Equality and order by exact value (spec 015 B3, 015 T3) ---------------------------------------
//
// A number's exact value is the decimal value its text denotes (spec 015 §Terms). A big number's
// text is its `value`; a plain number's is `String(n)`, which has the significant digits of the text
// it was read from (a text whose digits `String(Number(text))` does not give back is a big number),
// so both are read the same way here.

/** An exact value as `digits × 10^exponent`: `digits` without leading or trailing zeros (empty for
 *  zero, whose sign is then `''`). */
interface Exact {
  sign: '' | '-';
  digits: string;
  exponent: bigint;
}

const EXACT = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/** The exact value of a decimal text (RFC 8259 grammar, or `String(n)` of a finite number). */
function exactOf(text: string): Exact {
  const match = EXACT.exec(text);
  if (!match) throw new Error(`not a decimal number: ${text}`);
  const [, sign, whole, fraction = '', exponent = '0'] = match;
  const all = whole! + fraction;
  const first = all.search(/[1-9]/);
  if (first < 0) return { sign: '', digits: '', exponent: 0n };
  const last = all.length - /0*$/.exec(all)![0].length;
  return {
    sign: sign as '' | '-',
    digits: all.slice(first, last),
    exponent: BigInt(exponent) - BigInt(fraction.length) + BigInt(all.length - last),
  };
}

/** -1, 0 or 1 as exact value `a` is below, equal to or above `b`. */
function compareExact(a: Exact, b: Exact): number {
  const signOf = (x: Exact) => (x.digits === '' ? 0 : x.sign === '-' ? -1 : 1);
  const sa = signOf(a);
  const sb = signOf(b);
  if (sa !== sb) return sa > sb ? 1 : -1;
  if (sa === 0) return 0;
  // Same sign: compare magnitudes, the leading digit's power of ten first, then digit by digit.
  const ma = a.exponent + BigInt(a.digits.length);
  const mb = b.exponent + BigInt(b.digits.length);
  const magnitude =
    ma > mb ? 1 : ma < mb ? -1 : a.digits > b.digits ? 1 : a.digits < b.digits ? -1 : 0;
  return sa * magnitude;
}

/**
 * The key `diff` gives a big number (B3, plan R5): equal for numbers with equal exact values. A
 * plain number keys as `d${n}`; a big number whose exact value is a plain number's (`1e20` for
 * `100000000000000000000`) keys as that number, and any other one by its exact value (`b`, sign,
 * digits, `e`, exponent), which no plain number's key equals.
 */
export function bigNumberKey(big: LosslessNumber): string {
  const exact = exactOf(big.value);
  const nearest = Number(big.value);
  if (Number.isFinite(nearest) && compareExact(exactOf(String(nearest)), exact) === 0)
    return `d${nearest}`;
  return `b${exact.sign}${exact.digits}e${exact.exponent}`;
}

/**
 * Orders two numbers, plain or big, by exact value (B3): -1, 0 or 1. Two plain numbers compare as
 * floats, exactly as before (`-0` equals `0`; `NaN` is neither below nor above anything, so 0). A
 * plain `Infinity` is above every big number and `-Infinity` below; `NaN` against a big number is 0,
 * as against a plain number. That 0 is not an order (`NaN` "equals" both `1` and `2`), so a sort of
 * values holding `NaN` is only as ordered as it was before spec 015; only JSON5 text can hold `NaN`
 * (JSON and JSON Lines have no token for it), and 015 T3's review left it so (#120 F2).
 */
export function compareNumbers(a: number | LosslessNumber, b: number | LosslessNumber): number {
  if (typeof a === 'number' && typeof b === 'number') return a > b ? 1 : a < b ? -1 : 0;
  if (typeof a === 'number' && !Number.isFinite(a)) return Number.isNaN(a) ? 0 : a > 0 ? 1 : -1;
  if (typeof b === 'number' && !Number.isFinite(b)) return Number.isNaN(b) ? 0 : b > 0 ? -1 : 1;
  return compareExact(exactOf(String(a)), exactOf(String(b)));
}

/** Whether two numbers, plain or big, are equal by exact value: RFC 6902's "numbers by value" for
 *  the `test` op (B3). Two plain numbers are equal exactly when `===` says so, as before. */
export function equalNumbers(a: number | LosslessNumber, b: number | LosslessNumber): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (typeof a === 'number' && !Number.isFinite(a)) return false;
  if (typeof b === 'number' && !Number.isFinite(b)) return false;
  return compareNumbers(a, b) === 0;
}
