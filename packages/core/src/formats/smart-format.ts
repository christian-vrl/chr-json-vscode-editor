// Smart format (spec 010, 010 T2): FracturedJson 5.1.0's layout with spec 010 §Layout's options,
// keeping every key, value and comment as written, in the same order. FracturedJson reads JSON with
// comments, so passes around it carry what it would lose or misread (plan 010 §Approach):
// - L7: each JSON5-only token goes through it as a JSON string that stands in for it, measured at
//   the token's own width, and comes back byte for byte afterwards. Comments it would change go
//   through as stand-ins too: a line comment holding `*/` (FracturedJson ends it there) or ending
//   in white space (it trims that), and a block comment's empty lines (it drops them);
// - L5 (UNK-045): a table or an aligned compact array never writes a row in another key order;
// - L6 (UNK-046): FracturedJson drops trailing commas; one comes back after the last member of each
//   container that had one and whose closing bracket is on its own line;
// - criterion 6: a compact array with an item wider than its line is written expanded instead.
// The rest (L1, L2: indent, line endings, final newline, BOM) comes from the document's `Style`.
import { CommentPolicy, EolStyle, Formatter, FracturedJsonOptions } from 'fracturedjsonjs';
import type { JsonItem } from 'fracturedjsonjs/dist/JsonItem.js';
import { JsonItemType as ItemType } from 'fracturedjsonjs/dist/JsonItemType.js';
import { TableColumnType as ColumnType } from 'fracturedjsonjs/dist/TableColumnType.js';
import { TableTemplate } from 'fracturedjsonjs/dist/TableTemplate.js';
import { parseTree, type ParseError } from 'jsonc-parser';
import { getAdapter } from './adapters.js';
import { json5Tokens } from './json5-adapter.js';
import { parsedTokens } from './jsonc-adapter.js';
import { parseJson5 } from './json5-parser.js';
import { isComment, Kind, type Token } from './tokens.js';
import { PatchError, type Format } from './types.js';

/**
 * `text` laid out by FracturedJson 5.1.0 with spec 010 §Layout's options, changing only white space,
 * line breaks and commas (criterion 3). Throws a `PatchError` when the text has a parse `error`
 * diagnostic (criterion 9); a text with no value (empty, white space or comments only) comes back
 * unchanged (criterion 5).
 */
/** The formats smart format lays out (spec 010 §Scope): not JSON Lines. */
export type SmartFormatFormat = Exclude<Format, 'jsonl'>;

export function smartFormat(text: string, format: SmartFormatFormat): string {
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  const body = text.slice(bom.length);
  const adapter = getAdapter(format);
  // One parse (cached, so the host's earlier parse of the same text is reused) gives the
  // diagnostics, the style and the tokens.
  const parsed = adapter.parse(body);
  if (parsed.tree === undefined && hasNoValue(body, format)) return text;
  const error = parsed.diagnostics.find((d) => d.severity === 'error');
  if (error || parsed.tree === undefined)
    throw new PatchError(
      `cannot smart-format a document that does not parse: ${error?.message ?? 'no value'}`,
    );
  const tokens = format === 'json5' ? json5Tokens(body) : parsedTokens.get(format)!(body);
  const style = parsed.style;

  const bridged = bridge(body, tokens, format);
  const formatter = new Formatter();
  formatter.Options = options(style.indent, style.eol);
  const { widths, marker } = bridged;
  const width = (s: string) =>
    widths.get(s) ?? columns(s.includes(marker) ? bridged.restore(s) : s);
  // A multi-line comment is measured without the indent of its later lines, which FracturedJson
  // rewrites: a table run it sits in must not depend on how deep it was indented (criterion 4).
  formatter.StringLengthFunc = (s) =>
    s.includes('\n') ? width(s.replace(/\n[ \t]*/g, '\n')) : width(s);
  // L6: the containers that get their trailing comma back when written over several lines.
  const had = format !== 'json' && style.trailingCommas ? trailingCommas(tokens) : undefined;
  keepKeyOrder(formatter);
  keepLineLength(formatter, had, (line) => columns(bridged.changed ? bridged.restore(line) : line));

  let out = formatter.Reformat(bridged.source);
  if (had) out = addTrailingCommas(had, out);
  if (bridged.changed) out = bridged.restore(out);
  // FracturedJson always ends with a line ending (L2: only when the input did).
  if (!style.finalNewline) out = out.slice(0, out.endsWith('\r\n') ? -2 : -1);
  return bom + out;
}

