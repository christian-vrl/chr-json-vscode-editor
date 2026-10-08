// JSON5 1.0.0 parser (002 T5, ADR-009): recursive descent over the spec at spec.json5.org, §2
// (grammar) and §6 (white space, line terminators), from the 002 T4 spike's `spikes/json5-cst/own-parser.ts`.
// One pass yields the data, a `FormatNode` tree with UTF-16 offsets, and a token stream (comments,
// white space and line breaks included) with the same kinds as `tokens.ts`, so the edit layer and
// `Style` detection read JSON5 the way they read JSONC.
import { Kind, type Token } from './tokens.js';
import type { Diagnostic, FormatNode } from './types.js';

const LINE_TERMINATOR = '\n\r\u2028\u2029';
const WHITE_SPACE = /[\t\v\f \u00A0\uFEFF\p{Zs}]/u;
const ID_START = /[\p{ID_Start}$_]/u;
const ID_PART = /[\p{ID_Continue}$_\u200C\u200D]/u;
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
  const parser = new Parser(text);
  try {
    const { node, data } = parser.document();
    return { data, tree: node, tokens: parser.tokens, error: undefined };
  } catch (e) {
    if (!(e instanceof Json5SyntaxError)) throw e;
    return {
      data: undefined,
      tree: undefined,
      tokens: parser.tokens,
      error: { severity: 'error', message: e.message, offset: e.offset, length: e.length },
    };
  }
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

interface Parsed {
  node: FormatNode;
  data: unknown;
}

class Parser {
  readonly tokens: Token[] = [];
  private pos = 0;

  constructor(private readonly text: string) {}

  document(): Parsed {
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
      const ch = t[this.pos];
      if (ch === undefined) return;
      if (LINE_TERMINATOR.includes(ch)) {
        this.pos += ch === '\r' && t[this.pos + 1] === '\n' ? 2 : 1;
        this.token(Kind.LineBreak, start);
      } else if (WHITE_SPACE.test(ch)) {
        while (this.pos < t.length && WHITE_SPACE.test(t[this.pos]!)) this.pos++;
        this.token(Kind.Whitespace, start);
      } else if (t.startsWith('//', this.pos)) {
        this.pos += 2;
        while (this.pos < t.length && !LINE_TERMINATOR.includes(t[this.pos]!)) this.pos++;
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

  private value(): Parsed {
    const ch = this.text[this.pos];
    if (ch === '{') return this.object();
    if (ch === '[') return this.array();
    const offset = this.pos;
    const scalar = (type: FormatNode['type'], kind: number, value: unknown): Parsed => {
      this.token(kind, offset);
      return { node: { type, offset, length: this.pos - offset, value }, data: value };
    };
    if (ch === '"' || ch === "'") return scalar('string', Kind.StringLiteral, this.string());
    if (this.word('null')) return scalar('null', Kind.NullKeyword, null);
    if (this.word('true')) return scalar('boolean', Kind.TrueKeyword, true);
    if (this.word('false')) return scalar('boolean', Kind.FalseKeyword, false);
    return scalar('number', Kind.NumericLiteral, this.number());
  }

  private word(w: string): boolean {
    if (!this.text.startsWith(w, this.pos)) return false;
    const next = this.text.codePointAt(this.pos + w.length);
    if (next !== undefined && ID_PART.test(String.fromCodePoint(next))) return false;
    this.pos += w.length;
    return true;
  }

  private object(): Parsed {
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
      const keyNode: FormatNode = {
        type: 'string',
        offset: keyOffset,
        length: this.pos - keyOffset,
        value: key,
      };
      this.trivia();
      if (this.text[this.pos] !== ':') this.fail(':');
      this.punctuation(Kind.Colon);
      this.trivia();
      const { node, data: value } = this.value();
      children.push({
        type: 'property',
        offset: keyOffset,
        length: node.offset + node.length - keyOffset,
        children: [keyNode, node],
      });
      // Defined, not assigned, so a `__proto__` key is a member rather than the prototype. A later
      // duplicate replaces the value in the first one's place, as `JSON.parse` does.
      Object.defineProperty(data, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      this.trivia();
      if (this.text[this.pos] === ',') {
        this.punctuation(Kind.Comma);
        this.trivia();
      } else if (this.text[this.pos] !== '}') this.fail(', or }');
    }
    this.punctuation(Kind.CloseBrace);
    return { node: { type: 'object', offset, length: this.pos - offset, children }, data };
  }

  private array(): Parsed {
    const offset = this.pos;
    this.punctuation(Kind.OpenBracket);
    const children: FormatNode[] = [];
    const data: unknown[] = [];
    this.trivia();
    while (this.text[this.pos] !== ']') {
      if (this.pos >= this.text.length) this.fail(']');
      const item = this.value();
      children.push(item.node);
      data.push(item.data);
      this.trivia();
      if (this.text[this.pos] === ',') {
        this.punctuation(Kind.Comma);
        this.trivia();
      } else if (this.text[this.pos] !== ']') this.fail(', or ]');
    }
    this.punctuation(Kind.CloseBracket);
    return { node: { type: 'array', offset, length: this.pos - offset, children }, data };
  }

  /** JSON5Identifier: an IdentifierName, `\uXXXX` escapes allowed; returns the decoded name. */
  private identifier(): string {
    let name = '';
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
    let out = '';
    for (;;) {
      const ch = t[this.pos];
      if (ch === undefined) this.fail(`closing ${quote}`);
      if (ch === quote) {
        this.pos++;
        return out;
      }
      // U+2028 and U+2029 may appear unescaped in a JSON5 string (spec §5.1); \n and \r may not.
      if (ch === '\n' || ch === '\r') this.fail(`closing ${quote}`);
      if (ch !== '\\') {
        out += ch;
        this.pos++;
        continue;
      }
      const e = t[this.pos + 1];
      if (e === undefined) {
        this.pos++;
        this.fail('an escape');
      }
      this.pos += 2;
      if (LINE_TERMINATOR.includes(e)) {
        // LineContinuation: the escaped line terminator is not part of the value.
        if (e === '\r' && t[this.pos] === '\n') this.pos++;
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
    }
  }

  /** JSON5Number: optional sign, then Infinity, NaN, hex, or a decimal with optional dot ends. */
  private number(): number {
    NUMBER.lastIndex = this.pos;
    const m = NUMBER.exec(this.text);
    if (!m) this.fail('a value');
    const after = this.text.codePointAt(this.pos + m[0].length);
    if (after !== undefined && ID_PART.test(String.fromCodePoint(after))) {
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
