// Conversion between JSON, JSONC and JSON5 (spec 006, 006 T2). One pass over the source format's
// token stream (`tokenize` for JSON and JSONC, `parseJson5(...).tokens` for JSON5): each token is
// copied, or replaced by the rule of spec 006 §Conversion rules that names it (C1–C6), and each
// comment or value the target cannot hold is recorded as a loss. Layout and comments are kept
// (UNK-033); `NaN` and `Infinity` become `null` (UNK-034). The readings of tests/golden/README.md
// §Conversion corpus settle the details C1–C7 leave open.
//
// JSON Lines (spec 012 J1, J2; 012 T3): from JSON Lines, the items' value bytes go into an array
// (J1); to JSON Lines, the source is converted to JSON as above and each item of its root array is
// written on its own line, compact (J2).
import { getAdapter } from './adapters.js';
import { jsonlAdapter } from './jsonl-adapter.js';
import { parseJson5 } from './json5-parser.js';
import { isComment, Kind, tokenize, type Token } from './tokens.js';
import type { Diagnostic, Format, FormatNode, Style, WriteOptions } from './types.js';

export interface ConversionLoss {
  kind: 'comment' | 'value';
  /** UTF-16 offset of the lost token in the input. */
  offset: number;
  length: number;
  /** JSON Pointer of a value loss. */
  path?: string;
}

export interface ConvertResult {
  text: string;
  /** Every comment (to JSON) and non-finite number (to JSON or JSONC) not carried over, in input
   *  order. */
  losses: ConversionLoss[];
}

/** Thrown when the source does not parse in its format (spec 006 criterion 7). */
export class ConvertError extends Error {
  override name = 'ConvertError';
  constructor(readonly diagnostic: Diagnostic) {
    super(diagnostic.message);
  }
}

/** Pairs whose target holds everything the source can (criterion 3). */
const SUPERSETS: Record<Format, readonly Format[]> = {
  json: ['jsonc', 'json5'],
  jsonc: ['json5'],
  json5: [],
  jsonl: [],
};

/** An RFC 8259 string literal (C1's test), matched in place at a token's offset. */
const JSON_STRING = /"(?:[^"\\\u0000-\u001F]+|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y; // eslint-disable-line no-control-regex
/** An RFC 8259 number, matched in place. */
const JSON_NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/**
 * `text` in format `to`. Throws a `ConvertError` when `text` has an error in format `from`. For a
 * superset pair (and for `from === to`) the text comes back unchanged with no losses.
 * `options.indent` is J1's indent unit (spec 019 I1); the other conversions keep the text's layout.
 */
export function convert(
  text: string,
  from: Format,
  to: Format,
  options: WriteOptions = {},
): ConvertResult {
  if (from === 'jsonl') {
    const items = readLines(text);
    return { text: to === 'jsonl' ? text : arrayOf(text, items, options.indent ?? 2), losses: [] };
  }
  const source = read(text, from);
  if (to === 'jsonl') return lines(text, source, from === 'json');
  if (from === to || SUPERSETS[from].includes(to)) return { text, losses: [] };
  return new Converter(text, source, to === 'json').run();
}

interface Source {
  tokens: Token[];
  tree: FormatNode | undefined;
  /** JSON5 tokens may need C1–C4; JSON and JSONC tokens are already valid JSON tokens. */
  json5: boolean;
  /** Whether the root value is an array (J2). */
  array: boolean;
}

function read(text: string, format: Format): Source {
  if (format === 'json5') {
    const { tokens, tree, data, error } = parseJson5(text);
    if (error) throw new ConvertError(error);
    return { tokens, tree, json5: true, array: Array.isArray(data) };
  }
  const { data, diagnostics } = getAdapter(format).parse(text);
  const error = diagnostics.find((d) => d.severity === 'error');
  if (error) throw new ConvertError(error);
  return { tokens: tokenize(text), tree: undefined, json5: false, array: Array.isArray(data) };
}

const BOM = '\uFEFF';

