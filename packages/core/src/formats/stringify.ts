// `stringify(data, format, style)` (002 T7): writes plain data as a new document in a format and
// style, so `parse(stringify(x, format, style)).data` deep-equals `x` (spec 002 criterion 6). It
// writes no comments (data has none). Spec 006 (conversion) does not use it: it keeps the file's
// layout (UNK-033) and rewrites tokens instead.
//
// Layout: like `JSON.stringify(data, null, indent)` with the style's line ending, and a final line
// ending when `finalNewline`. `indent: 0` writes everything on one line with no spaces. Empty
// containers are `{}` and `[]`. A trailing comma follows the last member of a multi-line container
// when `trailingCommas` (R6); a one-line container never gets one.
//
// Per format (R4, R6, R8):
// - `json`: double quotes, quoted keys, no trailing commas, whatever the style says.
// - `jsonc`: double quotes and quoted keys; trailing commas follow the style.
// - `json5`: strings use `style.quote`; keys are unquoted when `unquotedKeys` and the key is an ASCII
//   identifier name; `Infinity`, `-Infinity` and `NaN` are written as JSON5 literals; U+2028 and
//   U+2029 in strings are escaped.
// - `jsonl` (spec 012): data must be an array; each item is written on its own line as `json` with
//   `indent: 0` (so like `JSON.stringify`, `-0` aside), each line ended by `style.eol`, the last one
//   only when `finalNewline`; an empty array is `""`. Only `eol` and `finalNewline` are read.
// Numbers are written as `JSON.stringify` would, except `-0`, written `-0` so it reads back as -0.
// A big number (a `LosslessNumber`, spec 015 B2) is written as its `value`, unquoted, in every
// format, and a `BigInt` as its decimal digits.
// A value the format cannot hold (a non-finite number in JSON or JSONC, `undefined`, a function or
// a symbol) throws a `TypeError` rather than being dropped or changed.
import { LosslessNumber } from './numbers.js';
import type { Format, Style } from './types.js';

/** Keys JSON5 can write without quotes: an ES5 IdentifierName. Limited to ASCII so the check does
 *  not depend on a Unicode version; other keys are quoted. */
const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const escapeLineSeparator = (c: string): string => `\\u${c.charCodeAt(0).toString(16)}`;

export function stringify(data: unknown, format: Format, style: Style): string {
  if (format === 'jsonl') return stringifyLines(data, style);
  const json5 = format === 'json5';
  const quote = json5 ? style.quote : '"';
  const unquotedKeys = json5 && style.unquotedKeys;
  const trailingCommas = format !== 'json' && style.trailingCommas;
  const unit = style.indent === '\t' ? '\t' : ' '.repeat(style.indent);
  const eol = style.eol;

  const string = (s: string): string => {
    // JSON5 escapes U+2028 and U+2029: older ECMAScript reads them as line breaks, and the json5
    // package warns on them.
    const json = json5
      ? JSON.stringify(s).replace(/[\u2028\u2029]/g, escapeLineSeparator)
      : JSON.stringify(s);
    if (quote === '"') return json;
    // Swap the quote character: `\"` becomes `"` and `'` becomes `\'`. Matching `\\.` first keeps
    // an escaped backslash from being read as the start of `\"`.
    return `'${json.slice(1, -1).replace(/\\.|'/g, (m) => (m === '\\"' ? '"' : m === "'" ? "\\'" : m))}'`;
  };

  const key = (k: string): string => (unquotedKeys && identifier.test(k) ? k : string(k));

  const number = (n: number): string => {
    if (Number.isFinite(n)) return Object.is(n, -0) ? '-0' : JSON.stringify(n);
    if (!json5) throw new TypeError(`${String(n)} cannot be written in ${format.toUpperCase()}`);
    return String(n);
  };

  const container = (open: string, close: string, members: string[], indent: string): string => {
    if (members.length === 0) return open + close;
    if (unit === '') return open + members.join(',') + close;
    const inner = indent + unit;
    const body = members.map((m) => inner + m).join(',' + eol);
    return `${open}${eol}${body}${trailingCommas ? ',' : ''}${eol}${indent}${close}`;
  };

  const value = (v: unknown, indent: string): string => {
    switch (typeof v) {
      case 'string':
        return string(v);
      case 'number':
        return number(v);
      case 'boolean':
        return String(v);
      case 'bigint':
        return v.toString();
      case 'object':
        if (v === null) return 'null';
        if (v instanceof LosslessNumber) return v.value;
        if (Array.isArray(v)) {
          return container(
            '[',
            ']',
            Array.from(v, (item: unknown) => value(item, indent + unit)),
            indent,
          );
        }
        return container(
          '{',
          '}',
          Object.keys(v).map(
            (k) =>
              `${key(k)}:${unit === '' ? '' : ' '}${value((v as Record<string, unknown>)[k], indent + unit)}`,
          ),
          indent,
        );
      default:
        throw new TypeError(`a ${typeof v} cannot be written as ${format.toUpperCase()}`);
    }
  };

  return value(data, '') + (style.finalNewline ? eol : '');
}

/** JSON Lines (spec 012 §Other `FormatAdapter` actions). */
function stringifyLines(data: unknown, style: Style): string {
  if (!Array.isArray(data)) throw new TypeError('JSON Lines data must be an array of items');
  if (data.length === 0) return '';
  const line: Style = { ...style, indent: 0, finalNewline: false };
  const lines = Array.from(data, (item: unknown) => stringify(item, 'json', line));
  return lines.join(style.eol) + (style.finalNewline ? style.eol : '');
}
