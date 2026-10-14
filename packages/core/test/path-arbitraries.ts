// Data with one of its nodes' paths, for spec 018 criterion 3 (018 T1's path text suite here and
// 018 T2's engine check in app-shell, "same runs": the same arbitrary and seed).
import fc from 'fast-check';
import type { PathStep } from '../src/index.js';
import { dataArbitrary } from './arbitraries.js';

/** Every node's path in `data`, the root first, in document order. */
export function nodePaths(
  data: unknown,
  prefix: PathStep[] = [],
  out: PathStep[][] = [],
): PathStep[][] {
  out.push(prefix);
  if (Array.isArray(data)) data.forEach((item, i) => nodePaths(item, [...prefix, i], out));
  else if (data !== null && typeof data === 'object')
    for (const key of Object.keys(data))
      nodePaths((data as Record<string, unknown>)[key], [...prefix, key], out);
  return out;
}

/** Names of any string, lone surrogates included, beside those the corpus tags name. */
const name = fc.oneof(
  fc.string({ unit: 'binary', maxLength: 6 }),
  fc.string({
    unit: fc.integer({ min: 0, max: 0xffff }).map((c) => String.fromCharCode(c)),
    maxLength: 4,
  }),
  fc.constantFrom(
    '',
    '0',
    '01',
    '-1',
    'a.b',
    "it's",
    '\\',
    '~',
    '/',
    '~0~1',
    '$',
    '@',
    '*',
    '__proto__',
  ),
);

/** A chain of 1 to 64 steps (the criterion's depth), with a sibling beside each name: the data
 *  and the chain's path. */
const deep = fc
  .integer({ min: 1, max: 64 })
  .chain((depth) =>
    fc.tuple(
      fc.array(fc.oneof(name, fc.integer({ min: 0, max: 3 })), {
        minLength: depth,
        maxLength: depth,
      }),
      fc.array(name, { minLength: depth, maxLength: depth }),
    ),
  )
  .map(([steps, siblings]) => {
    let data: unknown = null;
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i]!;
      if (typeof step === 'number') {
        const array: unknown[] = Array.from({ length: step + 1 }, () => 0);
        array[step] = data;
        data = array;
      } else {
        const object: Record<string, unknown> = {};
        const define = (key: string, value: unknown) =>
          Object.defineProperty(object, key, {
            value,
            writable: true,
            enumerable: true,
            configurable: true,
          });
        define(siblings[i]!, 1);
        define(step, data);
        data = object;
      }
    }
    return { data, path: steps };
  });

/** Data with one of its nodes' paths: the end of a deep chain, or any node of either kind. */
export const dataAndPath: fc.Arbitrary<[unknown, PathStep[]]> = fc.oneof(
  deep.map(({ data, path }): [unknown, PathStep[]] => [data, path]),
  fc
    .oneof(
      dataArbitrary('json5'),
      deep.map(({ data }) => data),
    )
    .chain((data) => fc.tuple(fc.constant(data), fc.constantFrom(...nodePaths(data)))),
);

export const hasLoneSurrogate = (s: string) =>
  /(?:[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff])/.test(s);
