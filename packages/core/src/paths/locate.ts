// Locating (spec 018 §Locating, A1–A6 and R1–R3): the node at an offset of a text, and the offset
// where the node of a path starts. Both walk the text's tokens once from the start and stop as
// soon as they can, keeping only the open objects and arrays with their current name or index:
// no tree, no data and nothing in core's parse cache (spec 018 criteria 4 and 11). `json` and
// `jsonc` tokens come from jsonc-parser's scanner (`createScanner`,
// node_modules/jsonc-parser/lib/esm/main.d.ts:5), `json5` tokens from the JSON5 parser's lexer
// (`Json5Lexer`), and a `jsonl` line is read alone as strict JSON (spec 012 L1).
import { createScanner, type JSONScanner } from 'jsonc-parser';
import { Json5Lexer, type Json5Token } from '../formats/json5-parser.js';
import { Kind } from '../formats/tokens.js';
import type { Format } from '../formats/types.js';
import type { Path, PathStep } from './text.js';

/** Where a text stops reading as its format (A6). `line` and `column` count from 1, as VS Code
 *  shows them: a line ends at `\n`, `\r\n` or `\r`, and a column is a UTF-16 code unit. */
export interface PathError {
  message: string;
  offset: number;
  line: number;
  column: number;
}

export type NodeAtResult = { path: PathStep[] } | { error: PathError };

const BOM = 0xfeff;

/** A token as the walker reads it: `name` is a string's or member name's text. */
type Token = Json5Token;

interface Source {
  /** The next token; `key` says whether a member name may come next (JSON5 reads one then). */
  next(key: boolean): Token;
}

const SCAN_ERRORS = [
  '',
  'unexpected end of comment',
  'unexpected end of string',
  'unexpected end of number',
  'invalid Unicode escape',
  'invalid escape character',
  'invalid character',
];

/** JSON and JSONC tokens; `strict` (a JSON Lines item, RFC 8259) refuses comments and white
 *  space other than spaces and tabs. `base` is added to every offset. */
class ScannerSource implements Source {
  private readonly scanner: JSONScanner;

  constructor(
    private readonly text: string,
    private readonly base: number,
    private readonly strict: boolean,
  ) {
    this.scanner = createScanner(text, false);
  }

  /** The one token `next` returns, its fields replaced on each call (as `Json5Lexer`'s). */
  private readonly current: Token = {
    kind: Kind.EOF,
    offset: 0,
    end: 0,
    name: undefined,
    error: undefined,
  };

  next(): Token {
    const s = this.scanner;
    const t = this.current;
    if (!this.strict) {
      // A run of ASCII white space and line breaks is one token: each part gives the same node
      // (A4), and a document's indentation is most of its tokens otherwise.
      const text = this.text;
      const start = s.getPosition();
      let pos = start;
      let c = text.charCodeAt(pos);
      while (c === 32 || c === 9 || c === 10 || c === 13) c = text.charCodeAt(++pos);
      if (pos > start) {
        s.setPosition(pos);
        t.kind = Kind.Whitespace;
        t.offset = this.base + start;
        t.end = this.base + pos;
        t.name = undefined;
        t.error = undefined;
        return t;
      }
    }
    const kind: number = s.scan();
    const offset = this.base + s.getTokenOffset();
    t.kind = kind;
    t.offset = offset;
    t.end = offset + s.getTokenLength();
    t.name = undefined;
    t.error = undefined;
    const error = (message: string): Token => {
      t.error = { message, offset };
      return t;
    };
    if (kind === Kind.EOF) return t;
    const scanError: number = s.getTokenError();
    if (scanError !== 0) return error(SCAN_ERRORS[scanError]!);
    if (kind === Kind.Unknown) {
      // A leading BOM is outside the root (A5), as JSON5 and JSON Lines read it.
      if (offset === 0 && t.end === 1 && this.text.charCodeAt(0) === BOM) {
        t.kind = Kind.Whitespace;
        return t;
      }
      return error(`unexpected ${JSON.stringify(s.getTokenValue())}`);
    }
    if (this.strict) {
      if (kind === Kind.LineComment || kind === Kind.BlockComment)
        return error('JSON Lines items hold no comments');
      if (kind === Kind.LineBreak || (kind === Kind.Whitespace && /[^ \t]/.test(s.getTokenValue())))
        return error('unexpected white space');
    }
    if (kind === Kind.StringLiteral) t.name = s.getTokenValue();
    return t;
  }
}

