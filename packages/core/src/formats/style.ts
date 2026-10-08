// `Style` detection (002 T3, AGENTS.md §Glossary). JSON and JSONC always write double quotes and
// quoted keys (R4); the indent unit, line ending, final newline and trailing commas come from the
// text, and for JSON5 also the quote and key style (002 T5).
import { parseJson5 } from './json5-parser.js';
import { isComment, Kind, tokenize, type Token } from './tokens.js';
import type { Format, Style } from './types.js';

/** `tokens` are the text's tokens when the caller has them: from jsonc-parser's scanner for JSON
 *  and JSONC, from `parseJson5` for JSON5. */
export function detectStyle(
  text: string,
  format: Format,
  tokens: readonly Token[] = format === 'json5' ? parseJson5(text).tokens : tokenize(text),
): Style {
  const style: Style = {
    indent: detectIndent(text, tokens),
    eol: detectEol(text),
    finalNewline: text.endsWith('\n'),
    quote: '"',
    unquotedKeys: false,
    trailingCommas: format !== 'json' && hasTrailingComma(tokens),
  };
  return format === 'json5' ? { ...style, ...detectJson5Quoting(text, tokens) } : style;
}

/**
 * R4 for JSON5. `quote` is the majority quote of string values, else of quoted keys when there are
 * no string values; double on a tie or with no strings at all. `unquotedKeys` holds when more keys
 * are unquoted than quoted.
 */
function detectJson5Quoting(
  text: string,
  tokens: readonly Token[],
): Pick<Style, 'quote' | 'unquotedKeys'> {
  const values = { '"': 0, "'": 0 };
  const keys = { '"': 0, "'": 0 };
  let unquoted = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind !== Kind.StringLiteral && t.kind !== Kind.Unknown) continue;
    let j = i + 1;
    while (j < tokens.length && isTrivia(tokens[j]!)) j++;
    const isKey = tokens[j]?.kind === Kind.Colon;
    if (t.kind === Kind.Unknown) unquoted++;
    else (isKey ? keys : values)[text[t.offset] as '"' | "'"]++;
  }
  const counts = values['"'] + values["'"] > 0 ? values : keys;
  return {
    quote: counts["'"] > counts['"'] ? "'" : '"',
    unquotedKeys: unquoted > keys['"'] + keys["'"],
  };
}

const isTrivia = (t: Token) =>
  t.kind === Kind.Whitespace || t.kind === Kind.LineBreak || isComment(t);

/** Majority line ending; a text with no line break gets `\n`. */
function detectEol(text: string): Style['eol'] {
  const crlf = text.split('\r\n').length - 1;
  const lf = text.split('\n').length - 1 - crlf;
  return crlf > lf ? '\r\n' : '\n';
}

/**
 * The dominant indent unit (R1). Each line that starts a token contributes its leading whitespace.
 * Tabs win when more of those lines start with a tab. For spaces, the unit is the most frequent
 * increase in width from one such line to the next (the smaller on a tie); with none, 2 (R1: a file
 * with no line breaks has indent unit 2 spaces).
 */
function detectIndent(text: string, tokens: readonly Token[]): Style['indent'] {
  const indents: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (i > 0 && tokens[i - 1]!.kind !== Kind.LineBreak) continue;
    const t = tokens[i]!;
    if (t.kind === Kind.LineBreak) continue;
    if (t.kind === Kind.Whitespace) {
      const next = tokens[i + 1];
      if (next !== undefined && next.kind !== Kind.LineBreak)
        indents.push(text.slice(t.offset, t.end));
    } else if (i > 0) {
      indents.push('');
    }
  }
  const tabs = indents.filter((s) => s.startsWith('\t')).length;
  const spaces = indents.filter((s) => s.startsWith(' ')).length;
  if (tabs > spaces) return '\t';
  const counts = new Map<number, number>();
  let previous = 0;
  for (const s of indents) {
    if (s.includes('\t')) continue;
    if (s.length > previous)
      counts.set(s.length - previous, (counts.get(s.length - previous) ?? 0) + 1);
    previous = s.length;
  }
  let unit = 2;
  let best = 0;
  for (const [step, count] of counts) {
    if (count > best || (count === best && step < unit)) {
      unit = step;
      best = count;
    }
  }
  return unit;
}

/** Whether some container ends with a comma (comments and line breaks between them allowed). */
function hasTrailingComma(tokens: readonly Token[]): boolean {
  let afterComma = false;
  for (const t of tokens) {
    if (t.kind === Kind.Whitespace || t.kind === Kind.LineBreak || isComment(t)) continue;
    if (afterComma && (t.kind === Kind.CloseBrace || t.kind === Kind.CloseBracket)) return true;
    afterComma = t.kind === Kind.Comma;
  }
  return false;
}