/** Whether a text with no parse tree is only white space and complete comments: a value on a line
 *  after it parses. */
function hasNoValue(text: string, format: SmartFormatFormat): boolean {
  const withValue = `${text}\nnull`;
  if (format === 'json5') {
    const result = parseJson5(withValue);
    return result.error === undefined && result.data === null;
  }
  const errors: ParseError[] = [];
  const tree = parseTree(withValue, errors, { allowTrailingComma: true });
  return tree?.type === 'null' && errors.length === 0;
}

/** §Layout: `Recommended()` with comments and blank lines kept, trailing commas read, and the
 *  document's indent unit and line ending (L1–L4). */
function options(indent: '\t' | number, eol: '\n' | '\r\n'): FracturedJsonOptions {
  const o = FracturedJsonOptions.Recommended();
  o.CommentPolicy = CommentPolicy.Preserve;
  o.PreserveBlankLines = true;
  o.AllowTrailingCommas = true;
  o.JsonEolStyle = eol === '\r\n' ? EolStyle.Crlf : EolStyle.Lf;
  // A tab indent still counts FracturedJson's default 4 columns per level for line length.
  if (indent === '\t') o.UseTabToIndent = true;
  else o.IndentSpaces = indent;
  return o;
}

// ---- L7: the bridge.

/** The columns `s` takes, a tab counted as 4 like an indent (criterion 6). */
function columns(s: string): number {
  if (!s.includes('\t')) return s.length;
  let tabs = 0;
  for (let i = s.indexOf('\t'); i >= 0; i = s.indexOf('\t', i + 1)) tabs++;
  return s.length + 3 * tabs;
}

const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
/** Characters JSON allows in a string that FracturedJson rejects as control characters. */
const CONTROL = /[\u007F-\u009F]/;

interface Bridged {
  /** The text FracturedJson reads. */
  source: string;
  /** Whether it differs from the document (stand-ins, fillers or rewritten white space). */
  changed: boolean;
  /** The written tokens the stand-ins stand for. */
  originals: string[];
  /** The private-use character that starts each stand-in. */
  marker: string;
  /** Each stand-in's written width: its token's length in UTF-16 code units. */
  widths: Map<string, number>;
  /** A text with each stand-in replaced by its token and each empty-line filler removed. */
  restore(text: string): string;
}

/**
 * The text FracturedJson reads. A stand-in is `"<m>n<m+1>"` (a JSON string) for each token a JSON
 * reader lacks (an unquoted key, a single-quoted string or one with an escape or line continuation
 * JSON lacks, a hex, signed, dotted, `Infinity` or `NaN` number) or a string holding U+007F–U+009F
 * (FracturedJson rejects them), and `//<m>n<m+1>` for each line
 * comment FracturedJson would misread or trim; the same one for the same bytes, so equal keys still
 * line up as one column. A block comment's lines are joined by `\n`, an empty one holding the filler
 * `<m+2>`. White space other than spaces and tabs becomes spaces and every other line terminator
 * than `\n` and `\r\n` a `\n` (FracturedJson writes its own layout and line ends anyway). `m` is a private-use character the text does
 * not hold, nor the next two, so nothing in the document can look like a stand-in.
 */