const VALUE = 0;
const KEY = 1;
const COLON = 2;
const AFTER = 3;
const END = 4;

/** What a token was to the walker, for the reader of `role`. */
const OTHER = 0;
const MEMBER_NAME = 1;
const START = 2;
const CLOSE = 3;

interface Frame {
  readonly object: boolean;
  /** An array's next index. */
  index: number;
  /** An object's current member name. */
  key: string;
  /** For `placeOf`: whether the path goes through this object or array. */
  onPath: boolean;
}

/**
 * The grammar of `json`, `jsonc` and `json5` documents on their tokens (`json` reads as `jsonc`:
 * its comments and trailing commas are warnings, not errors, in core's `parse`), and of a JSON
 * Lines item with `trailingCommas` false. `steps` is the path of the innermost open object or
 * array.
 */
class Walker {
  readonly steps: PathStep[] = [];
  readonly frames: Frame[] = [];
  private state = VALUE;
  private comma = false;
  /** The last token's role, and for a member name or a value's first token its step and depth. */
  role = OTHER;
  step: PathStep | undefined;
  /** The frame the last `CLOSE` closed. */
  closed: Frame | undefined;

  constructor(private readonly trailingCommas: boolean) {}

  get expectsKey(): boolean {
    return this.state === KEY;
  }

  get done(): boolean {
    return this.state === END;
  }

  /** Reads one token; returns the error when it does not fit, else undefined. With `want`, sets
   *  `path` to the path of the node the token belongs to (A1–A5). */
  feed(t: Token, want: boolean): string | undefined {
    this.role = OTHER;
    if (t.error) return t.error.message;
    const kind = t.kind;
    if (
      kind === Kind.Whitespace ||
      kind === Kind.LineBreak ||
      kind === Kind.LineComment ||
      kind === Kind.BlockComment
    ) {
      if (want) this.path = this.steps.slice();
      return undefined;
    }
    const frame = this.frames.at(-1);
    switch (this.state) {
      case KEY:
        if (kind === Kind.CloseBrace && (!this.comma || this.trailingCommas))
          return this.close(want);
        if (t.name === undefined) return 'expected a member name';
        frame!.key = t.name;
        this.state = COLON;
        this.role = MEMBER_NAME;
        this.step = t.name;
        if (want) this.path = [...this.steps, t.name];
        return undefined;
      case COLON:
        if (kind !== Kind.Colon) return 'expected `:`';
        this.state = VALUE;
        if (want) this.path = [...this.steps, frame!.key];
        return undefined;
      case VALUE: {
        if (
          kind === Kind.CloseBracket &&
          frame !== undefined &&
          !frame.object &&
          (!this.comma || this.trailingCommas)
        )
          return this.close(want);
        const step = frame === undefined ? undefined : frame.object ? frame.key : frame.index;
        this.step = step;
        if (kind === Kind.OpenBrace || kind === Kind.OpenBracket) {
          const object = kind === Kind.OpenBrace;
          if (frame !== undefined) this.steps.push(step!);
          this.frames.push({ object, index: 0, key: '', onPath: false });
          this.state = object ? KEY : VALUE;
          this.comma = false;
          this.role = START;
          if (want) this.path = this.steps.slice();
          return undefined;
        }
        if (
          kind === Kind.StringLiteral ||
          kind === Kind.NumericLiteral ||
          kind === Kind.TrueKeyword ||
          kind === Kind.FalseKeyword ||
          kind === Kind.NullKeyword
        ) {
          this.role = START;
          if (want) this.path = step === undefined ? [] : [...this.steps, step];
          this.valueDone();
          return undefined;
        }
        return 'expected a value';
      }
      case AFTER:
        if (kind === Kind.Comma) {
          this.state = frame!.object ? KEY : VALUE;
          this.comma = true;
          if (want) this.path = this.steps.slice();
          return undefined;
        }
        if (kind === (frame!.object ? Kind.CloseBrace : Kind.CloseBracket)) return this.close(want);
        return frame!.object ? 'expected `,` or `}`' : 'expected `,` or `]`';
      default:
        return 'expected the end of the text';
    }
  }

