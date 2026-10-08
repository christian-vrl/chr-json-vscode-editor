// Comment scanner shared by both engines (002 T11 spike, UNK-018). It knows the string forms
// jsonrepair accepts ("…", '…', “…”, ‘…’, and a string left open at the end of its line) so a
// comment marker inside a string is not taken for a comment.
export interface Comment {
  start: number;
  end: number;
  text: string;
}

// jsonrepair reads an unquoted `http://…` value as a URL, not as a value followed by a comment
// (jsonrepair 3.15.0 lib/esm/regular/jsonrepair.js:705, regexUrlStart and regexUrlChar in
// lib/esm/utils/stringUtils.js:38-41). The scanner does the same so it does not mask half a URL.
const URL_SCHEME_BEFORE = /(?:^|[^A-Za-z0-9_$])(?:http|https|ftp|mailto|file|data|irc):$/;
const URL_CHAR = /[A-Za-z0-9\-._~:/?#@!$&'()*+;=]/;

const DOUBLE_QUOTES = new Set(['"', '“', '”']);
const SINGLE_QUOTES = new Set(["'", '‘', '’']);

/** Every `//` and `/* *\/` comment outside strings, in order. */
export function scanComments(text: string): Comment[] {
  return scan(text).comments;
}

/**
 * Comments, plus how many `[`/`{` outside strings and comments are never closed (what jsonrepair
 * appends to a truncated file).
 */
export function scan(text: string): { comments: Comment[]; unclosed: number } {
  const comments: Comment[] = [];
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
      i++;
      while (i < text.length && !closers.has(text[i]!) && text[i] !== '\n' && text[i] !== '\r') {
        i += text[i] === '\\' ? 2 : 1;
      }
      if (i < text.length && closers.has(text[i]!)) i++;
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
    if (ch === '[' || ch === '{') depth++;
    else if ((ch === ']' || ch === '}') && depth > 0) depth--;
    i++;
  }
  return { comments, unclosed: depth };
}
