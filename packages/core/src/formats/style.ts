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
  const indent = detectIndent(text, tokens);
  const style: Style = {
    indent: indent ?? 2,
    eol: detectEol(text),
    finalNewline: text.endsWith('\n'),
    quote: '"',
    unquotedKeys: false,
    trailingCommas: format !== 'json' && hasTrailingComma(tokens),
    ...(indent === undefined && { indentFound: false as const }),
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

/** The indent unit to write with: the style's, or `fallback` (spec 019 I1) when the text had no
 *  indentation to follow (`indentFound` false). */
export function indentUnit(style: Style, fallback: Style['indent'] | undefined): Style['indent'] {
  return style.indentFound === false && fallback !== undefined ? fallback : style.indent;
}

/** Majority line ending; a text with no line break gets `\n`. */
function detectEol(text: string): Style['eol'] {
  const crlf = text.split('\r\n').length - 1;
  const lf = text.split('\n').length - 1 - crlf;
  return crlf > lf ? '\r\n' : '\n';
}

/**
 * The dominant indent unit (R1). Tabs win when more of the lines that start a token start with a
 * tab. For spaces, the unit comes from the lines whose indentation is exactly their nesting level
 * times the unit even in a document whose columns are aligned (smart format, spec 010 criteria 4
 * and 5, pads keys, table rows and right-aligned numbers after the indentation): a line that starts
 * with a closing bracket, or with a comment that is not between a key and its value, at level 1 or
 * deeper, and a line of several numbers of an array of numbers once the padding that aligns its
 * first number by decimal point is taken off. The unit is their most frequent indentation per level
 * (the smaller on a tie). With no such line, it is the most frequent increase in width from one
 * line to the next (the smaller on a tie); with none, undefined: the text has no indentation to
 * follow, and the style gets 2 (R1: a file with no line breaks has indent unit 2 spaces) with
 * `indentFound: false`, so a writer can use the fallback it was given instead (spec 019 I1).
 */
function detectIndent(text: string, tokens: readonly Token[]): Style['indent'] | undefined {
  const lines = indentedLines(text, tokens);
  const tabs = lines.filter((l) => l.indent.startsWith('\t')).length;
  const spaces = lines.filter((l) => l.indent.startsWith(' ')).length;
  if (tabs > spaces) return '\t';
  const exact: number[] = [];
  for (const l of lines) {
    if (l.exact === undefined || l.level < 1 || l.indent.includes('\t')) continue;
    const width = l.indent.length - l.exact;
    if (width > 0 && width % l.level === 0) exact.push(width / l.level);
  }
  if (exact.length > 0) return mostFrequent(exact);
  const increases: number[] = [];
  let previous = 0;
  for (const { indent } of lines) {
    if (indent.includes('\t')) continue;
    if (indent.length > previous) increases.push(indent.length - previous);
    previous = indent.length;
  }
  return increases.length > 0 ? mostFrequent(increases) : undefined;
}

function mostFrequent(values: readonly number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let unit = 0;
  let best = 0;
  for (const [v, count] of counts) {
    if (count > best || (count === best && v < unit)) {
      unit = v;
      best = count;
    }
  }
  return unit;
}

const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * Each line after the first that starts a token: its leading white space, the nesting level of its
 * first token, and, when its indentation is exact (see `detectIndent`), the padding to take off it.
 */
function indentedLines(
  text: string,
  tokens: readonly Token[],
): { indent: string; level: number; exact: number | undefined }[] {
  const pad = numberPadding(text, tokens);
  const lines: { indent: string; level: number; exact: number | undefined }[] = [];
  // A container that starts a line after its key's colon (its value moved to the next line, as smart
  // format does after a multi-line comment between key and value) is one level deeper.
  const steps: number[] = [];
  let depth = 0;
  let previous: Token | undefined; // the last token that is not trivia
  let brokeSincePrevious = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const lineStart = i > 0 && tokens[i - 1]!.kind === Kind.LineBreak;
    if (lineStart && t.kind !== Kind.LineBreak) {
      let first = t;
      let indent = '';
      if (t.kind === Kind.Whitespace) {
        indent = text.slice(t.offset, t.end);
        first = tokens[i + 1] ?? t;
      }
      if (first.kind !== Kind.LineBreak && first.kind !== Kind.Whitespace) {
        let exact: number | undefined;
        let level = depth;
        if (first.kind === Kind.CloseBrace || first.kind === Kind.CloseBracket) {
          level = depth - 1;
          exact = 0;
        } else if (isComment(first) && previous?.kind !== Kind.Colon) exact = 0;
        else exact = pad.get(first);
        lines.push({ indent, level, exact });
      }
    }
    if (t.kind === Kind.LineBreak) brokeSincePrevious = true;
    if (t.kind === Kind.OpenBrace || t.kind === Kind.OpenBracket) {
      const step = previous?.kind === Kind.Colon && brokeSincePrevious ? 2 : 1;
      steps.push(step);
      depth += step;
    } else if (t.kind === Kind.CloseBrace || t.kind === Kind.CloseBracket)
      depth -= steps.pop() ?? 1;
    if (!isTrivia(t)) {
      previous = t;
      brokeSincePrevious = false;
    }
  }
  return lines;
}

