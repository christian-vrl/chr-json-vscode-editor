// Reference readings of the conversion corpus (006 T1), independent of `packages/core`, so a typo in
// a hand-written expected.* or losses.json fails before `convert` exists (006 T2). The scanner below
// only tells strings, comments and other code apart; it is not a parser for any format.

export interface Segment {
  kind: 'string' | 'comment' | 'code';
  start: number;
  end: number;
}

/** What ends a `//` comment: JSON5's line terminators (spec.json5.org §6), or CR and LF. */
const json5LineTerminator = /[\n\r\u2028\u2029]/;
const lineTerminator = /[\n\r]/;

/** Splits `text` into strings, comments and code. `quotes` are the characters that open a string:
 *  `"` in JSON and JSONC, `"` and `'` in JSON5 (which also ends a `//` comment at U+2028 and U+2029). */
export function segments(text: string, quotes: string): Segment[] {
  const out: Segment[] = [];
  let code = 0;
  let i = 0;
  const ends = quotes.includes("'") ? json5LineTerminator : lineTerminator;
  const push = (kind: Segment['kind'], start: number, end: number) => {
    if (code < start) out.push({ kind: 'code', start: code, end: start });
    out.push({ kind, start, end });
    code = end;
  };
  while (i < text.length) {
    if (text.startsWith('//', i)) {
      let j = i + 2;
      while (j < text.length && !ends.test(text[j]!)) j++;
      push('comment', i, j);
      i = j;
    } else if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      const j = end < 0 ? text.length : end + 2;
      push('comment', i, j);
      i = j;
    } else if (quotes.includes(text[i]!)) {
      let j = i + 1;
      while (j < text.length && text[j] !== text[i]) j += text[j] === '\\' ? 2 : 1;
      push('string', i, j + 1);
      i = j + 1;
    } else {
      i++;
    }
  }
  if (code < text.length) out.push({ kind: 'code', start: code, end: text.length });
  return out;
}

export const quotesOf = (format: string) => (format === 'json5' ? `"'` : '"');

/** The comments of a text, as written. */
export const commentsIn = (text: string, format: string): string[] =>
  segments(text, quotesOf(format))
    .filter((s) => s.kind === 'comment')
    .map((s) => text.slice(s.start, s.end));

/** The text with its strings and comments left out. */
export const codeIn = (text: string, format: string): string =>
  segments(text, quotesOf(format))
    .filter((s) => s.kind === 'code')
    .map((s) => text.slice(s.start, s.end))
    .join(' ');

/**
 * A JSONC text as strict JSON, for `JSON.parse`: comments become one space and a comma followed
 * (past white space and comments) by `]` or `}` is dropped. Anything else JSON lacks, such as a
 * single-quoted string or a `\v`, is left in place, so `JSON.parse` rejects it.
 */
export function jsoncAsJson(text: string): string {
  const noComments = segments(text, '"')
    .map((s) => (s.kind === 'comment' ? ' ' : text.slice(s.start, s.end)))
    .join('');
  let out = '';
  for (const s of segments(noComments, '"')) {
    const piece = noComments.slice(s.start, s.end);
    if (s.kind === 'string') {
      out += piece;
      continue;
    }
    for (let i = 0; i < piece.length; i++) {
      // Past white space the next character is code or a string's opening quote, never inside one.
      const trailing =
        piece[i] === ',' && /^[ \t\r\n]*[\]}]/.test(noComments.slice(s.start + i + 1));
      if (!trailing) out += piece[i];
    }
  }
  return out;
}

/** Where `offset` is, by the container around it: `array` when that is an array, `nested-object`
 *  for an object inside the root, `root` for the root object or outside any container. */
export function locationAt(text: string, format: string, offset: number): string {
  const stack: string[] = [];
  for (const s of segments(text, quotesOf(format))) {
    if (s.start >= offset) break;
    if (s.kind !== 'code') continue;
    for (let i = s.start; i < Math.min(s.end, offset); i++) {
      const ch = text[i]!;
      if (ch === '{' || ch === '[') stack.push(ch);
      else if (ch === '}' || ch === ']') stack.pop();
    }
  }
  const top = stack.at(-1);
  if (top === '[') return 'array';
  return stack.length > 1 ? 'nested-object' : 'root';
}

export function parsePointer(pointer: string): string[] {
  return pointer === ''
    ? []
    : pointer
        .slice(1)
        .split('/')
        .map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/** `data` with the value at each pointer replaced by `value`; throws when a pointer names nothing. */
export function setAll(data: unknown, pointers: string[], value: unknown): unknown {
  let result = structuredClone(data);
  for (const pointer of pointers) {
    const tokens = parsePointer(pointer);
    if (tokens.length === 0) {
      result = value;
      continue;
    }
    let node = result as Record<string, unknown>;
    for (const t of tokens.slice(0, -1)) node = node[t] as Record<string, unknown>;
    const last = tokens.at(-1)!;
    if (!(last in node)) throw new Error(`pointer ${pointer} names no value`);
    node[last] = value;
  }
  return result;
}

export function getAt(data: unknown, pointer: string): unknown {
  let node = data;
  for (const t of parsePointer(pointer)) node = (node as Record<string, unknown>)[t];
  return node;
}

export interface KeyOrString {
  /** The token as written. */
  text: string;
  isKey: boolean;
  /** An unquoted JSON5 key. */
  unquoted: boolean;
}

/** An unquoted key: a name before `:`, at the start of a code piece or after `{` or `,`. */
const unquotedKey = /(?:^|[{,])\s*([^\s"':,{}[\]/]+)\s*:/g;

/** The string tokens and unquoted keys of a text, in order. */
export function keysAndStrings(text: string, format: string): KeyOrString[] {
  const parts = segments(text, quotesOf(format)).filter((s) => s.kind !== 'comment');
  const out: KeyOrString[] = [];
  for (const [index, s] of parts.entries()) {
    const piece = text.slice(s.start, s.end);
    if (s.kind === 'string') {
      const next = parts[index + 1];
      const isKey = next !== undefined && /^\s*:/.test(text.slice(next.start, next.end));
      out.push({ text: piece, isKey, unquoted: false });
    } else {
      for (const m of piece.matchAll(unquotedKey)) {
        out.push({ text: m[1]!, isKey: true, unquoted: true });
      }
    }
  }
  return out;
}
