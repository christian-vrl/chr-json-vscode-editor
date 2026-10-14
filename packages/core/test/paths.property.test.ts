// Spec 018 criteria 3 and 4 (018 T1), fast-check with the committed seed. Criterion 3: for any
// data and any node in it, reading the node's P1 and P2 text back (P3, against that data) gives
// its path (P4), and both texts match their grammars. Its engine check (json-p3) is app-shell's
// test/paths-engine.property.test.ts (018 T2), on the same arbitrary and seed.
// Criterion 4: for any document core's `stringify` writes, `nodeAt` at the place of every node
// gives that node (R3), every offset gives a node with a place, and neither function adds an entry
// to core's parse cache.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  cachedParseTexts,
  jsonPath,
  jsonPointer,
  nodeAt,
  placeOf,
  readPath,
  releaseParse,
  stringify,
  type Format,
  type PathStep,
} from '../src/index.js';
import { tokenize } from '../src/formats/tokens.js';
import { dataArbitrary, SEED, styleArbitrary } from './arbitraries.js';
import { dataAndPath, hasLoneSurrogate, nodePaths } from './path-arbitraries.js';

const RUNS = Number(process.env.PATHS_RUNS ?? 10_000);
const MAX_TEXT = 300;

// RFC 9535 §2.7 normalized paths, with `.name` for member-name-shorthand (§2.5.1.1). A lone
// surrogate cannot be written in that grammar; P1 writes it as `\uxxxx`, lowercase (LONE).
const SHORTHAND =
  '\\.[A-Za-z_\\u0080-\\ud7ff\\ue000-\\u{10ffff}][0-9A-Za-z_\\u0080-\\ud7ff\\ue000-\\u{10ffff}]*';
const NORMAL_CHAR =
  "[\\u0020-\\u0026\\u0028-\\u005b\\u005d-\\ud7ff\\ue000-\\u{10ffff}]|\\\\[bfnrt'\\\\]|\\\\u00(?:0[0-7]|0b|0e|0f|1[0-9a-f])";
const LONE = '|\\\\ud[89a-f][0-9a-f]{2}';
const p1Grammar = (lone: boolean) =>
  new RegExp(
    `^\\$(?:\\[(?:0|[1-9][0-9]*)\\]|${SHORTHAND}|\\['(?:${NORMAL_CHAR}${lone ? LONE : ''})*'\\])*$`,
    'u',
  );
// RFC 6901 §3: `*( "/" reference-token )`, `~` only as `~0` or `~1`.
const P2_GRAMMAR = /^(?:\/(?:[^/~]|~[01])*)*$/;

describe('path text (spec 018 criterion 3)', () => {
  it(`P1 and P2 read back to the path and match their grammars: ${RUNS} runs, seed ${SEED}`, () => {
    const strict = p1Grammar(false);
    const lone = p1Grammar(true);
    fc.assert(
      fc.property(dataAndPath, ([data, path]) => {
        const p1 = jsonPath(path);
        const p2 = jsonPointer(path);
        expect(readPath(p1, data)).toEqual({ path });
        expect(readPath(p2, data)).toEqual({ path });
        const surrogate = path.some((s) => typeof s === 'string' && hasLoneSurrogate(s));
        expect(p1).toMatch(surrogate ? lone : strict);
        expect(p2).toMatch(P2_GRAMMAR);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('reaches depth 64 and lone surrogates in the runs', () => {
    const sample = fc.sample(dataAndPath, { seed: SEED, numRuns: RUNS });
    expect(Math.max(...sample.map(([, path]) => path.length))).toBe(64);
    expect(
      sample.some(([, path]) => path.some((s) => typeof s === 'string' && hasLoneSurrogate(s))),
    ).toBe(true);
  });
});

/** Comments between some tokens of a JSONC text (`pick` chooses where and which). */
function withComments(text: string, picks: number[]): string {
  let out = '';
  let from = 0;
  tokenize(text).forEach((token, i) => {
    const pick = picks[i % picks.length]!;
    out += text.slice(from, token.offset);
    if (pick === 1) out += '/* c */';
    else if (pick === 2) out += '// c\n';
    from = token.offset;
  });
  return out + text.slice(from);
}

/** A document of `format` as core's `stringify` writes it, with comments in `jsonc`. */
function documentArbitrary(format: Format): fc.Arbitrary<{ data: unknown; text: string }> {
  const data =
    format === 'jsonl' ? fc.array(dataArbitrary('json'), { maxLength: 5 }) : dataArbitrary(format);
  return (
    fc
      .tuple(
        data,
        styleArbitrary,
        fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 1, maxLength: 8 }),
      )
      .map(([d, style, picks]) => {
        const text = stringify(d, format, style);
        return { data: d, text: format === 'jsonc' ? withComments(text, picks) : text };
      })
      // Every offset costs a scan up to it, so a run costs the square of the text's length: texts
      // up to 300 code units (most of the generated ones) keep 10 000 runs per format quick.
      .filter(({ text }) => text.length <= MAX_TEXT)
  );
}

const blankLine = (text: string) => /(?:^|\n)[ \t]*(?:\r?\n|$)/.test(text.replace(/^\ufeff/, ''));

describe('round trip (spec 018 criterion 4)', () => {
  for (const format of ['json', 'jsonc', 'json5', 'jsonl'] as const) {
    it(`${format}: nodeAt(placeOf(p)) is p, every offset has a node with a place: ${RUNS} runs, seed ${SEED}`, () => {
      releaseParse();
      fc.assert(
        fc.property(documentArbitrary(format), ({ data, text }) => {
          // Plain checks in the loops: `expect` per offset is most of the run time.
          const same = (a: readonly PathStep[], b: readonly PathStep[]) =>
            a.length === b.length && a.every((step, i) => step === b[i]);
          for (const path of nodePaths(data)) {
            const place = placeOf(format, text, path);
            if (place === undefined) throw new Error(`no place for ${jsonPointer(path)}`);
            // In JSON Lines only a blank line gives the root (A5); with none, no offset does.
            if (format === 'jsonl' && path.length === 0 && !blankLine(text)) continue;
            const node = nodeAt(format, text, place);
            if (!('path' in node) || !same(node.path, path))
              throw new Error(
                `node at ${place} is not ${jsonPointer(path)}: ${JSON.stringify(node)}`,
              );
          }
          for (let offset = 0; offset <= text.length; offset++) {
            const node = nodeAt(format, text, offset);
            if (!('path' in node)) throw new Error(`no node at ${offset}: ${node.error.message}`);
            if (placeOf(format, text, node.path) === undefined)
              throw new Error(`no place for the node at ${offset}, ${jsonPointer(node.path)}`);
          }
          expect(cachedParseTexts()).toEqual([]);
        }),
        { seed: SEED, numRuns: RUNS },
      );
    }, 120_000);
  }
});
