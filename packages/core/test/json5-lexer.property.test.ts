// The JSON5 lexer that core's locating reads (spec 018, `Json5Lexer`) takes the ASCII tokens large
// documents are made of from character codes (018 T4, criterion 11's speed) and the rest with the
// JSON5 parser's own methods. Both ways must read the same tokens and the same errors: for any
// text over JSON5's characters and any sequence of "a member name may come next" flags, the lexer
// with and without the fast path gives the same tokens up to the first error, that one included,
// but for white space: the fast path reads a run of ASCII white space and line breaks as one
// token, so adjacent white space and line break tokens are compared as one.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Json5Lexer } from '../src/formats/json5-parser.js';
import { Kind } from '../src/formats/tokens.js';
import { SEED } from './arbitraries.js';

const RUNS = Number(process.env.PATHS_RUNS ?? 10_000);

/** Pieces of JSON5 text, the fast path's edges among them: numbers it reads and numbers it leaves
 *  to the parser, identifiers with escapes and non-ASCII characters, every kind of white space. */
const PIECES = [
  '{',
  '}',
  '[',
  ']',
  ',',
  ':',
  ' ',
  '  ',
  '\t',
  '\v',
  '\f',
  ' ',
  '﻿',
  ' ',
  '\n',
  '\r',
  '\r\n',
  ' ',
  ' ',
  '// c\n',
  '/* c */',
  '/*',
  '/',
  '0',
  '00',
  '-0',
  '1',
  '12',
  '-12',
  '1.5',
  '1.',
  '.5',
  '1e5',
  '1E-5',
  '1.5e+3',
  '0x1F',
  '0X',
  '+1',
  '-',
  'Infinity',
  '-Infinity',
  'NaN',
  'null',
  'true',
  'false',
  'nul',
  'a',
  'ab1',
  '$_',
  '_',
  'é',
  '\\u0061',
  '\\u00',
  '\\',
  '1a',
  '1$',
  '"s"',
  "'s'",
  '"',
  "'",
  '"\\n"',
  "'a\\'b'",
  '"\\u0041"',
  'x',
  '7',
];

const text = fc
  .array(fc.oneof(fc.constantFrom(...PIECES), fc.string({ maxLength: 3 })), { maxLength: 30 })
  .map((parts) => parts.join(''));

interface Read {
  kind: number;
  offset: number;
  end: number;
  name: string | undefined;
  error: { message: string; offset: number } | undefined;
}

const space = (kind: number) => kind === Kind.Whitespace || kind === Kind.LineBreak;

/**
 * The tokens `lexer` reads, up to the end or the first error, adjacent white space and line
 * breaks as one `Whitespace` token. Each token but white space takes the next of `keys` (cycled):
 * white space reads the same with either flag.
 */
function read(lexer: Json5Lexer, keys: boolean[]): Read[] {
  const out: Read[] = [];
  for (let i = 0; ;) {
    const { kind, offset, end, name, error } = lexer.next(keys[i % keys.length]!);
    const last = out.at(-1);
    if (!error && space(kind) && last?.kind === Kind.Whitespace && last.end === offset) {
      last.end = end;
      continue;
    }
    if (!space(kind)) i++;
    out.push({
      kind: space(kind) && !error ? Kind.Whitespace : kind,
      offset,
      end,
      name,
      error: error && { ...error },
    });
    if (kind === Kind.EOF || error) return out;
    if (out.length > 1000) throw new Error('the lexer does not advance');
  }
}

describe('the JSON5 lexer reads the same tokens with and without its ASCII fast path', () => {
  it(`over JSON5 pieces and any key flags: ${RUNS} runs, seed ${SEED}`, () => {
    fc.assert(
      fc.property(text, fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }), (t, keys) => {
        expect(read(new Json5Lexer(t), keys)).toEqual(read(new Json5Lexer(t, false), keys));
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it("reads the bench's JSON5 records the same both ways", () => {
    const record =
      "  // record 1\n  {\n    id: 1,\n    name: 'alpha-1', /* display name */\n" +
      "    active: true,\n    score: 11.31,\n    flags: 0x01,\n    tags: ['alpha', 'delta',],\n" +
      '    note: null,\n  }';
    const doc = `[\n${record},\n${record},\n]\n`;
    const keys = [true, false];
    expect(read(new Json5Lexer(doc), keys)).toEqual(read(new Json5Lexer(doc, false), keys));
  });
});