  /** The path `feed` found, when asked. */
  path: PathStep[] = [];

  private close(want: boolean): undefined {
    if (want) this.path = this.steps.slice();
    this.closed = this.frames.pop();
    if (this.frames.length > 0) this.steps.pop();
    this.role = CLOSE;
    this.valueDone();
    return undefined;
  }

  private valueDone(): void {
    const parent = this.frames.at(-1);
    this.comma = false;
    if (parent === undefined) this.state = END;
    else {
      if (!parent.object) parent.index++;
      this.state = AFTER;
    }
  }
}

/** Line and column of `offset`, both from 1 (`PathError`). */
function lineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let start = 0;
  for (let i = 0; i < offset; i++) {
    const c = text.charCodeAt(i);
    if (c === 10 || (c === 13 && text.charCodeAt(i + 1) !== 10)) {
      line++;
      start = i + 1;
    }
  }
  return { line, column: offset - start + 1 };
}

function pathError(text: string, message: string, offset: number): { error: PathError } {
  return { error: { message, offset, ...lineColumn(text, offset) } };
}

const sourceFor = (format: Format, text: string): Source =>
  format === 'json5' ? new Json5Lexer(text) : new ScannerSource(text, 0, false);

/**
 * The path of the node at `offset` in `text` (A1–A6): of the tokens the offset touches (from just
 * before a token's first character to just after its last), the one that belongs to the innermost
 * node decides. Only the text up to the end of the last token that starts at or before the offset
 * is read; if that text does not read as the format, the result is the first error in it.
 * Offsets count UTF-16 code units, from 0 to `text.length`.
 */
export function nodeAt(format: Format, text: string, offset: number): NodeAtResult {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length)
    throw new RangeError(`offset ${offset} is outside the text (0 to ${text.length})`);
  if (format === 'jsonl') return lineNodeAt(text, offset);
  return walkTo(sourceFor(format, text), new Walker(true), text, offset);
}

function walkTo(source: Source, walker: Walker, text: string, offset: number): NodeAtResult {
  let best: PathStep[] = [];
  let found = false;
  for (;;) {
    const t = source.next(walker.expectsKey);
    if (t.kind === Kind.EOF || t.offset > offset) break;
    const touches = t.end >= offset;
    const error = walker.feed(t, touches);
    if (error !== undefined) return pathError(text, error, t.error?.offset ?? t.offset);
    if (touches && (!found || walker.path.length > best.length)) {
      best = walker.path;
      found = true;
    }
  }
  // No token touches the offset only in an empty text (or one holding nothing but a BOM): A5.
  return { path: best };
}

/** A JSON Lines line: where its content starts and ends (without the BOM and the line ending). */
interface LineSpan {
  start: number;
  end: number;
}

function lineAt(text: string, offset: number): LineSpan {
  let start = offset === 0 ? 0 : text.lastIndexOf('\n', offset - 1) + 1;
  const lf = text.indexOf('\n', offset);
  let end = lf < 0 ? text.length : lf;
  if (lf >= 0 && end > start && text.charCodeAt(end - 1) === 13) end--;
  if (start === 0 && text.charCodeAt(0) === BOM) start = 1;
  return { start, end: Math.max(start, end) };
}