/**
 * For each number that starts a line holding another item of the same array, in an array whose
 * items are all JSON numbers or `null`: the spaces smart format writes before it to line it up by
 * its decimal point or exponent (FracturedJson 5.1.0 `TableTemplate.FormatNumber`, Decimal), after
 * the column of the comments some items have before them on their line.
 */
function numberPadding(text: string, tokens: readonly Token[]): Map<Token, number> {
  interface NumberArray {
    /** Widest integer part (sign included) of its items, or -1 once an item is not a number. */
    widest: number;
    hasNull: boolean;
    /** Widest run of block comments before an item on its line. */
    comment: number;
    rows: Token[];
  }
  const before = (t: Token) => {
    if (t.kind === Kind.NullKeyword) return 4;
    const dot = text.slice(t.offset, t.end).search(/[.eE]/);
    return dot > 0 ? dot : t.end - t.offset;
  };
  const arrays: NumberArray[] = [];
  const stack: (NumberArray | undefined)[] = [];
  let lineNumber: Token | undefined; // a number that starts the current line
  let lineArray: NumberArray | undefined; // the array it is an item of
  let prefix: { start: number; end: number } | undefined; // comments before the next item
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === Kind.LineBreak) {
      const next = tokens[i + 1]?.kind === Kind.Whitespace ? tokens[i + 2] : tokens[i + 1];
      lineNumber = next?.kind === Kind.NumericLiteral ? next : undefined;
      lineArray = undefined;
      prefix = undefined;
      continue;
    }
    if (t.kind === Kind.BlockComment) {
      if (prefix) prefix.end = t.end;
      else prefix = { start: t.offset, end: t.end };
      continue;
    }
    if (t.kind === Kind.Comma || t.kind === Kind.LineComment) prefix = undefined;
    if (isTrivia(t) || t.kind === Kind.Comma || t.kind === Kind.Colon) continue;
    if (t.kind === Kind.CloseBrace || t.kind === Kind.CloseBracket) {
      stack.pop();
      continue;
    }
    const top = stack[stack.length - 1];
    if (top) {
      const number =
        t.kind === Kind.NullKeyword ||
        (t.kind === Kind.NumericLiteral && JSON_NUMBER.test(text.slice(t.offset, t.end)));
      if (!number) top.widest = -1;
      else if (top.widest >= 0) top.widest = Math.max(top.widest, before(t));
      if (t.kind === Kind.NullKeyword) top.hasNull = true;
      if (prefix) top.comment = Math.max(top.comment, prefix.end - prefix.start);
      if (t === lineNumber) lineArray = top;
      else if (lineArray === top && lineNumber !== undefined) {
        top.rows.push(lineNumber);
        lineNumber = undefined;
      }
    }
    prefix = undefined;
    if (t.kind === Kind.OpenBrace) stack.push(undefined);
    else if (t.kind === Kind.OpenBracket) {
      const array: NumberArray = { widest: 0, hasNull: false, comment: 0, rows: [] };
      arrays.push(array);
      stack.push(array);
    }
  }
  const pad = new Map<Token, number>();
  for (const a of arrays) {
    if (a.widest < 0) continue;
    const widest = a.hasNull ? Math.max(a.widest, 4) : a.widest;
    const comment = a.comment > 0 ? a.comment + 1 : 0;
    for (const t of a.rows) pad.set(t, comment + widest - before(t));
  }
  return pad;
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