function bridge(text: string, tokens: readonly Token[], format: SmartFormatFormat): Bridged {
  let code = 0xe000;
  while ([0, 1, 2].some((k) => text.includes(String.fromCharCode(code + k)))) code += 3;
  const [marker, close, filler] = [0, 1, 2].map((k) => String.fromCharCode(code + k)) as [
    string,
    string,
    string,
  ];
  const originals: string[] = [];
  const index = new Map<string, number>();
  const widths = new Map<string, number>();
  const standIn = (s: string, quoted: boolean) => {
    let n = index.get(s);
    if (n === undefined) {
      index.set(s, (n = originals.push(s) - 1));
      widths.set(quoted ? `"${marker}${n}${close}"` : `//${marker}${n}${close}`, columns(s));
    }
    return `${marker}${n}${close}`;
  };
  // The text is copied in runs between the tokens that change.
  const parts: string[] = [];
  const control = CONTROL.test(text);
  let from = 0;
  const replace = (t: Token, by: string) => {
    parts.push(text.slice(from, t.offset), by);
    from = t.end;
  };
  for (const t of tokens) {
    switch (t.kind) {
      case Kind.Whitespace: {
        const s = text.slice(t.offset, t.end);
        if (!/^[ \t]*$/.test(s)) replace(t, s.replace(/[^\t]/g, ' '));
        break;
      }
      case Kind.LineBreak: {
        const s = text.slice(t.offset, t.end);
        if (s !== '\n' && s !== '\r\n') replace(t, '\n');
        break;
      }
      case Kind.LineComment: {
        const s = text.slice(t.offset, t.end);
        if (s.includes('*/') || /\s$/.test(s)) replace(t, `//${standIn(s, false)}`);
        break;
      }
      case Kind.BlockComment: {
        const s = text.slice(t.offset, t.end);
        // FracturedJson drops every `\r`, splits on `\n` only and drops the empty lines.
        const filled = s
          .split(/\r\n|\r|\n|\u2028|\u2029/)
          .map((line) => line || filler)
          .join('\n');
        if (filled !== s) replace(t, filled);
        break;
      }
      case Kind.Unknown:
      case Kind.StringLiteral:
      case Kind.NumericLiteral: {
        const string = t.kind === Kind.StringLiteral;
        if (format !== 'json5' && !(control && string)) break;
        const s = text.slice(t.offset, t.end);
        if ((format === 'json5' && json5Only(t, s)) || (control && string && CONTROL.test(s)))
          replace(t, `"${standIn(s, true)}"`);
        break;
      }
    }
  }
  const changed = parts.length > 0;
  const source = changed ? parts.join('') + text.slice(from) : text;
  const standIns = new RegExp(`"${marker}(\\d+)${close}"|//${marker}(\\d+)${close}`, 'g');
  const fillers = new RegExp(`[ \\t]*${filler}`, 'g');
  return {
    source,
    changed,
    originals,
    marker,
    widths,
    restore: (s) =>
      s
        .replace(standIns, (_, a?: string, b?: string) => originals[+(a ?? b)!]!)
        .replace(fillers, ''),
  };
}

function json5Only(t: Token, s: string): boolean {
  if (t.kind === Kind.Unknown) return true;
  if (t.kind === Kind.NumericLiteral) return !JSON_NUMBER.test(s);
  if (t.kind !== Kind.StringLiteral) return false;
  if (s[0] !== '"') return true;
  try {
    JSON.parse(s);
    return false;
  } catch {
    return true;
  }
}

// ---- L5 (UNK-045): key order.

/** FracturedJson's internals the key-order override reads or replaces (`dist/Formatter.d.ts`,
 *  private members, pinned at exactly 5.1.0; `dist/Formatter.js` `DivideContainerIntoSegments`
 *  and `FormatContainerCompactMultiline`). */
interface Run {
  startIndex: number;
  length: number;
  canBeTable: boolean;
}
interface FormatterInternals {
  _pads: ConstructorParameters<typeof TableTemplate>[0];
  _buffer: { _docBuff: string[]; _lineBuff: string[] };
  _currentLineLen: number;
  Options: FracturedJsonOptions;
  FormatTopLevel(docModel: JsonItem[], startingDepth: number, buffer: unknown): void;
  DivideContainerIntoSegments(item: JsonItem, depth: number): Run[];
  AvailableLineSpace(depth: number): number;
  InlineElementLength(
    item: JsonItem,
    includeTrailingComma: boolean,
    parentTemplate: TableTemplate | null,
  ): number;
  FormatContainerInline(
    item: JsonItem,
    depth: number,
    includeTrailingComma: boolean,
    parentTemplate: TableTemplate | null,
  ): boolean;
  FormatContainerCompactMultiline(
    item: JsonItem,
    depth: number,
    includeTrailingComma: boolean,
    template: TableTemplate,
    parentTemplate: TableTemplate | null,
  ): boolean;
}

