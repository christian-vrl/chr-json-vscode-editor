// JSON5 1.0.0 parser (002 T5, ADR-009): recursive descent over the spec at spec.json5.org, §2
// (grammar) and §6 (white space, line terminators), from the 002 T4 spike's `spikes/json5-cst/own-parser.ts`.
// One pass yields the data, a `FormatNode` tree with UTF-16 offsets, and a token stream (comments,
// white space and line breaks included) with the same kinds as `tokens.ts`, so the edit layer and
// `Style` detection read JSON5 the way they read JSONC.
import { setMember } from './member.js';
import { json5MayBeBig, json5NumberValue, type LosslessNumber } from './numbers.js';
import { Kind, type Token } from './tokens.js';
import type { Diagnostic, FormatNode } from './types.js';

const LINE_TERMINATOR = '\n\r\u2028\u2029';
const WHITE_SPACE = /[\t\v\f \u00A0\uFEFF\p{Zs}]/u;
const ID_START = /[\p{ID_Start}$_]/u;
const ID_PART = /[\p{ID_Continue}$_\u200C\u200D]/u;

// Character tests on UTF-16 code units, with the ASCII answers inline: large documents are almost
// all ASCII, and a regular expression per character made the walk several times slower.
const isLineTerminator = (c: number) => c === 10 || c === 13 || c === 0x2028 || c === 0x2029;
const isWhiteSpace = (c: number) =>
  c === 32 ||
  c === 9 ||
  c === 11 ||
  c === 12 ||
  (c >= 0xa0 && WHITE_SPACE.test(String.fromCharCode(c)));
/** `$`, `_`, a letter, or (`part`) a digit. */
const isAsciiIdentifier = (c: number, part: boolean) =>
  c === 36 ||
  c === 95 ||
  (c >= 97 && c <= 122) ||
  (c >= 65 && c <= 90) ||
  (part && c >= 48 && c <= 57);
