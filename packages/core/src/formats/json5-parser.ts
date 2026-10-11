// JSON5 1.0.0 parser (002 T5, ADR-009): recursive descent over the spec at spec.json5.org, §2
// (grammar) and §6 (white space, line terminators), from the 002 T4 spike's `spikes/json5-cst/own-parser.ts`.
// One pass yields the data, a `FormatNode` tree with UTF-16 offsets, and a token stream (comments,
// white space and line breaks included) with the same kinds as `tokens.ts`, so the edit layer and
// `Style` detection read JSON5 the way they read JSONC.
import { setMember } from './member.js';
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
  private pos = 0;

  /** `dataOnly`: build the data only, with no tokens and no tree (`parseJson5Data`). */
  constructor(
    private readonly text: string,
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

  private fail(expected: string): never {
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
    const t = this.text;
    for (;;) {
      const start = this.pos;
      const c = t.charCodeAt(this.pos);
      if (Number.isNaN(c)) return;
      if (isLineTerminator(c)) {
        this.pos += c === 13 && t.charCodeAt(this.pos + 1) === 10 ? 2 : 1;
        this.token(Kind.LineBreak, start);
      } else if (isWhiteSpace(c)) {
        while (this.pos < t.length && isWhiteSpace(t.charCodeAt(this.pos))) this.pos++;
        this.token(Kind.Whitespace, start);
      } else if (c !== 47) {
        return;
      } else if (t.startsWith('//', this.pos)) {
        this.pos += 2;
        while (this.pos < t.length && !isLineTerminator(t.charCodeAt(this.pos))) this.pos++;
        this.token(Kind.LineComment, start);
      } else if (t.startsWith('/*', this.pos)) {
        const close = t.indexOf('*/', this.pos + 2);
        if (close < 0) {
          this.pos = t.length;
          this.fail('*/');
        }
        this.pos = close + 2;
        this.token(Kind.BlockComment, start);
      } else return;
    }
  }

  /** A value's data; its node is `this.node`. */
  private value(): unknown {
    const ch = this.text[this.pos];
    if (ch === '{') return this.object();
    if (ch === '[') return this.array();
    const offset = this.pos;
    let type: FormatNode['type'];
    let kind: number;
    let value: unknown;
    if (ch === '"' || ch === "'") {
      value = this.string();
      type = 'string';
      kind = Kind.StringLiteral;
    } else if (ch === 'n' && this.word('null')) {
      value = null;
      type = 'null';
      kind = Kind.NullKeyword;
    } else if ((ch === 't' && this.word('true')) || (ch === 'f' && this.word('false'))) {
      value = ch === 't';
      type = 'boolean';
      kind = value ? Kind.TrueKeyword : Kind.FalseKeyword;
    } else {
      value = this.number();
      type = 'number';
      kind = Kind.NumericLiteral;
    }
    if (!this.dataOnly) {
      this.token(kind, offset);
      this.node = { type, offset, length: this.pos - offset, value };
    }
    return value;
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
  private identifier(): string {
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
  private string(): string {
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

  /** JSON5Number: optional sign, then Infinity, NaN, hex, or a decimal with optional dot ends. */
  private number(): number {
    NUMBER.lastIndex = this.pos;
    const m = NUMBER.exec(this.text);
    if (!m) this.fail('a value');
    if (isIdPartAt(this.text, this.pos + m[0].length)) {
      this.pos += m[0].length;
      this.fail('the end of the number');
    }
    this.pos += m[0].length;
    const sign = m[0][0] === '-' ? -1 : 1;
    // `Number` reads hex, Infinity and decimals with a leading or trailing dot, but not with a sign
    // in front of hex, so the sign is applied separately.
    return sign * Number(/^[+-]/.test(m[0]) ? m[0].slice(1) : m[0]);
  }
}