const isElement = (item: JsonItem) =>
  item.Type !== ItemType.BlankLine &&
  item.Type !== ItemType.LineComment &&
  item.Type !== ItemType.BlockComment;

/** `TableTemplate`'s private members the override calls (`dist/TableTemplate.d.ts`). */
interface TemplateInternals {
  MeasureRowSegment(row: JsonItem, recursive: boolean): void;
}

function startTemplate(f: FormatterInternals, row: JsonItem): TableTemplate {
  const t = new TableTemplate(f._pads, f.Options.NumberListAlignment);
  (t as unknown as TemplateInternals).MeasureRowSegment(row, true);
  return t;
}

/** Whether `template` would write `item` (or an object nested in it) with its keys in another
 *  order: a template lists an object's columns in first-seen order and writes every row so. A
 *  template is read as `PruneAndRecompute` leaves it: with no columns unless it is an object or
 *  array template measured over two rows or more (`dist/TableTemplate.js`). */
function reorders(template: TableTemplate | undefined, item: JsonItem): boolean {
  if (!template || template.Children.length === 0 || template.RowCount < 2) return false;
  const kids = item.Children.filter(isElement);
  const type = template.Type;
  if (item.Type === ItemType.Object && type === ColumnType.Object) {
    let last = -1;
    for (const kid of kids) {
      const i = template.Children.findIndex((c) => c.LocationInParent === kid.Name);
      if (i < 0) continue;
      if (i < last) return true;
      last = i;
      if (reorders(template.Children[i], kid)) return true;
    }
  } else if (item.Type === ItemType.Array && type === ColumnType.Array) {
    return kids.some((kid, i) => reorders(template.Children[i], kid));
  }
  return false;
}

/**
 * Overrides two of this formatter's methods (on the instance, so no other formatter changes):
 * - a run of rows FracturedJson would write as one table is taken row by row, and a row that the
 *   table's columns, measured over the rows so far and that row, would reorder starts a new table
 *   (README reading 1);
 * - a compact array whose column template would reorder an item is still written compact, but
 *   with no column alignment (README reading 2).
 */
function keepKeyOrder(formatter: Formatter): void {
  const f = formatter as unknown as FormatterInternals;
  const divide = f.DivideContainerIntoSegments.bind(f);
  f.DivideContainerIntoSegments = (item, depth) => {
    const out: Run[] = [];
    for (const run of divide(item, depth)) {
      if (!run.canBeTable) {
        out.push(run);
        continue;
      }
      const end = run.startIndex + run.length;
      let start = run.startIndex;
      // The template of rows `start` to `i`, measured one row at a time as `MeasureTableRoot` does
      // (`dist/TableTemplate.js`); `reorders` reads it as pruned. A row only adds columns after
      // the ones seen, so the rows before it keep their order: only the new row needs checking.
      let measured = startTemplate(f, item.Children[start]!);
      for (let i = start + 1; i < end; i++) {
        const row = item.Children[i]!;
        (measured as unknown as TemplateInternals).MeasureRowSegment(row, true);
        if (reorders(measured, row)) {
          out.push({ startIndex: start, length: i - start, canBeTable: true });
          start = i;
          measured = startTemplate(f, row);
        }
      }
      out.push({ startIndex: start, length: end - start, canBeTable: true });
    }
    return out;
  };
  const compact = f.FormatContainerCompactMultiline.bind(f);
  f.FormatContainerCompactMultiline = (item, depth, comma, template, parent) => {
    const type = template.Type;
    const aligned = type !== ColumnType.Unknown && type !== ColumnType.Mixed;
    if (!aligned || !item.Children.some((c) => reorders(template, c)))
      return compact(item, depth, comma, template, parent);
    template.Type = ColumnType.Mixed;
    try {
      return compact(item, depth, comma, template, parent);
    } finally {
      template.Type = type;
    }
  };
}