/** A JSON Lines text's item nodes; a bad line is the error (spec 012 criterion 9, 006 criterion 7). */
function readLines(text: string): readonly FormatNode[] {
  const { tree, diagnostics } = jsonlAdapter.parse(text);
  const error = diagnostics.find((d) => d.severity === 'error');
  if (error) throw new ConvertError(error);
  return tree!.children ?? [];
}

/** J1: `[` + eol + each item's value bytes indented by one `indent` unit (two spaces by default;
 *  spec 019 I1's fallback indent when the caller gives one), joined by `,` + eol, then eol + `]` +
 *  eol; `[]` + eol with no item. A leading BOM is kept. */
function arrayOf(text: string, items: readonly FormatNode[], indent: Style['indent']): string {
  const { eol } = jsonlAdapter.parse(text).style;
  const bom = text.startsWith(BOM) ? BOM : '';
  if (items.length === 0) return `${bom}[]${eol}`;
  const unit = indent === '\t' ? '\t' : ' '.repeat(indent);
  const values = items.map((n) => `${unit}${text.slice(n.offset, n.offset + n.length)}`);
  return `${bom}[${eol}${values.join(`,${eol}`)}${eol}]${eol}`;
}

/**
 * J2: the source converted to JSON (C1–C7, whose losses are this conversion's), then each item of
 * its root array on its own line, every token kept and no white space between tokens (002 R12),
 * each line ended by the source's first line ending (`\n` when it has none; README JSON Lines
 * conversion reading 1). An empty array gives an empty text.
 */
function lines(text: string, source: Source, json: boolean): ConvertResult {
  if (!source.array)
    throw new ConvertError({
      severity: 'error',
      message: 'JSON Lines needs an array at the root.',
      offset: 0,
      length: text.length,
    });
  const converted = json ? { text, losses: [] } : new Converter(text, source, true).run();
  const tokens = json ? source.tokens : tokenize(converted.text);
  const eol = /\r?\n/.exec(text)?.[0] ?? '\n';
  let out = '';
  let item = '';
  let depth = 0;
  for (const t of tokens) {
    if (t.kind === Kind.Whitespace || t.kind === Kind.LineBreak) continue;
    const opens = t.kind === Kind.OpenBracket || t.kind === Kind.OpenBrace;
    const closes = t.kind === Kind.CloseBracket || t.kind === Kind.CloseBrace;
    if (closes) depth--;
    if (depth === 1 && t.kind === Kind.Comma) {
      out += item + eol;
      item = '';
    } else if (depth >= 1) {
      item += converted.text.slice(t.offset, t.end);
    }
    if (opens) depth++;
  }
  if (item !== '') out += item + eol;
  return { text: out, losses: converted.losses };
}

/**
 * One pass over the tokens. Unchanged text is copied in spans between the tokens a rule rewrites
 * (`emit`), so a large document costs about one slice per changed token rather than one per token.
 * To JSON, C5 needs each line's output to be droppable: the first change on a line starts a new
 * chunk of `out` there (`lineMark`), and a line left blank is cut back to it.
 */
class Converter {
  private readonly text: string;
  private readonly tokens: readonly Token[];
  private readonly tree: FormatNode | undefined;
  private readonly json5: boolean;
  private readonly losses: ConversionLoss[] = [];
  private readonly out: string[] = [];
  /** Source offset up to which the text is in `out`. */
  private copied = 0;
  /** Source offset where the current line starts. */
  private lineStart = 0;
  /** Index in `out` where the current line's output starts, once something on it changed. */
  private lineMark = -1;
  /** The current line keeps a token other than white space (C5). */
  private hasContent = false;
  /** The current line lost a comment (C5). */
  private lostComment = false;
  /** End offset of the last white-space token rewritten by C6, the last chunk of `out`. */
  private rewrittenSpace = -1;
  private eol: string | undefined;
  private paths: Map<number, string> | undefined;

  constructor(
    text: string,
    source: Source,
    private readonly toJson: boolean,
  ) {
    this.text = text;
    this.tokens = source.tokens;
    this.tree = source.tree;
    this.json5 = source.json5;
  }