const isHexDigit = (c: number) =>
  (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
/** Whether the code point at `at` continues an identifier. */
const isIdPartAt = (text: string, at: number): boolean => {
  const c = text.codePointAt(at);
  if (c === undefined) return false;
  return c < 128 ? isAsciiIdentifier(c, true) : ID_PART.test(String.fromCodePoint(c));
};
const NUMBER =
  /[+-]?(?:Infinity|NaN|0[xX][0-9a-fA-F]+|(?:(?:0|[1-9]\d*)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/y;
const SINGLE_ESCAPES: Record<string, string> = {
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
  '0': '\0',
};

export interface Json5Parse {
  /** Undefined when the text does not parse. */
  data: unknown;
  tree: FormatNode | undefined;
  /** Every token up to the end, or up to the syntax error. */
  tokens: Token[];
  /** The first syntax error; JSON5 parsing stops there. */
  error: Diagnostic | undefined;
}

export function parseJson5(text: string): Json5Parse {
  const parser = new Parser(text, false);
  try {
    const data = parser.document();
    return { data, tree: parser.node, tokens: parser.tokens, error: undefined };
  } catch (e) {
    return { data: undefined, tree: undefined, tokens: parser.tokens, error: syntaxError(e) };
  }
}

/** The data alone (spec 008 criterion 6): the same grammar as `parseJson5`, with no tree and no
 *  tokens, so it is faster and leaves only the data behind. */
export function parseJson5Data(text: string): Pick<Json5Parse, 'data' | 'error'> {
  // The fast walk first (UNK-064). It gives up on anything it does not read, every syntax error
  // included, and the full grammar below then gives the data or the error and its offset.
  try {
    return { data: new DataParser(text).document(), error: undefined };
  } catch (e) {
    // A stack overflow too: `Parser` decides what a document nested that deep gives.
    if (e !== GIVE_UP && !(e instanceof RangeError)) throw e;
  }
  try {
    return { data: new Parser(text, true).document(), error: undefined };
  } catch (e) {
    return { data: undefined, error: syntaxError(e) };
  }
}

function syntaxError(e: unknown): Diagnostic {
  if (!(e instanceof Json5SyntaxError)) throw e;
  return { severity: 'error', message: e.message, offset: e.offset, length: e.length };
}

class Json5SyntaxError extends SyntaxError {
  constructor(
    message: string,
    readonly offset: number,
    readonly length: number,
  ) {
    super(message);
  }
}

class Parser {
  readonly tokens: Token[] = [];
  /** The node of the value parsed last; not set in a data-only parse. */
  node: FormatNode | undefined;
  protected pos = 0;
  /** The kind of the token `scalar` read last. */
  protected scalarKind: number = Kind.Unknown;

  /** `dataOnly`: build the data only, with no tokens and no tree (`parseJson5Data`). */
  constructor(
    protected readonly text: string,
    private readonly dataOnly: boolean,
  ) {}

  /** The document's data; its tree is `node`. */
  document(): unknown {
    this.trivia();
    if (this.pos >= this.text.length) this.fail('a value');
    const root = this.value();
    this.trivia();
    if (this.pos < this.text.length) this.fail('end of input');
    return root;
  }

  protected fail(expected: string): never {
    const at = this.text.codePointAt(this.pos);
    const got = at === undefined ? 'end of input' : JSON.stringify(String.fromCodePoint(at));
    throw new Json5SyntaxError(
      `expected ${expected}, got ${got} at offset ${this.pos}`,
      this.pos,
      at === undefined ? 0 : at > 0xffff ? 2 : 1,
    );
  }

  private token(kind: number, offset: number): void {
    if (this.dataOnly) return;
    this.tokens.push({ kind, offset, end: this.pos });
  }

  /** One character of `kind` at the current position. */
  private punctuation(kind: number): void {
    this.pos++;
    this.token(kind, this.pos - 1);
  }

  /** White space, line terminators and comments, each as its own token (`\r\n` is one line break). */
  private trivia(): void {
    while (this.trivium() !== undefined);
  }

  /** One white space run, line break or comment, as its token; its kind, or undefined when there
   *  is none at `pos`. */
  protected trivium(): number | undefined {
    const t = this.text;
    const start = this.pos;
    const c = t.charCodeAt(this.pos);
    let kind: number;
    if (Number.isNaN(c)) return undefined;
    if (isLineTerminator(c)) {
      this.pos += c === 13 && t.charCodeAt(this.pos + 1) === 10 ? 2 : 1;
      kind = Kind.LineBreak;
    } else if (isWhiteSpace(c)) {
      while (this.pos < t.length && isWhiteSpace(t.charCodeAt(this.pos))) this.pos++;
      kind = Kind.Whitespace;
    } else if (c !== 47) {
      return undefined;
    } else if (t.startsWith('//', this.pos)) {
      this.pos += 2;
      while (this.pos < t.length && !isLineTerminator(t.charCodeAt(this.pos))) this.pos++;
      kind = Kind.LineComment;
    } else if (t.startsWith('/*', this.pos)) {
      const close = t.indexOf('*/', this.pos + 2);
      if (close < 0) {
        this.pos = t.length;
        this.fail('*/');
      }
      this.pos = close + 2;
      kind = Kind.BlockComment;
    } else return undefined;
    this.token(kind, start);
    return kind;
  }

  /** A value's data; its node is `this.node`. */
  private value(): unknown {
    const ch = this.text[this.pos];
    if (ch === '{') return this.object();
    if (ch === '[') return this.array();
    const offset = this.pos;
    const value = this.scalar();
    if (!this.dataOnly) {
      const kind = this.scalarKind;
      this.token(kind, offset);
      const type =
        kind === Kind.StringLiteral
          ? 'string'
          : kind === Kind.NumericLiteral
            ? 'number'
            : kind === Kind.NullKeyword
              ? 'null'
              : 'boolean';
      this.node = { type, offset, length: this.pos - offset, value };
    }
    return value;
  }

  /** A string, `null`, `true`, `false` or number at `pos`; its token's kind is `scalarKind`. */
  protected scalar(): unknown {
    const ch = this.text[this.pos];
    if (ch === '"' || ch === "'") {
      this.scalarKind = Kind.StringLiteral;
      return this.string();
    }
    if (ch === 'n' && this.word('null')) {
      this.scalarKind = Kind.NullKeyword;
      return null;
    }
    if ((ch === 't' && this.word('true')) || (ch === 'f' && this.word('false'))) {
      this.scalarKind = ch === 't' ? Kind.TrueKeyword : Kind.FalseKeyword;
      return ch === 't';
    }
    this.scalarKind = Kind.NumericLiteral;
    return this.number();
  }

  private word(w: string): boolean {
    if (!this.text.startsWith(w, this.pos)) return false;
    if (isIdPartAt(this.text, this.pos + w.length)) return false;
    this.pos += w.length;
    return true;
  }

  private object(): Record<string, unknown> {
    const offset = this.pos;
    this.punctuation(Kind.OpenBrace);
    const children: FormatNode[] = [];
    const data: Record<string, unknown> = {};
    this.trivia();
    while (this.text[this.pos] !== '}') {
      const keyOffset = this.pos;
      const ch = this.text[this.pos];
      const quoted = ch === '"' || ch === "'";
      const key = quoted ? this.string() : this.identifier();
      this.token(quoted ? Kind.StringLiteral : Kind.Unknown, keyOffset);
      const keyLength = this.pos - keyOffset;
      this.trivia();
      if (this.text[this.pos] !== ':') this.fail(':');
      this.punctuation(Kind.Colon);
      this.trivia();
      const value = this.value();
      if (!this.dataOnly) {
        const node = this.node!;
        children.push({
          type: 'property',
          offset: keyOffset,
          length: node.offset + node.length - keyOffset,
          children: [{ type: 'string', offset: keyOffset, length: keyLength, value: key }, node],
        });
      }
      // A later duplicate replaces the value in the first one's place, as `JSON.parse` does.
      setMember(data, key, value);
      this.trivia();
      if (this.text[this.pos] === ',') {
        this.punctuation(Kind.Comma);
        this.trivia();
      } else if (this.text[this.pos] !== '}') this.fail(', or }');
    }
    this.punctuation(Kind.CloseBrace);
    if (!this.dataOnly) this.node = { type: 'object', offset, length: this.pos - offset, children };
    return data;
  }

  private array(): unknown[] {
    const offset = this.pos;
    this.punctuation(Kind.OpenBracket);
    const children: FormatNode[] = [];
    const data: unknown[] = [];
    this.trivia();
    while (this.text[this.pos] !== ']') {
      if (this.pos >= this.text.length) this.fail(']');
      data.push(this.value());
      if (!this.dataOnly) children.push(this.node!);
      this.trivia();
      if (this.text[this.pos] === ',') {
        this.punctuation(Kind.Comma);
        this.trivia();
      } else if (this.text[this.pos] !== ']') this.fail(', or ]');
    }
    this.punctuation(Kind.CloseBracket);
    if (!this.dataOnly) this.node = { type: 'array', offset, length: this.pos - offset, children };
    return data;
  }

  /** JSON5Identifier: an IdentifierName, `\uXXXX` escapes allowed; returns the decoded name. */
  protected identifier(): string {
    const t = this.text;
    const start = this.pos;
    while (isAsciiIdentifier(t.charCodeAt(this.pos), this.pos > start)) this.pos++;
    let name = t.slice(start, this.pos);
    for (;;) {
      let c: string;
      if (this.text.startsWith('\\u', this.pos)) {
        const hex = this.text.slice(this.pos + 2, this.pos + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail('four hex digits');
        c = String.fromCharCode(parseInt(hex, 16));
        if (!(name === '' ? ID_START : ID_PART).test(c)) this.fail('an identifier character');
        this.pos += 6;
      } else {
        const at = this.text.codePointAt(this.pos);
        if (at === undefined) break;
        c = String.fromCodePoint(at);
        if (!(name === '' ? ID_START : ID_PART).test(c)) break;
        this.pos += c.length;
      }
      name += c;
    }
    if (name === '') this.fail('a key');
    return name;
  }

  /** JSON5String: single or double quoted, with JSON5 escapes and line continuations. */
  protected string(): string {
    const t = this.text;
    const quote = t[this.pos++];
    const q = quote!.charCodeAt(0);
    let out = '';
    // Characters taken as they are, from `from` to `this.pos`, are added in one slice.
    let from = this.pos;
    for (;;) {
      const c = t.charCodeAt(this.pos);
      if (c === q) {
        out += t.slice(from, this.pos++);
        return out;
      }
      // U+2028 and U+2029 may appear unescaped in a JSON5 string (spec §5.1); \n and \r may not.
      if (Number.isNaN(c) || c === 10 || c === 13) this.fail(`closing ${quote}`);
      if (c !== 92) {
        this.pos++;
        continue;
      }
      out += t.slice(from, this.pos);
      const e = t[this.pos + 1];
      if (e === undefined) {
        this.pos++;
        this.fail('an escape');
      }
      this.pos += 2;
      if (LINE_TERMINATOR.includes(e)) {
        // LineContinuation: the escaped line terminator is not part of the value.
        if (e === '\r' && t[this.pos] === '\n') this.pos++;
        from = this.pos;
        continue;
      }
      if (e === 'x' || e === 'u') {
        const len = e === 'x' ? 2 : 4;
        const hex = t.slice(this.pos, this.pos + len);
        if (!new RegExp(`^[0-9a-fA-F]{${len}}$`).test(hex)) this.fail('hex digits');
        out += String.fromCharCode(parseInt(hex, 16));
        this.pos += len;
      } else if (e === '0' && /[0-9]/.test(t[this.pos] ?? '')) {
        this.fail('no digit after \\0');
      } else if (/[1-9]/.test(e)) {
        this.pos -= 1;
        this.fail('a valid escape');
      } else out += SINGLE_ESCAPES[e] ?? e;
      from = this.pos;
    }
  }

  /** JSON5Number: optional sign, then Infinity, NaN, hex, or a decimal with optional dot ends. A
   *  big number is its `LosslessNumber` (spec 015 B1). */
  protected number(): number | LosslessNumber {
    const start = this.pos;
    NUMBER.lastIndex = start;
    const m = NUMBER.exec(this.text);
    if (!m) this.fail('a value');
    if (isIdPartAt(this.text, start + m[0].length)) {
      this.pos += m[0].length;
      this.fail('the end of the number');
    }
    this.pos += m[0].length;
    const sign = m[0][0] === '-' ? -1 : 1;
    // `Number` reads hex, Infinity and decimals with a leading or trailing dot, but not with a sign
    // in front of hex, so the sign is applied separately.
    const value = sign * Number(/^[+-]/.test(m[0]) ? m[0].slice(1) : m[0]);
    return json5MayBeBig(this.text, start, this.pos) ? json5NumberValue(m[0], value) : value;
  }
}

export interface Json5Token extends Token {
  /** A string's or member name's decoded text. */
  name?: string;
  /** Set when the text at `offset` is not a JSON5 token: the parser's error. */
  error?: { message: string; offset: number };
}

const PUNCTUATION: Record<string, number> = {
  '{': Kind.OpenBrace,
  '}': Kind.CloseBrace,
  '[': Kind.OpenBracket,
  ']': Kind.CloseBracket,
  ',': Kind.Comma,
  ':': Kind.Colon,
};

/**
 * The parser's lexical half, one token at a time (spec 018 plan §Approach), for readers that stop
 * partway through a text (`paths/locate.ts`). It runs the parser's own routines, so a token reads,
 * and fails, exactly as it does inside `parseJson5`. JSON5's tokens depend on where they are (an
 * unquoted member name is an identifier, an unquoted value a number or literal), so the caller
 * says whether a member name may come next. Records no tokens and builds no tree.
 */
export class Json5Lexer extends Parser {
  /** `fast` false reads every token with the parser's methods, without the ASCII fast path
   *  (`ascii`): the tests check both read the same tokens. */
  constructor(
    text: string,
    private readonly fast = true,
  ) {
    super(text, true);
  }

  /** The one token `next` returns, its fields replaced on each call: a walk over a large text
   *  makes no object per token (spec 018 criterion 11). */
  private readonly current: Json5Token = {
    kind: Kind.EOF,
    offset: 0,
    end: 0,
    name: undefined,
    error: undefined,
  };

  /** The next token: white space, a line break, a comment, punctuation, a member name (`key`) or a
   *  value's string, number or literal; `EOF` at the end. A member name is a `StringLiteral` when
   *  quoted, else `Unknown`, as in `parseJson5`'s tokens. The same object every time (`current`). */
  next(key: boolean): Json5Token {
    const offset = this.pos;
    if (offset >= this.text.length) return this.set(Kind.EOF, offset, undefined);
    const fast = this.fast ? this.ascii(key, offset) : undefined;
    if (fast !== undefined) return fast;
    try {
      const trivia = this.trivium();
      if (trivia !== undefined) return this.set(trivia, offset, undefined);
      const ch = this.text[offset]!;
      const punctuation = PUNCTUATION[ch];
      if (punctuation !== undefined) {
        this.pos++;
        return this.set(punctuation, offset, undefined);
      }
      if (key) {
        const quoted = ch === '"' || ch === "'";
        const name = quoted ? this.string() : this.identifier();
        return this.set(quoted ? Kind.StringLiteral : Kind.Unknown, offset, name);
      }
      const value = this.scalar();
      return this.set(this.scalarKind, offset, typeof value === 'string' ? value : undefined);
    } catch (e) {
      if (!(e instanceof Json5SyntaxError)) throw e;
      const t = this.set(Kind.Unknown, offset, undefined);
      t.end = Math.max(this.pos, offset + 1);
      t.error = { message: e.message, offset: e.offset };
      return t;
    }
  }

  /**
   * The token at `offset` when it is one of the ASCII tokens large documents are made of, read
   * from character codes: a run of white space and line breaks (one `Whitespace` token where the
   * parser reads one token per line break and per white space run), a comment, punctuation, a
   * string without escapes, an identifier member name, `null`, `true` or `false`, or a plain
   * decimal or hexadecimal number (no value is computed: the walker reads none).
   * Undefined for anything else, which `next` then reads with the parser's own methods, so the
   * tokens and errors are the parser's either way, but for how white space is cut into tokens.
   */
  private ascii(key: boolean, offset: number): Json5Token | undefined {
    const t = this.text;
    const c = t.charCodeAt(offset);
    let pos = offset + 1;
    switch (c) {
      case 32:
      case 9:
      case 11:
      case 12:
      case 10:
      case 13: {
        // A run of ASCII white space and line breaks is one token: each part gives the same node
        // (A4), and a document's indentation is most of its tokens otherwise.
        let d = t.charCodeAt(pos);
        while (d === 32 || d === 9 || d === 11 || d === 12 || d === 10 || d === 13)
          d = t.charCodeAt(++pos);
        this.pos = pos;
        return this.set(Kind.Whitespace, offset, undefined);
      }
      case 123:
        this.pos = pos;
        return this.set(Kind.OpenBrace, offset, undefined);
      case 125:
        this.pos = pos;
        return this.set(Kind.CloseBrace, offset, undefined);
      case 91:
        this.pos = pos;
        return this.set(Kind.OpenBracket, offset, undefined);
      case 93:
        this.pos = pos;
        return this.set(Kind.CloseBracket, offset, undefined);
      case 44:
        this.pos = pos;
        return this.set(Kind.Comma, offset, undefined);
      case 58:
        this.pos = pos;
        return this.set(Kind.Colon, offset, undefined);
      case 34:
      case 39: {
        // A string without escapes and line breaks; any other `string` reads.
        let d = t.charCodeAt(pos);
        while (d !== c) {
          if (d === 92 || d === 10 || d === 13 || Number.isNaN(d)) return undefined;
          d = t.charCodeAt(++pos);
        }
        this.pos = pos + 1;
        return this.set(Kind.StringLiteral, offset, t.slice(offset + 1, pos));
      }
      case 47: {
        // A comment; an unclosed block comment, or a lone `/`, goes to `trivium`.
        const d = t.charCodeAt(pos);
        if (d === 47) {
          let e = t.charCodeAt(++pos);
          while (pos < t.length && !isLineTerminator(e)) e = t.charCodeAt(++pos);
          this.pos = pos;
          return this.set(Kind.LineComment, offset, undefined);
        }
        if (d !== 42) return undefined;
        const close = t.indexOf('*/', pos + 1);
        if (close < 0) return undefined;
        this.pos = close + 2;
        return this.set(Kind.BlockComment, offset, undefined);
      }
    }
    if (key) {
      if (!isAsciiIdentifier(c, false)) return undefined;
      let d = t.charCodeAt(pos);
      while (isAsciiIdentifier(d, true)) d = t.charCodeAt(++pos);
      // An escape or a non-ASCII character goes on the identifier: `identifier` reads it.
      if (d === 92 || d >= 128) return undefined;
      this.pos = pos;
      return this.set(Kind.Unknown, offset, t.slice(offset, pos));
    }
    // `null`, `true` or `false` not followed by an identifier character, as `word` reads them.
    const literal = c === 110 ? 'null' : c === 116 ? 'true' : c === 102 ? 'false' : undefined;
    if (literal !== undefined) {
      if (!t.startsWith(literal, offset)) return undefined;
      pos = offset + literal.length;
      const d = t.charCodeAt(pos);
      if (isAsciiIdentifier(d, true) || d === 92 || d >= 128) return undefined;
      this.pos = pos;
      const kind = c === 110 ? Kind.NullKeyword : c === 116 ? Kind.TrueKeyword : Kind.FalseKeyword;
      return this.set(kind, offset, undefined);
    }
    // A decimal integer, `-` allowed, with an optional fraction, or a hexadecimal integer: `NUMBER`
    // reads the same.
    pos = offset;
    if (c === 45) pos++;
    let d = t.charCodeAt(pos);
    if (d === 48 && (t.charCodeAt(pos + 1) | 32) === 120) {
      pos += 2;
      d = t.charCodeAt(pos);
      if (!isHexDigit(d)) return undefined;
      do d = t.charCodeAt(++pos);
      while (isHexDigit(d));
      if (isAsciiIdentifier(d, true) || d === 92 || d === 46 || d >= 128) return undefined;
      this.pos = pos;
      return this.set(Kind.NumericLiteral, offset, undefined);
    }
    if (d === 48) d = t.charCodeAt(++pos);
    else if (d >= 49 && d <= 57) {
      do d = t.charCodeAt(++pos);
      while (d >= 48 && d <= 57);
    } else return undefined;
    if (d === 46) {
      d = t.charCodeAt(++pos);
      if (!(d >= 48 && d <= 57)) return undefined;
      do d = t.charCodeAt(++pos);
      while (d >= 48 && d <= 57);
    }
    // An identifier character right after it (an exponent, a hex number, digits after a leading
    // 0, or an error), an escape, a non-ASCII character or a second dot: `number` reads those.
    if (isAsciiIdentifier(d, true) || d === 92 || d === 46 || d >= 128) return undefined;
    this.pos = pos;
    return this.set(Kind.NumericLiteral, offset, undefined);
  }

  private set(kind: number, offset: number, name: string | undefined): Json5Token {
    const t = this.current;
    t.kind = kind;
    t.offset = offset;
    t.end = this.pos;
    t.name = name;
    t.error = undefined;
    return t;
  }
}

/** Thrown by `DataParser` where it stops reading: one object, so a throw builds no stack. */
const GIVE_UP = new Error('give up');

/**
 * A data-only walk for large documents (spec 008 criterion 7, UNK-064): the grammar of `Parser`
 * on character codes, with no tokens, no tree and no error messages. It reads only what it is sure
 * `Parser` reads to the same data, and throws `GIVE_UP` everywhere else (a syntax error, a
 * non-ASCII or escaped identifier, an unusual number), so `parseJson5Data` then runs `Parser`.
 */
class DataParser {
  private pos = 0;

  constructor(private readonly text: string) {}

  document(): unknown {
    this.trivia();
    if (this.pos >= this.text.length) throw GIVE_UP;
    const root = this.value();
    this.trivia();
    if (this.pos < this.text.length) throw GIVE_UP;
    return root;
  }

  private trivia(): void {
    const t = this.text;
    let pos = this.pos;
    for (;;) {
      const c = t.charCodeAt(pos);
      if (c === 32 || c === 10 || c === 13 || c === 9 || c === 11 || c === 12) pos++;
      else if (c === 47) {
        const next = t.charCodeAt(pos + 1);
        if (next === 47) {
          pos += 2;
          for (;;) {
            const d = t.charCodeAt(pos);
            if (Number.isNaN(d) || isLineTerminator(d)) break;
            pos++;
          }
        } else if (next === 42) {
          const close = t.indexOf('*/', pos + 2);
          if (close < 0) throw GIVE_UP;
          pos = close + 2;
        } else break;
      } else if (c >= 0x80 && (isLineTerminator(c) || isWhiteSpace(c))) pos++;
      else break;
    }
    this.pos = pos;
  }

  private value(): unknown {
    const t = this.text;
    const c = t.charCodeAt(this.pos);
    if (c === 123) return this.object();
    if (c === 91) return this.array();
    if (c === 34 || c === 39) return this.string(c);
    if (c === 110) return this.word('null', null);
    if (c === 116) return this.word('true', true);
    if (c === 102) return this.word('false', false);
    return this.number();
  }

  private word(w: string, value: null | boolean): null | boolean {
    if (!this.text.startsWith(w, this.pos)) throw GIVE_UP;
    this.pos += w.length;
    this.end();
    return value;
  }

  /** Gives up when an identifier character follows a literal (`Parser` fails there). */
  private end(): void {
    const c = this.text.charCodeAt(this.pos);
    if (c < 128 ? isAsciiIdentifier(c, true) : isIdPartAt(this.text, this.pos)) throw GIVE_UP;
  }

  private object(): Record<string, unknown> {
    const t = this.text;
    this.pos++;
    const data: Record<string, unknown> = {};
    this.trivia();
    for (;;) {
      let c = t.charCodeAt(this.pos);
      if (c === 125) break;
      let key: string;
      if (c === 34 || c === 39) key = this.string(c);
      else {
        // An ASCII identifier; anything else (an escape, a non-ASCII character) goes to `Parser`.
        const start = this.pos;
        let pos = start;
        if (!isAsciiIdentifier(c, false)) throw GIVE_UP;
        do c = t.charCodeAt(++pos);
        while (isAsciiIdentifier(c, true));
        if (c === 92 || c >= 128) throw GIVE_UP;
        key = t.slice(start, pos);
        this.pos = pos;
      }
      this.trivia();
      if (t.charCodeAt(this.pos) !== 58) throw GIVE_UP;
      this.pos++;
      this.trivia();
      setMember(data, key, this.value());
      this.trivia();
      c = t.charCodeAt(this.pos);
      if (c === 44) {
        this.pos++;
        this.trivia();
      } else if (c !== 125) throw GIVE_UP;
    }
    this.pos++;
    return data;
  }

  private array(): unknown[] {
    const t = this.text;
    this.pos++;
    const data: unknown[] = [];
    this.trivia();
    for (;;) {
      let c = t.charCodeAt(this.pos);
      if (c === 93) break;
      if (Number.isNaN(c)) throw GIVE_UP;
      data.push(this.value());
      this.trivia();
      c = t.charCodeAt(this.pos);
      if (c === 44) {
        this.pos++;
        this.trivia();
      } else if (c !== 93) throw GIVE_UP;
    }
    this.pos++;
    return data;
  }

  /** As `Parser.string`; gives up on what it would fail on. */
  private string(q: number): string {
    const t = this.text;
    let pos = this.pos + 1;
    let out = '';
    let from = pos;
    for (;;) {
      const c = t.charCodeAt(pos);
      if (c === q) {
        this.pos = pos + 1;
        return out + t.slice(from, pos);
      }
      if (c === 92) {
        out += t.slice(from, pos);
        const e = t[pos + 1];
        if (e === undefined) throw GIVE_UP;
        pos += 2;
        if (LINE_TERMINATOR.includes(e)) {
          if (e === '\r' && t.charCodeAt(pos) === 10) pos++;
        } else if (e === 'x' || e === 'u') {
          const len = e === 'x' ? 2 : 4;
          const hex = t.slice(pos, pos + len);
          if (!(len === 2 ? HEX2 : HEX4).test(hex)) throw GIVE_UP;
          out += String.fromCharCode(parseInt(hex, 16));
          pos += len;
        } else if (e >= '0' && e <= '9') {
          // `\0` not followed by a digit is NUL; `\1`–`\9` and `\0` before a digit fail.
          const d = t.charCodeAt(pos);
          if (e !== '0' || (d >= 48 && d <= 57)) throw GIVE_UP;
          out += '\0';
        } else out += SINGLE_ESCAPES[e] ?? e;
        from = pos;
      } else if (Number.isNaN(c) || c === 10 || c === 13) throw GIVE_UP;
      else pos++;
    }
  }

  /** A decimal or hex JSON5Number with an optional sign; Infinity and NaN go through `NUMBER`. A
   *  big number is its `LosslessNumber`, as in `Parser.number`. */
  private number(): number | LosslessNumber {
    const t = this.text;
    const start = this.pos;
    let pos = start;
    let c = t.charCodeAt(pos);
    let sign = 1;
    if (c === 45 || c === 43) {
      if (c === 45) sign = -1;
      c = t.charCodeAt(++pos);
    }
    const digits = pos;
    let value: number;
    // Whether the token may be a big number (`json5MayBeBig`), decided as it is read.
    let mayBeBig: boolean;
    if (c === 48 && (t.charCodeAt(pos + 1) | 0x20) === 120 && isHex(t.charCodeAt(pos + 2))) {
      pos += 3;
      while (isHex(t.charCodeAt(pos))) pos++;
      value = Number(t.slice(digits, pos));
      mayBeBig = pos - digits - 2 > 13;
    } else if ((c >= 48 && c <= 57) || c === 46) {
      let integer = c !== 46;
      if (c === 48) c = t.charCodeAt(++pos);
      else
        while (c >= 48 && c <= 57) {
          c = t.charCodeAt(++pos);
        }
      if (c === 46) {
        const dot = pos;
        c = t.charCodeAt(++pos);
        while (c >= 48 && c <= 57) c = t.charCodeAt(++pos);
        // A dot needs a digit on one side.
        if (pos === dot + 1 && dot === digits) throw GIVE_UP;
        integer = false;
      }
      mayBeBig = pos - start > 15;
      if (c === 101 || c === 69) {
        c = t.charCodeAt(++pos);
        if (c === 45 || c === 43) c = t.charCodeAt(++pos);
        if (!(c >= 48 && c <= 57)) throw GIVE_UP;
        while (c >= 48 && c <= 57) c = t.charCodeAt(++pos);
        integer = false;
        mayBeBig = true;
      }
      if (integer && pos - digits < 16) {
        value = 0;
        for (let i = digits; i < pos; i++) value = value * 10 + t.charCodeAt(i) - 48;
      } else value = Number(t.slice(digits, pos));
    } else {
      NUMBER.lastIndex = start;
      const m = NUMBER.exec(t);
      if (!m) throw GIVE_UP;
      pos = start + m[0].length;
      value = Number(t.slice(digits, pos));
      mayBeBig = json5MayBeBig(t, start, pos);
    }
    this.pos = pos;
    this.end();
    return mayBeBig ? json5NumberValue(t.slice(start, pos), sign * value) : sign * value;
  }
}

const HEX2 = /^[0-9a-fA-F]{2}$/;
const HEX4 = /^[0-9a-fA-F]{4}$/;
const isHex = (c: number) => (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
