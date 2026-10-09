// Scanner for a broken document (003 T8, from spike 002 T11's
// `spikes/repair-comments/scan.ts`). It finds comments without a parser, knowing the string forms
// jsonrepair accepts ("…", '…', “…”, ‘…’, and a string left open at the end of its line) so a
// comment marker inside a string is not taken for a comment. For JSON5 it also finds the literals
// jsonrepair would change (UNK-028).

/** A span of the input: a comment, or a JSON5 literal to protect. */
export interface Span {
  start: number;
  end: number;
  text: string;
}

export interface Scan {
  comments: Span[];
  /** JSON5 values jsonrepair 3.15.0 would change or reject: hex numbers, `Infinity` and `NaN`
   *  (signed or not), numbers with a `+` sign, and strings with an escape JSON does not have
   *  (`\x41`, `\v`, `\0`, a line continuation). Empty unless the scan was for JSON5. */
  literals: Span[];
  /** How many `[`/`{` outside strings and comments are never closed (what jsonrepair appends to a
   *  truncated file). */
  unclosed: number;
}

// jsonrepair reads an unquoted URL value (a scheme, a colon, two slashes) as a URL, not as a value
// followed by a comment (jsonrepair 3.15.0 lib/esm/regular/jsonrepair.js:705, regexUrlStart and
// regexUrlChar in lib/esm/utils/stringUtils.js:38-41). The scanner does the same so it does not
// mask half a URL.
const URL_SCHEME_BEFORE = /(?:^|[^A-Za-z0-9_$])(?:http|https|ftp|mailto|file|data|irc):$/;
const URL_CHAR = /[A-Za-z0-9\-._~:/?#@!$&'()*+;=]/;

const DOUBLE_QUOTES = new Set(['"', '“', '”']);
const SINGLE_QUOTES = new Set(["'", '‘', '’']);

/** JSON5 numbers jsonrepair turns into strings (hex, Infinity, NaN) or rejects (a `+` sign). */
const JSON5_NUMBER =
  /[+-]?(?:0[xX][0-9a-fA-F]+|Infinity|NaN)(?![A-Za-z0-9_$])|\+(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?(?![A-Za-z0-9_$])/y;
/** Characters after a backslash that JSON reads as JSON5 does (`'` too: jsonrepair keeps it). */
const JSON_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u', "'"]);
const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/;

export function scan(text: string, json5 = false): Scan {
  const comments: Span[] = [];
  const literals: Span[] = [];
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    const closers = DOUBLE_QUOTES.has(ch)
      ? DOUBLE_QUOTES
      : SINGLE_QUOTES.has(ch)
        ? SINGLE_QUOTES
        : null;
    if (closers) {
      // A string ends at a closing quote of the same kind, or (left open) at the end of the line.
      // JSON5 strings may also continue across a line after a backslash.
      const start = i;
      let protect = false;
      i++;
      while (i < text.length && !closers.has(text[i]!) && text[i] !== '\n' && text[i] !== '\r') {
        if (text[i] === '\\') {
          const next = text[i + 1];
          if (json5 && next !== undefined && !JSON_ESCAPES.has(next)) protect = true;
          // A line continuation: `\` then LF, CR or CRLF.
          i += next === '\r' && text[i + 2] === '\n' ? 3 : 2;
        } else i++;
      }
      const closed = i < text.length && text[i] === ch;
      if (i < text.length && closers.has(text[i]!)) i++;
      if (protect && closed && (ch === '"' || ch === "'"))
        literals.push({ start, end: i, text: text.slice(start, i) });
      continue;
    }
    if (
      ch === '/' &&
      text[i + 1] === '/' &&
      URL_SCHEME_BEFORE.test(text.slice(Math.max(0, i - 8), i))
    ) {
      while (i < text.length && URL_CHAR.test(text[i]!)) i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      let end = i + 2;
      while (end < text.length && text[end] !== '\n' && text[end] !== '\r') end++;
      comments.push({ start: i, end, text: text.slice(i, end) });
      i = end;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      const end = close < 0 ? text.length : close + 2;
      comments.push({ start: i, end, text: text.slice(i, end) });
      i = end;
      continue;
    }
    if (json5 && !IDENTIFIER_CHAR.test(text[i - 1] ?? ' ')) {
      JSON5_NUMBER.lastIndex = i;
      const match = JSON5_NUMBER.exec(text);
      if (match && !/^\s*:/.test(text.slice(i + match[0].length, i + match[0].length + 64))) {
        literals.push({ start: i, end: i + match[0].length, text: match[0] });
        i += match[0].length;
        continue;
      }
    }
    if (ch === '[' || ch === '{') depth++;
    else if ((ch === ']' || ch === '}') && depth > 0) depth--;
    i++;
  }
  return { comments, literals, unclosed: depth };
}
