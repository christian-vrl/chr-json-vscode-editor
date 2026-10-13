// 006 T2 gate, spec 006 criteria 3–5: for 10 000 documents per pair (seed committed in
// `arbitraries.ts`), printed by the 002 generator (`printDocument`, comments in every tagged place)
// and, for a JSON5 source, given JSON5-only syntax by `json5Only` (hexadecimal, `+`, `.5`, `5.`,
// single-quoted strings with `\x` escapes, JSON5 white space, U+2028 line breaks):
// - criterion 3: a superset pair returns the input unchanged, with no losses;
// - criterion 4: the output parses in the target with no error, and holds the input's data except at
//   each value loss's path, where it holds `null` (UNK-034); to JSON it has no strict-JSON warning;
// - criterion 5: every input token C1–C6 do not name is in the output, byte for byte and in the same
//   order; to JSONC and JSON5 every comment is, and every white-space token and line break is, as
//   written or as C6 rewrites it.
// Spec 012 criterion 5 (012 T3): over criterion 3's JSON Lines texts, converting to JSON, JSONC or
// JSON5 keeps the items' data with no loss (J1); over the documents above with an array at the
// root, converting to JSON Lines keeps the data except at each value loss's path, which holds
// `null` (J2, UNK-034).
// Which tokens C1–C4 name is restated here from the spec, not taken from `convert.ts`.
import { isDeepStrictEqual } from 'node:util';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  convert,
  getAdapter,
  strictJsonDiagnostics,
  type Format,
  type Style,
} from '../src/index.js';
import { parseJson5 } from '../src/formats/json5-parser.js';
import { isComment, Kind, tokenize, type Token } from '../src/formats/tokens.js';
import { dataArbitrary, SEED, styleArbitrary } from './arbitraries.js';
import { jsonlText } from './jsonl-arbitraries.js';
import { printDocument } from './print-document.js';
import { json5Only } from './json5-only.js';

const RUNS = 10_000;

type Gen = fc.GeneratorValue;

const PAIRS: [Format, Format][] = [
  ['json', 'jsonc'],
  ['json', 'json5'],
  ['jsonc', 'json5'],
  ['json5', 'json'],
  ['json5', 'jsonc'],
  ['jsonc', 'json'],
];
const supersets = new Set(['json-jsonc', 'json-json5', 'jsonc-json5']);

const JSON_STRING = /^"(?:[^"\\\u0000-\u001F]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"$/; // eslint-disable-line no-control-regex
const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

const tokensOf = (text: string, format: Format): Token[] =>
  format === 'json5' ? parseJson5(text).tokens : tokenize(text);
const slice = (text: string, t: Token) => text.slice(t.offset, t.end);
const isTrivia = (t: Token) => t.kind === Kind.Whitespace || t.kind === Kind.LineBreak;

/** A source document in `format`, from the 002 generators. */
function sourceDocument(format: Format, data: unknown, style: Style, g: Gen): string {
  const text = printDocument(data, format, style, g);
  return format === 'json5' && g(fc.boolean) ? json5Only(text, g) : text;
}

/** The token at `index` names a rule C1–C4 (string, key or number rewritten) for target `to`. */
function namedByC1toC4(text: string, t: Token, to: Format): boolean {
  if (to === 'json5') return false;
  if (t.kind === Kind.Unknown) return true;
  if (t.kind === Kind.StringLiteral) return !JSON_STRING.test(slice(text, t));
  if (t.kind === Kind.NumericLiteral) return !JSON_NUMBER.test(slice(text, t));
  return false;
}

/** For a comma at `i`, whether the next token that is not trivia or a comment closes a container. */
function trailingComma(tokens: readonly Token[], i: number): boolean {
  let j = i + 1;
  while (j < tokens.length && (isTrivia(tokens[j]!) || isComment(tokens[j]))) j++;
  const next = tokens[j];
  return next !== undefined && (next.kind === Kind.CloseBrace || next.kind === Kind.CloseBracket);
}