/** Whether a line holds only spaces and tabs (spec 012 §Terms). */
function isBlank(text: string, { start, end }: LineSpan): boolean {
  for (let i = start; i < end; i++) {
    const c = text.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** Each line of `text` from the start, until `visit` returns false. */
function eachLine(text: string, visit: (line: LineSpan) => boolean): void {
  let start = text.charCodeAt(0) === BOM ? 1 : 0;
  for (;;) {
    const lf = text.indexOf('\n', start);
    let end = lf < 0 ? text.length : lf;
    if (lf >= 0 && end > start && text.charCodeAt(end - 1) === 13) end--;
    if (!visit({ start, end })) return;
    if (lf < 0) return;
    start = lf + 1;
  }
}

/** A5 in `jsonl`: a blank line gives the root; a non-blank line is read alone, the number of
 *  non-blank lines before it being its item's index. */
function lineNodeAt(text: string, offset: number): NodeAtResult {
  const line = lineAt(text, offset);
  if (isBlank(text, line)) return { path: [] };
  let index = 0;
  eachLine(text, (l) => {
    if (l.start >= line.start) return false;
    if (!isBlank(text, l)) index++;
    return true;
  });
  const at = Math.min(Math.max(offset, line.start), line.end);
  const source = new ScannerSource(text.slice(line.start, line.end), line.start, true);
  const result = walkTo(source, new Walker(false), text, at);
  return 'path' in result ? { path: [index, ...result.path] } : result;
}

/**
 * The place of `path` in `text` (R1, R2): the offset of the first character of a member's key
 * (quote included), or of an array element's or the root's value; for a name an object holds
 * more than once, the last of them. Undefined when the node is not in the text, or when the text
 * stops reading as its format before the place is certain. The text is read up to the node, and
 * on to the end of every object on the way to it, where a later duplicate name would replace it.
 * In `jsonl` the root's place is the first blank line's start (a blank line gives the root, A5),
 * or 0 when the text has none.
 */
export function placeOf(format: Format, text: string, path: Path): number | undefined {
  if (format === 'jsonl') return linePlaceOf(text, path);
  return walkPlace(sourceFor(format, text), new Walker(true), path);
}

function walkPlace(source: Source, walker: Walker, path: Path): number | undefined {
  let found: number | undefined;
  /** Open objects the path goes through: a later member there may replace `found`. */
  let openObjects = 0;
  /** Whether the value after the current member name is on the path. */
  let member = false;
  for (;;) {
    const t = source.next(walker.expectsKey);
    if (t.kind === Kind.EOF) return undefined;
    if (walker.feed(t, false) !== undefined) return undefined;
    const frames = walker.frames;
    if (walker.role === MEMBER_NAME) {
      const frame = frames.at(-1)!;
      const depth = frames.length - 1;
      member = false;
      if (frame.onPath && path[depth] === t.name) {
        // A later duplicate: what was found under the earlier one is not in the data (R2).
        found = undefined;
        if (depth + 1 === path.length) found = t.offset;
        else member = true;
      }
    } else if (walker.role === START) {
      // For an object or array, `frames` already holds it.
      const opened = t.kind === Kind.OpenBrace || t.kind === Kind.OpenBracket;
      const parent = frames.at(opened ? -2 : -1);
      const depth = opened ? frames.length - 2 : frames.length - 1;
      let onPath: boolean;
      if (parent === undefined) {
        if (path.length === 0) return t.offset;
        onPath = true;
      } else if (parent.object) {
        onPath = member;
        member = false;
      } else {
        onPath = parent.onPath && path[depth] === walker.step;
        if (onPath && depth + 1 === path.length) {
          found = t.offset;
          onPath = false;
        }
      }
      if (opened && onPath) {
        const frame = frames.at(-1)!;
        frame.onPath = true;
        if (frame.object) openObjects++;
      }
    } else if (walker.role === CLOSE && walker.closed!.onPath && walker.closed!.object) {
      openObjects--;
    }
    if (found !== undefined && openObjects === 0) return found;
    if (walker.done) return found;
  }
}

function linePlaceOf(text: string, path: Path): number | undefined {
  if (path.length === 0) {
    let place = 0;
    eachLine(text, (line) => {
      if (!isBlank(text, line)) return true;
      place = line.start;
      return false;
    });
    return place;
  }
  const index = path[0];
  if (typeof index !== 'number') return undefined;
  let item: LineSpan | undefined;
  let count = 0;
  eachLine(text, (line) => {
    if (isBlank(text, line)) return true;
    if (count++ < index) return true;
    item = line;
    return false;
  });
  if (item === undefined) return undefined;
  const source = new ScannerSource(text.slice(item.start, item.end), item.start, true);
  return walkPlace(source, new Walker(false), path.slice(1));
}
