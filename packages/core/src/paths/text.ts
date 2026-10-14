// Path text (spec 018 §Path text, P1–P4): a node's path written as JSONPath (RFC 9535) or JSON
// Pointer (RFC 6901), and read back from what a user types or pastes.
import { parseIndex } from '../formats/pointer.js';

/** One step from a node to its child: a member name, or an array index (an integer ≥ 0). */
export type PathStep = string | number;
/** The steps from the root of the data to one node; the root's path is empty. */
export type Path = readonly PathStep[];

export type ReadPathResult = { path: PathStep[] } | { error: string };

/** P1's member-name-shorthand (RFC 9535 §2.5.1.1): `name-first *name-char`, where name-first is
 *  an ASCII letter, `_` or a code point from U+0080 up that is not a surrogate, and name-char adds
 *  the ASCII digits. `u` reads a surrogate pair as one code point, and a lone one as itself. */
const NAME =
  '[A-Za-z_\\u0080-\\ud7ff\\ue000-\\u{10ffff}][0-9A-Za-z_\\u0080-\\ud7ff\\ue000-\\u{10ffff}]*';
const SHORTHAND = new RegExp(`^${NAME}$`, 'u');
const SHORTHAND_PREFIX = new RegExp(`^${NAME}`, 'u');

const ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  "'": "\\'",
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
};

const hex4 = (unit: number) => `\\u${unit.toString(16).padStart(4, '0')}`;

/** P1: `$`, then `[i]` per index, `.name` per shorthand name and `['…']` per other name, escaped
 *  as RFC 9535 §2.7 normalized paths escape it, a lone surrogate as `\uxxxx`. */
export function jsonPath(path: Path): string {
  let out = '$';
  for (const step of path) {
    if (typeof step === 'number') out += `[${step}]`;
    else if (SHORTHAND.test(step)) out += `.${step}`;
    else out += `['${quoteName(step)}']`;
  }
  return out;
}

/** A name's characters inside `'…'`: `\\`, `\'`, the five short escapes, `\u00xx` for the other
 *  U+0000–U+001F, `\uxxxx` for a lone surrogate, every other character as itself. */