  run(): ConvertResult {
    const { text, tokens, json5, toJson } = this;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      switch (t.kind) {
        case Kind.LineBreak: {
          if (toJson) this.endLine(t);
          const c = text.charCodeAt(t.offset);
          // C6: U+2028 and U+2029 outside a string become the document's line ending.
          if ((c === 0x2028 || c === 0x2029) && this.copied <= t.offset)
            this.emit(t, (this.eol ??= lineEnding(text, tokens)));
          if (toJson) this.startLine(t.end);
          break;
        }
        case Kind.Whitespace:
          // C6: each JSON5-only white-space character becomes one space.
          if (json5 && !spacesAndTabs(text, t)) {
            this.emit(t, text.slice(t.offset, t.end).replace(/[^ \t]/g, ' '));
            this.rewrittenSpace = t.end;
          }
          break;
        case Kind.LineComment:
        case Kind.BlockComment:
          if (toJson) this.dropComment(t, tokens[i - 1]);
          else this.hasContent = true;
          break;
        case Kind.Comma:
          // C6: a trailing comma is removed for JSON, with no loss.
          if (toJson && closesNext(tokens, i)) this.emit(t, '');
          else this.hasContent = true;
          break;
        case Kind.StringLiteral:
          // C1, and C2 for a quoted key: a string that is not valid JSON is rewritten whole.
          this.hasContent = true;
          if (json5 && !matches(JSON_STRING, text, t))
            this.emit(t, JSON.stringify(parseJson5(text.slice(t.offset, t.end)).data));
          break;
        case Kind.Unknown:
          // C2: an unquoted key (only JSON5 emits `Unknown` without an error).
          this.hasContent = true;
          this.emit(t, JSON.stringify(identifierName(text.slice(t.offset, t.end))));
          break;
        case Kind.NumericLiteral:
          this.hasContent = true;
          if (json5 && !matches(JSON_NUMBER, text, t)) this.emit(t, this.number(t));
          break;
        default:
          this.hasContent = true;
      }
    }
    if (toJson) this.endLine(undefined);
    if (this.copied < text.length) this.out.push(text.slice(this.copied));
    return { text: this.out.join(''), losses: this.losses };
  }

  /** Writes `replacement` for the token `t`, after the unchanged text before it. */
  private emit(t: Token, replacement: string): void {
    this.markLine();
    if (this.copied < t.offset) this.out.push(this.text.slice(this.copied, t.offset));
    if (replacement !== '') this.out.push(replacement);
    this.copied = t.end;
  }

  /** Makes the current line's output start a chunk of `out`, the first time the line changes. */
  private markLine(): void {
    if (!this.toJson || this.lineMark >= 0) return;
    if (this.copied < this.lineStart) {
      this.out.push(this.text.slice(this.copied, this.lineStart));
      this.copied = this.lineStart;
    }
    this.lineMark = this.out.length;
  }

  private startLine(offset: number): void {
    this.lineStart = offset;
    this.lineMark = -1;
    this.hasContent = false;
    this.lostComment = false;
  }

  /** C5: the comment goes, with the white space right before it on its line (one token: the
   *  tokenizers merge a run of white space). */
  private dropComment(t: Token, before: Token | undefined): void {
    this.losses.push({ kind: 'comment', offset: t.offset, length: t.end - t.offset });
    this.lostComment = true;
    if (before?.kind === Kind.Whitespace) {
      this.markLine();
      if (this.rewrittenSpace === before.end && this.copied === before.end) this.out.pop();
      else if (this.copied < before.offset)
        this.out.push(this.text.slice(this.copied, before.offset));
    } else {
      this.markLine();
      if (this.copied < t.offset) this.out.push(this.text.slice(this.copied, t.offset));
    }
    this.copied = t.end;
  }

  /**
   * C5 at the end of a line (`lineBreak`) or of the text (undefined): a line that only white space
   * is left on once its comments are gone is removed with its line ending; a last line with no line
   * ending loses its content only (README reading 3).
   */
  private endLine(lineBreak: Token | undefined): void {
    if (!this.lostComment || this.hasContent) return;
    this.out.length = this.lineMark;
    this.copied = lineBreak ? lineBreak.end : this.text.length;
  }

  /** C3 and C4 for a number token that is not a JSON number. */
  private number(t: Token): string {
    const src = this.text.slice(t.offset, t.end);
    const negative = src[0] === '-';
    const body = src[0] === '-' || src[0] === '+' ? src.slice(1) : src;
    if (body === 'Infinity' || body === 'NaN') {
      // C4: no JSON or JSONC form; written as `null` (UNK-034).
      this.losses.push({
        kind: 'value',
        offset: t.offset,
        length: t.end - t.offset,
        path: this.pathAt(t.offset),
      });
      return 'null';
    }
    const sign = negative ? '-' : '';
    // C3: hexadecimal to its exact decimal digits, by `BigInt` rather than through a float.
    if (/^0[xX]/.test(body)) return sign + BigInt(body).toString();
    // C3: `.5` → `0.5`; `5.` → `5`, `5.e3` → `5e3`; a leading `+` is dropped.
    return sign + (body[0] === '.' ? '0' : '') + body.replace(/\.(?=[eE]|$)/, '');
  }

  /** The JSON Pointer of the value at `offset`; the tree is walked once, on the first value loss. */
  private pathAt(offset: number): string {
    if (!this.paths) {
      this.paths = new Map();
      if (this.tree) collectNonFinite(this.tree, '', this.paths);
    }
    return this.paths.get(offset) ?? '';
  }
}