// ---- Criterion 6: line length.

/**
 * FracturedJson writes a compact array's item on a row of its own when it does not fit after the
 * others, even when it is wider than a whole row, so the row runs past 120 columns with several
 * values on it. Such an array is written expanded instead (README reading 8): each item on its
 * own line, where a container too wide to be inline is laid out over several lines.
 *
 * An inline container whose siblings line up their values measures itself with its own middle
 * comment (`"a": /* c *\/ [`), not the column the value is padded to, and can run past 120 columns
 * the same way: it is then written over several lines.
 *
 * A trailing comma put back (`had`, L6) is measured too: an inline container that ends a container
 * written over several lines counts it, and a compact array's last row that it would push past 120
 * columns ends one item earlier (or the array is laid out another way). `lineWidth` measures a
 * written line in the document's own tokens.
 */
function keepLineLength(
  formatter: Formatter,
  had: readonly boolean[] | undefined,
  lineWidth: (line: string) => number,
): void {
  const f = formatter as unknown as FormatterInternals;
  /** Containers that get a trailing comma back, and their last element. */
  const trailing = new WeakSet<JsonItem>();
  const lastOfTrailing = new WeakSet<JsonItem>();
  if (had?.includes(true)) {
    const top = f.FormatTopLevel.bind(f);
    f.FormatTopLevel = (docModel, depth, buffer) => {
      // Containers in the order of their opening brackets, as `had` lists them.
      let n = 0;
      const visit = (item: JsonItem) => {
        if (item.Type !== ItemType.Array && item.Type !== ItemType.Object) return;
        if (had[n++]) {
          trailing.add(item);
          for (let i = item.Children.length - 1; i >= 0; i--)
            if (isElement(item.Children[i]!)) {
              lastOfTrailing.add(item.Children[i]!);
              break;
            }
        }
        item.Children.forEach(visit);
      };
      docModel.forEach(visit);
      top(docModel, depth, buffer);
    };
  }

  const inline = f.FormatContainerInline.bind(f);
  f.FormatContainerInline = (item, depth, comma, parent) => {
    const pads = f._pads;
    const comment = (length: number) => (length > 0 ? length + pads.CommentLen : 0);
    const reserve = !comma && lastOfTrailing.has(item);
    if (reserve || (parent && parent.MiddleCommentLength > item.MiddleCommentLength)) {
      const named = parent ?? item;
      const length =
        comment(named.PrefixCommentLength) +
        (named.NameLength > 0 ? named.NameLength + pads.ColonLen : 0) +
        comment(Math.max(parent?.MiddleCommentLength ?? 0, item.MiddleCommentLength)) +
        item.ValueLength +
        comment(item.PostfixCommentLength) +
        (comma || reserve ? pads.CommaLen : 0);
      if (length > f.AvailableLineSpace(depth)) return false;
    }
    return inline(item, depth, comma, parent);
  };

  const compact = f.FormatContainerCompactMultiline.bind(f);
  /** Whether the last row written, the one before the closing bracket's, has room for a comma. */
  const lastRowFits = () => {
    const rows = f._buffer._docBuff;
    const row = rows[rows.length - 1]!.replace(/\r?\n$/, '');
    return lineWidth(row) + f._pads.CommaLen <= f.Options.MaxTotalLineLength;
  };
  f.FormatContainerCompactMultiline = (item, depth, comma, template, parent) => {
    const space = f.AvailableLineSpace(depth + 1);
    const last = item.Children.length - 1;
    if (item.Children.some((c, i) => f.InlineElementLength(c, i < last, null) > space))
      return false;
    if (!trailing.has(item)) return compact(item, depth, comma, template, parent);
    const buffer = f._buffer;
    const [rows, line, lineLength] = [
      buffer._docBuff.length,
      buffer._lineBuff.slice(),
      f._currentLineLen,
    ];
    const undo = () => {
      buffer._docBuff.length = rows;
      buffer._lineBuff = line.slice();
      f._currentLineLen = lineLength;
    };
    if (!compact(item, depth, comma, template, parent)) return false;
    if (lastRowFits()) return true;
    undo();
    // Again with the last item measured with its comma (a table-formatted array measures every
    // item at the column width, so it may still not fit).
    const lastItem = item.Children[last]!;
    lastItem.MinimumTotalLength += f._pads.CommaLen;
    try {
      if (compact(item, depth, comma, template, parent) && lastRowFits()) return true;
    } finally {
      lastItem.MinimumTotalLength -= f._pads.CommaLen;
    }
    undo();
    return false;
  };
}