function quoteName(name: string): string {
  // A surrogate pair matches as one code point (`u`) and is kept; a lone surrogate matches alone.
  return name.replace(
    /[\\'\u0000-\u001f]|[\ud800-\udfff]/gu, // eslint-disable-line no-control-regex
    (c) => ESCAPES[c] ?? hex4(c.charCodeAt(0)),
  );
}

/** P2: RFC 6901's string form, `''` for the root, `~` as `~0` and `/` as `~1` in names. */
export function jsonPointer(path: Path): string {
  let out = '';
  for (const step of path)
    out += `/${typeof step === 'number' ? step : step.replace(/~/g, '~0').replace(/\//g, '~1')}`;
  return out;
}

const refuse = (reason: string): { error: string } => ({
  error: `Not a path to one node: ${reason}.`,
});

/**
 * P3: the path a text names. Spaces, tabs and line breaks before the text are ignored, and after
 * it too, except after a JSON Pointer, where they are part of the last name (so P4 holds for a
 * name that ends in a space). Empty or `$` is the root; `$` followed by `.name`, `['…']`,
 * `["…"]` and `[i]` parts is a JSONPath; text from `/` on is a JSON Pointer, whose steps are
 * array indices where `data` holds an array at that step and the step is an index (RFC 6901 §4),
 * else member names. Anything else is refused with the reason.
 */
export function readPath(text: string, data: unknown): ReadPathResult {
  const start = /^[ \t\r\n]*/.exec(text)![0].length;
  if (text[start] === '/') return readPointer(text.slice(start), data);
  const trimmed = text.slice(start).replace(/[ \t\r\n]+$/, '');
  if (trimmed === '') return { path: [] };
  if (trimmed[0] !== '$') return refuse('a JSONPath starts with `$` and a JSON Pointer with `/`');
  return new JsonPathReader(trimmed).read();
}

function readPointer(pointer: string, data: unknown): ReadPathResult {
  const path: PathStep[] = [];
  let value = data;
  for (const token of pointer.slice(1).split('/')) {
    if (/~(?![01])/.test(token)) return refuse('in a JSON Pointer, `~` is written `~0` or `~1`');
    const name = token.replace(/~1/g, '/').replace(/~0/g, '~');
    const index = Array.isArray(value) ? parseIndex(name) : undefined;
    if (index !== undefined) {
      path.push(index);
      value = (value as unknown[])[index];
    } else {
      path.push(name);
      value =
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.hasOwn(value, name)
          ? (value as Record<string, unknown>)[name]
          : undefined;
    }
  }
  return { path };
}

/** RFC 9535 string escapes after `\` (§2.3.1.1), besides the quote and `u`. */
const UNESCAPE: Record<string, string> = {
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  '/': '/',
  '\\': '\\',
};

class JsonPathReader {
  private pos = 1;
  private readonly path: PathStep[] = [];

  constructor(private readonly text: string) {}

  read(): ReadPathResult {
    const t = this.text;
    while (this.pos < t.length) {
      const c = t[this.pos]!;
      let reason: string | undefined;
      if (c === '.') reason = this.shorthand();
      else if (c === '[') reason = this.bracket();
      else reason = this.unexpected();
      if (reason !== undefined) return refuse(reason);
    }
    return { path: this.path };
  }

  private unexpected(): string {
    const at = this.text.codePointAt(this.pos)!;
    return `unexpected \`${String.fromCodePoint(at)}\` at character ${this.pos + 1}`;
  }

  private shorthand(): string | undefined {
    const t = this.text;
    this.pos++;
    if (t[this.pos] === '.') return '`..` selects descendants, not one node';
    if (t[this.pos] === '*') return 'a wildcard selects every child, not one node';
    const m = SHORTHAND_PREFIX.exec(t.slice(this.pos));
    if (!m) return this.pos < t.length ? this.unexpected() : 'a name is missing after `.`';
    this.path.push(m[0]);
    this.pos += m[0].length;
    return undefined;
  }

  private bracket(): string | undefined {
    const t = this.text;
    this.pos++;
    const c = t[this.pos];
    let reason: string | undefined;
    if (c === "'" || c === '"') reason = this.name(c);
    else if (c === '*') return 'a wildcard selects every child, not one node';
    else if (c === '?') return 'a filter selects any number of nodes, not one node';
    else if (c === '-') return 'a negative index counts from the end, so it is not one node';
    else if (c !== undefined && c >= '0' && c <= '9') reason = this.index();
    else if (c === ':') return 'a slice selects a range, not one node';
    else return c === undefined ? '`]` is missing' : this.unexpected();
    if (reason !== undefined) return reason;
    if (t[this.pos] === ',') return 'a list of selectors selects several nodes, not one node';
    if (t[this.pos] === ':') return 'a slice selects a range, not one node';
    if (t[this.pos] !== ']') return this.pos < t.length ? this.unexpected() : '`]` is missing';
    this.pos++;
    return undefined;
  }

  private index(): string | undefined {
    const m = /^[0-9]+/.exec(this.text.slice(this.pos))!;
    if (m[0].length > 1 && m[0][0] === '0') return 'an index is written without leading zeros';
    const index = Number(m[0]);
    if (!Number.isSafeInteger(index)) return `the index ${m[0]} is too large`;
    this.path.push(index);
    this.pos += m[0].length;
    return undefined;
  }

  /** A quoted name: RFC 9535 §2.3.1.1's string literal, plus P1's `\uxxxx` for a lone surrogate. */
  private name(quote: string): string | undefined {
    const t = this.text;
    let out = '';
    this.pos++;
    for (;;) {
      const at = t.codePointAt(this.pos);
      if (at === undefined) return `the closing ${quote} is missing`;
      const c = String.fromCodePoint(at);
      if (c === quote) break;
      if (at < 0x20) return `character ${this.pos + 1} must be escaped`;
      if (at >= 0xd800 && at <= 0xdfff) return `character ${this.pos + 1} is a lone surrogate`;
      if (c !== '\\') {
        out += c;
        this.pos += c.length;
        continue;
      }
      const e = t[this.pos + 1];
      if (e === quote) out += quote;
      else if (e !== undefined && UNESCAPE[e] !== undefined) out += UNESCAPE[e];
      else if (e === 'u') {
        const unit = this.hex(this.pos + 2);
        if (unit === undefined) return `\`\\u\` at character ${this.pos + 1} needs four hex digits`;
        out += String.fromCharCode(unit);
        this.pos += 4;
      } else return `\`\\${e ?? ''}\` at character ${this.pos + 1} is not an escape`;
      this.pos += 2;
    }
    this.path.push(out);
    this.pos++;
    return undefined;
  }

  private hex(at: number): number | undefined {
    const digits = this.text.slice(at, at + 4);
    return /^[0-9A-Fa-f]{4}$/.test(digits) ? parseInt(digits, 16) : undefined;
  }
}
