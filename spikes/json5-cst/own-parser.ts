// Option F: a small recursive-descent JSON5 1.0.0 parser that records UTF-16 offsets
// (https://spec.json5.org/, §2 grammar and §6 white space / line terminators). Written for the
// spike from the spec, not from the cases; T5 would harden it if ADR-009 picks it.
import type { CstMember, CstNode } from './engine.ts';

const LINE_TERMINATOR = '\n\r\u2028\u2029';
const WHITE_SPACE = /[\t\v\f \u00A0\uFEFF\p{Zs}]/u;
const ID_START = /[\p{ID_Start}$_]/u;
const ID_PART = /[\p{ID_Continue}$_‌‍]/u;
const SINGLE_ESCAPES: Record<string, string> = {
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
  '0': '\0',
};

export function parseJson5Tree(text: string): CstNode {
  return new Parser(text).document();
}

class Parser {
  private readonly text: string;
  private pos = 0;

  constructor(text: string) {
    this.text = text;
  }

  document(): CstNode {
    this.trivia();
    const root = this.value();
    this.trivia();
    if (this.pos < this.text.length) this.fail('end of input');
    return root;
  }

  private fail(expected: string): never {
    const got = this.pos < this.text.length ? JSON.stringify(this.text[this.pos]) : 'end of input';
    throw new SyntaxError(`expected ${expected}, got ${got} at offset ${this.pos}`);
  }

  private trivia(): void {
    const t = this.text;
    for (;;) {
      const ch = t[this.pos];
      if (ch === undefined) return;
      if (LINE_TERMINATOR.includes(ch) || WHITE_SPACE.test(ch)) this.pos++;
      else if (t.startsWith('//', this.pos)) {
        this.pos += 2;
        while (this.pos < t.length && !LINE_TERMINATOR.includes(t[this.pos]!)) this.pos++;
      } else if (t.startsWith('/*', this.pos)) {
        const close = t.indexOf('*/', this.pos + 2);
        if (close < 0) this.fail('*/');
        this.pos = close + 2;
      } else return;
    }
  }

  private value(): CstNode {
    const ch = this.text[this.pos];
    if (ch === '{') return this.object();
    if (ch === '[') return this.array();
    const start = this.pos;
    if (ch === '"' || ch === "'") this.string();
    else if (!this.word('null') && !this.word('true') && !this.word('false')) this.number();
    return { kind: 'scalar', start, end: this.pos };
  }

  private word(w: string): boolean {
    if (!this.text.startsWith(w, this.pos)) return false;
    const next = this.text.codePointAt(this.pos + w.length);
    if (next !== undefined && ID_PART.test(String.fromCodePoint(next))) return false;
    this.pos += w.length;
    return true;
  }

  private object(): CstNode {
    const start = this.pos++;
    const members: CstMember[] = [];
    this.trivia();
    while (this.text[this.pos] !== '}') {
      const keyStart = this.pos;
      const ch = this.text[this.pos];
      const key = ch === '"' || ch === "'" ? this.string() : this.identifier();
      const keyEnd = this.pos;
      this.trivia();
      if (this.text[this.pos] !== ':') this.fail(':');
      this.pos++;
      this.trivia();
      members.push({ key, keyStart, keyEnd, value: this.value() });
      this.trivia();
      if (this.text[this.pos] === ',') {
        this.pos++;
        this.trivia();
      } else if (this.text[this.pos] !== '}') this.fail(', or }');
    }
    this.pos++;
    return { kind: 'object', start, end: this.pos, members };
  }

  private array(): CstNode {
    const start = this.pos++;
    const items: CstNode[] = [];
    this.trivia();
    while (this.text[this.pos] !== ']') {
      items.push(this.value());
      this.trivia();
      if (this.text[this.pos] === ',') {
        this.pos++;
        this.trivia();
      } else if (this.text[this.pos] !== ']') this.fail(', or ]');
    }
    this.pos++;
    return { kind: 'array', start, end: this.pos, items };
  }

  /** JSON5Identifier: IdentifierName with \uXXXX escapes; returns the decoded name. */
  private identifier(): string {
    let name = '';
    for (;;) {
      let cp: number;
      if (this.text.startsWith('\\u', this.pos)) {
        const hex = this.text.slice(this.pos + 2, this.pos + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail('four hex digits');
        cp = parseInt(hex, 16);
        this.pos += 6;
      } else {
        const at = this.text.codePointAt(this.pos);
        if (at === undefined) break;
        const ok = name === '' ? ID_START : ID_PART;
        if (!ok.test(String.fromCodePoint(at))) break;
        cp = at;
        this.pos += cp > 0xffff ? 2 : 1;
      }
      const c = String.fromCodePoint(cp);
      if (!(name === '' ? ID_START : ID_PART).test(c)) this.fail('identifier character');
      name += c;
    }
    if (name === '') this.fail('key');
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
      if (ch === '\n' || ch === '\r') this.fail(`closing ${quote}`);
      if (ch !== '\\') {
        out += ch;
        this.pos++;
        continue;
      }
      const e = t[this.pos + 1];
      if (e === undefined) this.fail('escape');
      this.pos += 2;
      if (e === '\r' && t[this.pos] === '\n') this.pos++;
      if (LINE_TERMINATOR.includes(e)) continue;
      if (e === 'x' || e === 'u') {
        const len = e === 'x' ? 2 : 4;
        const hex = t.slice(this.pos, this.pos + len);
        if (!new RegExp(`^[0-9a-fA-F]{${len}}$`).test(hex)) this.fail('hex digits');
        out += String.fromCharCode(parseInt(hex, 16));
        this.pos += len;
      } else if (e === '0' && /[0-9]/.test(t[this.pos] ?? '')) this.fail('no digit after \\0');
      else if (/[1-9]/.test(e)) this.fail('a valid escape');
      else out += SINGLE_ESCAPES[e] ?? e;
    }
  }

  /** JSON5Number: optional sign, then Infinity, NaN, hex, or a decimal with optional dot ends. */
  private number(): void {
    const rest = this.text.slice(this.pos);
    const m =
      /^[+-]?(?:Infinity|NaN|0[xX][0-9a-fA-F]+|(?:(?:0|[1-9]\d*)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/.exec(
        rest,
      );
    if (!m) this.fail('a value');
    const after = this.text.codePointAt(this.pos + m[0].length);
    if (after !== undefined && ID_PART.test(String.fromCodePoint(after)))
      this.fail('end of number');
    this.pos += m[0].length;
  }
}
