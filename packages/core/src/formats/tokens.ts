// Token stream of a JSON or JSONC text, comments and line breaks included, from jsonc-parser's
// scanner (node_modules/jsonc-parser/lib/esm/main.d.ts:5 `createScanner`, :15 `SyntaxKind`).
// `SyntaxKind` is an ambient const enum, which `isolatedModules` cannot read, so its values are
// repeated here. The JSON5 parser (`json5-parser.ts`) emits the same kinds, with `Unknown` for an
// unquoted key.
import { createScanner } from 'jsonc-parser';

export const Kind = {
  OpenBrace: 1,
  CloseBrace: 2,
  OpenBracket: 3,
  CloseBracket: 4,
  Comma: 5,
  Colon: 6,
  NullKeyword: 7,
  TrueKeyword: 8,
  FalseKeyword: 9,
  StringLiteral: 10,
  NumericLiteral: 11,
  LineComment: 12,
  BlockComment: 13,
  LineBreak: 14,
  Whitespace: 15,
  Unknown: 16,
  EOF: 17,
} as const;

export interface Token {
  kind: number;
  offset: number;
  end: number;
}

export function tokenize(text: string): Token[] {
  const scanner = createScanner(text, false);
  const tokens: Token[] = [];
  for (let kind: number = scanner.scan(); kind !== Kind.EOF; kind = scanner.scan()) {
    const offset = scanner.getTokenOffset();
    tokens.push({ kind, offset, end: offset + scanner.getTokenLength() });
  }
  return tokens;
}

export const isComment = (t: Token | undefined) =>
  t !== undefined && (t.kind === Kind.LineComment || t.kind === Kind.BlockComment);

/** Index of the token that starts at `offset` (node offsets always start a token). */
export function tokenAt(tokens: readonly Token[], offset: number): number {
  let lo = 0;
  let hi = tokens.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = tokens[mid]!;
    if (t.offset === offset) return mid;
    if (t.offset < offset) lo = mid + 1;
    else hi = mid - 1;
  }
  throw new Error(`no token starts at offset ${offset}`);
}

/** Index of the first token at or after `offset`. */
export function tokenFrom(tokens: readonly Token[], offset: number): number {
  let lo = 0;
  let hi = tokens.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tokens[mid]!.offset < offset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