/** Whether `re` (sticky) matches the whole token `t`. */
function matches(re: RegExp, text: string, t: Token): boolean {
  re.lastIndex = t.offset;
  return re.test(text) && re.lastIndex === t.end;
}

function spacesAndTabs(text: string, t: Token): boolean {
  for (let i = t.offset; i < t.end; i++) {
    const c = text.charCodeAt(i);
    if (c !== 0x20 && c !== 0x09) return false;
  }
  return true;
}

/** Pointers of the non-finite numbers under `node`, by offset. */
function collectNonFinite(node: FormatNode, pointer: string, into: Map<number, string>): void {
  if (node.type === 'number') {
    if (!Number.isFinite(node.value)) into.set(node.offset, pointer);
    return;
  }
  const children = node.children ?? [];
  if (node.type === 'object') {
    for (const property of children) {
      const [key, value] = property.children!;
      const token = String(key!.value).replace(/~/g, '~0').replace(/\//g, '~1');
      collectNonFinite(value!, `${pointer}/${token}`, into);
    }
  } else if (node.type === 'array') {
    children.forEach((item, i) => collectNonFinite(item, `${pointer}/${i}`, into));
  }
}

/** Whether the next token after `i` that is not white space, a line break or a comment closes a
 *  container, which makes the comma at `i` a trailing comma. */
function closesNext(tokens: readonly Token[], i: number): boolean {
  for (let j = i + 1; j < tokens.length; j++) {
    const t = tokens[j]!;
    if (t.kind === Kind.Whitespace || t.kind === Kind.LineBreak || isComment(t)) continue;
    return t.kind === Kind.CloseBrace || t.kind === Kind.CloseBracket;
  }
  return false;
}

/** A JSON5 identifier's name, with its `\uXXXX` escapes decoded. */
function identifierName(src: string): string {
  return src.includes('\\') ? (parseJson5(`"${src}"`).data as string) : src;
}

/** The document's line ending for C6: the more frequent of `\r\n` and `\n`, `\n` when tied or
 *  when there is none (as `Style.eol`, `style.ts`). */
function lineEnding(text: string, tokens: readonly Token[]): string {
  let crlf = 0;
  let lf = 0;
  for (const t of tokens) {
    if (t.kind !== Kind.LineBreak) continue;
    if (t.end - t.offset === 2) crlf++;
    else if (text[t.offset] === '\n') lf++;
  }
  return crlf > lf ? '\r\n' : '\n';
}