// ---- L6 (UNK-046): trailing commas.

/** Per container of the document, in order of its opening bracket: whether it ends with a comma
 *  (comments between them allowed). */
function trailingCommas(tokens: readonly Token[]): boolean[] {
  const found: boolean[] = [];
  const open: number[] = [];
  let last: Token | undefined;
  for (const t of tokens) {
    if (t.kind === Kind.Whitespace || t.kind === Kind.LineBreak || isComment(t)) continue;
    if (t.kind === Kind.OpenBrace || t.kind === Kind.OpenBracket) {
      open.push(found.length);
      found.push(false);
    } else if (t.kind === Kind.CloseBrace || t.kind === Kind.CloseBracket) {
      found[open.pop()!] = last?.kind === Kind.Comma;
    }
    last = t;
  }
  return found;
}

/**
 * `output` (FracturedJson's, before stand-ins are restored: JSON with comments, every string
 * double-quoted on one line) with a comma after the last member of each container that had a
 * trailing comma in the document (`had`, from `trailingCommas`) and is written over several lines:
 * its closing bracket starts a line (L6, README reading 7). The comma goes right after the value, before any comment
 * (README reading 3). Containers are matched by the order of their opening brackets.
 */
function addTrailingCommas(had: readonly boolean[], output: string): string {
  const at: number[] = [];
  const open: number[] = [];
  let count = 0;
  /** End of the last value or bracket written, and whether it opened a container. */
  let lastEnd = -1;
  let lastOpens = false;
  let lineStart = true;
  for (let i = 0; i < output.length; i++) {
    const c = output[i]!;
    if (c === '\n') lineStart = true;
    else if (c === ' ' || c === '\t' || c === '\r') continue;
    else if (c === '/' && output[i + 1] === '/') {
      i = output.indexOf('\n', i);
      if (i < 0) break;
      lineStart = true;
    } else if (c === '/' && output[i + 1] === '*') {
      i = output.indexOf('*/', i + 2) + 1;
      lineStart = false;
    } else if (c === '"') {
      let j = i + 1;
      while (output[j] !== '"') j += output[j] === '\\' ? 2 : 1;
      i = j;
      lastEnd = j + 1;
      lastOpens = false;
      lineStart = false;
    } else if (c === '{' || c === '[') {
      open.push(count++);
      lastEnd = i + 1;
      lastOpens = true;
      lineStart = false;
    } else if (c === '}' || c === ']') {
      const n = open.pop()!;
      if (had[n] && lineStart && !lastOpens) at.push(lastEnd);
      lastEnd = i + 1;
      lastOpens = false;
      lineStart = false;
    } else if (c === ',' || c === ':') {
      lineStart = false;
    } else {
      // A number or a keyword.
      let j = i;
      while (j < output.length && !' \t\r\n,:]}/'.includes(output[j]!)) j++;
      i = j - 1;
      lastEnd = j;
      lastOpens = false;
      lineStart = false;
    }
  }
  if (count !== had.length) throw new Error('smart format changed the number of containers');
  if (at.length === 0) return output;
  at.sort((a, b) => a - b);
  const parts: string[] = [];
  let from = 0;
  for (const offset of at) {
    parts.push(output.slice(from, offset), ',');
    from = offset;
  }
  return parts.join('') + output.slice(from);
}
