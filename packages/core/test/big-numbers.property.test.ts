// 015 T2 gate, spec 015 criterion 2: for 10 000 documents per format (seed committed in
// `arbitraries.ts`) whose numbers come from a big-number generator (integers of 16–40 digits,
// decimals of 16–40 significant digits, exponents up to ±1000, mixed with plain numbers),
// `parse(text).data`, the tree's number nodes and `parseData(format, text)` hold a `LosslessNumber`
// exactly where the text has a big number, with `value` equal to its decimal text, and today's
// number elsewhere; `parse(stringify(x, format, style)).data` equals `x` (spec 002 criterion 6 with
// big numbers, read as `read-back.ts` says); and spec 008 criterion 6 still holds on these texts.
//
// The expected data is built from each token independently of core (big-number-arbitrary.ts).
import { isDeepStrictEqual } from 'node:util';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { getAdapter, parseData, stringify, type Format, type FormatNode } from '../src/index.js';
import { SEED, styleArbitrary } from './arbitraries.js';
import {
  dataOf,
  isLeaf,
  json5Leaf,
  jsonLeaf,
  leavesOf,
  shapeArbitrary,
  type Shape,
} from './big-number-arbitrary.js';
import { expectAgrees } from './parse-data-agrees.js';
import { readBack } from './read-back.js';

const RUNS = 10_000;
const formats = ['json', 'jsonc', 'json5', 'jsonl'] as const;

const SEPARATORS = [', ', ',\n  ', ','];

/** The shape as text in `format`, its layout and comments drawn from `g`. JSON Lines items stay on
 *  one line each. */
function print(shape: Shape, format: Format, g: fc.GeneratorValue, oneLine = false): string {
  const comment = () =>
    (format === 'jsonc' || format === 'json5') && g(fc.integer, { min: 1, max: 6 }) === 1
      ? ' /* c */ '
      : '';
  const sep = oneLine ? ', ' : SEPARATORS[g(fc.integer, { min: 0, max: SEPARATORS.length - 1 })]!;
  if (isLeaf(shape)) return shape.token;
  if (Array.isArray(shape))
    return `[${comment()}${shape.map((s) => print(s, format, g, oneLine) + comment()).join(sep)}]`;
  const name = (k: string) =>
    format === 'json5' && /^[a-z]\w*$/i.test(k) && g(fc.boolean) ? k : JSON.stringify(k);
  const members = shape.entries.map(
    ([k, v]) => `${comment()}${name(k)}: ${comment()}${print(v, format, g, oneLine)}`,
  );
  return `{${members.join(sep)}${members.length && format === 'json5' && g(fc.boolean) ? ',' : ''}}`;
}

/** The number nodes' values, in document order. */
function numberNodes(node: FormatNode | undefined): unknown[] {
  if (!node) return [];
  if (node.type === 'number') return [node.value];
  return (node.children ?? []).flatMap(numberNodes);
}

function expectSame(actual: unknown, expected: unknown, label: string): void {
  if (!isDeepStrictEqual(actual, expected)) expect(actual, label).toEqual(expected);
  expect(isDeepStrictEqual(actual, expected), label).toBe(true);
}

describe('criterion 2: big numbers read and written exactly', () => {
  for (const format of formats) {
    it(`${format}: ${RUNS} documents, seed ${SEED}`, () => {
      const leaf = format === 'json5' ? json5Leaf : jsonLeaf;
      const document =
        format === 'jsonl'
          ? fc.array(shapeArbitrary(leaf), { minLength: 1, maxLength: 4 })
          : shapeArbitrary(leaf);
      fc.assert(
        fc.property(document, styleArbitrary, fc.gen(), (shape, style, g) => {
          const text =
            format === 'jsonl'
              ? (shape as Shape[]).map((item) => `${print(item, 'json', g, true)}\n`).join('')
              : print(shape, format, g);
          const data = dataOf(shape);
          const label = `${format}: ${text}`;

          const parsed = getAdapter(format).parse(text);
          expect(
            parsed.diagnostics.filter((d) => d.severity === 'error'),
            label,
          ).toEqual([]);
          expectSame(parsed.data, data, label);
          expectSame(
            numberNodes(parsed.tree),
            leavesOf(format === 'jsonl' ? (shape as Shape[]) : shape).map((l) => l.data),
            label,
          );
          expectSame(parseData(format, text), { data }, label);
          // Spec 008 criterion 6 on the same text, and on one with a digit taken out.
          expectAgrees(format, text);
          const at = text.search(/\d{16}/);
          if (at >= 0) expectAgrees(format, text.slice(0, at + 8) + text.slice(at + 9));

          // Spec 002 criterion 6 with big numbers; JSON and JSONC hold no non-finite number.
          const written = stringify(data, format, style);
          expectSame(
            getAdapter(format).parse(written).data,
            readBack(data),
            `${label} → ${written}`,
          );
        }),
        { seed: SEED, numRuns: RUNS },
      );
    }, 300_000);
  }
});