/** Defines `value` at `pointer` in `data` (no prototype setter for `__proto__`); returns the data. */
function setAt(data: unknown, pointer: string, value: unknown): unknown {
  if (pointer === '') return value;
  const tokens = pointer
    .slice(1)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  let node = data as Record<string, unknown>;
  for (const token of tokens.slice(0, -1)) node = node[token] as Record<string, unknown>;
  Object.defineProperty(node, tokens.at(-1)!, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  return data;
}

function check(input: string, from: Format, to: Format): void {
  const { text: out, losses } = convert(input, from, to);

  // Criterion 3.
  if (supersets.has(`${from}-${to}`)) {
    expect(out).toBe(input);
    expect(losses).toEqual([]);
    return;
  }

  // Criterion 4.
  const parsed = getAdapter(to).parse(out);
  expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  let want = getAdapter(from).parse(input).data;
  for (const loss of losses) {
    if (loss.kind === 'value') want = setAt(want, loss.path!, null);
  }
  expect(isDeepStrictEqual(parsed.data, want)).toBe(true);
  if (to === 'json') expect(strictJsonDiagnostics(out)).toEqual([]);

  // Criterion 5. To JSON, comments and trailing commas go (C5, C6) and white space before a comment
  // or on a line left blank may go (C5), so the other tokens are aligned; to JSONC every token is.
  const inTokens = tokensOf(input, from);
  const outTokens = tokensOf(out, to);
  const toJson = to === 'json';
  const kept = inTokens.filter(
    (t, i) =>
      !(toJson && (isTrivia(t) || isComment(t))) &&
      !(toJson && t.kind === Kind.Comma && trailingComma(inTokens, i)),
  );
  const written = toJson ? outTokens.filter((t) => !isTrivia(t)) : outTokens;
  expect(written.length).toBe(kept.length);
  kept.forEach((t, i) => {
    const before = slice(input, t);
    const after = slice(out, written[i]!);
    if (t.kind === Kind.Whitespace) {
      // C6: one space per JSON5-only white-space character.
      expect(after).toBe(before.replace(/[^ \t]/g, ' '));
    } else if (t.kind === Kind.LineBreak && (before === ' ' || before === ' ')) {
      expect(['\n', '\r\n']).toContain(after);
    } else if (!namedByC1toC4(input, t, to)) {
      expect(after).toBe(before);
    }
  });
  // Every comment loss is a comment token of the input, every value loss a number token.
  for (const loss of losses) {
    const t = inTokens.find((x) => x.offset === loss.offset)!;
    expect(t.end - t.offset).toBe(loss.length);
    expect(loss.kind === 'comment' ? isComment(t) : t.kind === Kind.NumericLiteral).toBe(true);
  }
}

describe('convert property suite (spec 006 criteria 3–5)', () => {
  for (const [from, to] of PAIRS) {
    it(`${from} to ${to}: ${RUNS} runs, seed ${SEED}`, () => {
      fc.assert(
        fc.property(dataArbitrary(from), styleArbitrary, fc.gen(), (data, style, g) => {
          check(sourceDocument(from, data, style, g), from, to);
        }),
        { seed: SEED, numRuns: RUNS },
      );
    }, 300_000);
  }
});

describe('convert with JSON Lines (spec 012 criterion 5)', () => {
  const targets: Format[] = ['json', 'jsonc', 'json5'];
  for (const to of targets) {
    it(`jsonl to ${to}: ${RUNS} runs, seed ${SEED}`, () => {
      fc.assert(
        fc.property(jsonlText, (input) => {
          const { text: out, losses } = convert(input, 'jsonl', to);
          expect(losses).toEqual([]);
          const parsed = getAdapter(to).parse(out);
          expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
          expect(isDeepStrictEqual(parsed.data, getAdapter('jsonl').parse(input).data)).toBe(true);
        }),
        { seed: SEED, numRuns: RUNS },
      );
    }, 300_000);
  }
  for (const from of targets) {
    it(`${from} to jsonl: ${RUNS} runs, seed ${SEED}`, () => {
      fc.assert(
        fc.property(
          dataArbitrary(from).filter(Array.isArray),
          styleArbitrary,
          fc.gen(),
          (data, style, g) => {
            const input = sourceDocument(from, data, style, g);
            const { text: out, losses } = convert(input, from, 'jsonl');
            const parsed = getAdapter('jsonl').parse(out);
            expect(parsed.diagnostics).toEqual([]);
            let want = getAdapter(from).parse(input).data;
            for (const loss of losses) {
              if (loss.kind === 'value') want = setAt(want, loss.path!, null);
            }
            expect(isDeepStrictEqual(parsed.data, want)).toBe(true);
          },
        ),
        { seed: SEED, numRuns: RUNS },
      );
    }, 300_000);
  }
});
