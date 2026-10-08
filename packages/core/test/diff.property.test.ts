// 002 T9 gate, spec 002 criterion 9: for random pairs (a, b) (fast-check, seed committed in
// `arbitraries.ts`), applying `diff(a, b)` to `a` deep-equals `b`; for arrays where `b` inserts or
// removes items of `a`, the patch contains only those `add`/`remove` ops.
//
// "Applying" is checked twice: on data with `immutable-json-patch` (the reference), and on text with
// each format's `applyPatch`, which is how data-level actions use the diff (R14). Pairs are either
// independent or `b` is a random edit of `a`, since independent pairs mostly differ at the root.
import { isDeepStrictEqual } from 'node:util';
import fc from 'fast-check';
import { immutableJSONPatch, type JSONPatchDocument } from 'immutable-json-patch';
import { describe, expect, it } from 'vitest';
import { commonSubsequence } from '../src/diff.js';
import { diff, getAdapter, stringify, type Format } from '../src/index.js';
import { dataArbitrary, SEED, styleArbitrary } from './arbitraries.js';

const RUNS = 10_000;
const TEXT_RUNS = RUNS;

type Gen = fc.GeneratorValue;

/** Data without the members `immutable-json-patch` 6.0.3 mishandles: prototype-named keys (it uses
 *  plain property access) and a `-` key in objects (it reads it as "append"); see
 *  patch.property.test.ts. The text-level property keeps them. */
const usable = (key: string) => !(key in Object.prototype) && key !== '-';

function plain(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(plain);
  if (data !== null && typeof data === 'object') {
    const object: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) if (usable(k)) object[k] = plain(v);
    return object;
  }
  return data;
}

/** An own enumerable member, `__proto__` included. */
function define(object: Record<string, unknown>, key: string, value: unknown) {
  Object.defineProperty(object, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/** `b` as a random edit of `a`: values replaced, array items inserted, removed and changed, object
 *  members added, removed and changed, at any depth. */
function edit(
  a: unknown,
  fresh: fc.Arbitrary<unknown>,
  keys: fc.Arbitrary<string>,
  g: Gen,
): unknown {
  const roll = g(fc.integer, { min: 0, max: 9 });
  if (roll === 0) return g(() => fresh);
  if (roll <= 3) return a;
  if (Array.isArray(a)) {
    const out: unknown[] = [];
    for (const item of a) {
      const step = g(fc.integer, { min: 0, max: 5 });
      if (step === 0) continue; // removed
      if (step === 1) out.push(g(() => fresh)); // inserted before
      out.push(step === 2 ? edit(item, fresh, keys, g) : item);
    }
    while (g(fc.boolean))
      out.splice(
        g(fc.integer, { min: 0, max: out.length }),
        0,
        g(() => fresh),
      );
    return out;
  }
  if (a !== null && typeof a === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(a)) {
      const step = g(fc.integer, { min: 0, max: 4 });
      if (step === 0) continue; // removed
      define(out, k, step === 1 ? edit(v, fresh, keys, g) : v);
    }
    while (g(fc.boolean))
      define(
        out,
        g(() => keys),
        g(() => fresh),
      );
    return out;
  }
  return g(fc.boolean) ? a : g(() => fresh);
}

const keyArbitrary = fc.oneof(fc.constantFrom('a', 'b', 'c', 'x/y', 'm~n', '~1', ''), fc.string());

function pairArbitrary(data: fc.Arbitrary<unknown>, keys: fc.Arbitrary<string>) {
  return fc.oneof(
    fc.tuple(data, data),
    fc.tuple(data, fc.gen()).map(([a, g]) => [a, edit(a, data, keys, g)] as [unknown, unknown]),
  );
}

/** Equal as data, with -0 and 0 the same number (JSON and JSONC write -0 as `0`, R8). */
function sameData(a: unknown, b: unknown): boolean {
  const normal = (x: unknown): unknown =>
    Object.is(x, -0)
      ? 0
      : Array.isArray(x)
        ? x.map(normal)
        : x !== null && typeof x === 'object'
          ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, normal(v)]))
          : x;
  return isDeepStrictEqual(normal(a), normal(b));
}

describe('criterion 9: applying diff(a, b) to a gives b', () => {
  it(`data, immutable-json-patch: ${RUNS} runs, seed ${SEED}`, () => {
    const data = dataArbitrary('json5').map(plain);
    const keys = keyArbitrary.filter(usable);
    fc.assert(
      fc.property(pairArbitrary(data, keys), ([a, b]) => {
        const patch = diff(a, b);
        const result = immutableJSONPatch(a, patch as JSONPatchDocument);
        expect(isDeepStrictEqual(result, b), JSON.stringify(patch)).toBe(true);
        if (isDeepStrictEqual(a, b)) expect(patch).toEqual([]);
        for (const op of patch) expect(['add', 'remove', 'replace']).toContain(op.op);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  }, 300_000);

  for (const format of ['json', 'jsonc', 'json5'] as const satisfies Format[]) {
    it(`text, ${format} applyPatch: ${TEXT_RUNS} runs, seed ${SEED}`, () => {
      const adapter = getAdapter(format);
      fc.assert(
        fc.property(
          pairArbitrary(dataArbitrary(format), keyArbitrary),
          styleArbitrary,
          ([a, b], style) => {
            const text = stringify(a, format, style);
            const before = adapter.parse(text).data;
            const patch = diff(before, b);
            const output = adapter.applyPatch(text, patch);
            const result = adapter.parse(output);
            expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
            const same = format === 'json5' ? isDeepStrictEqual : sameData;
            if (!same(result.data, b))
              expect(result.data, `${JSON.stringify(patch)}\n${text}\n=>\n${output}`).toEqual(b);
          },
        ),
        { seed: SEED, numRuns: TEXT_RUNS },
      );
    }, 300_000);
  }
});

describe('criterion 9: inserts and removes only', () => {
  // Few distinct items, so the LCS has many equally long choices.
  const item = fc.oneof(fc.integer({ min: 0, max: 3 }), dataArbitrary('json').map(plain));
  const prefixes = ['', '/x', '/x/1/y'] as const;
  const wrap = (prefix: (typeof prefixes)[number], list: unknown[]): unknown =>
    prefix === '' ? list : prefix === '/x' ? { w: [1], x: list } : { x: [0, { y: list, z: 2 }] };
  const indexOp = (prefix: string) => new RegExp(`^${prefix.replace(/\//g, '\\/')}\\/\\d+$`);

  it(`b inserts items into a: only those adds, ${RUNS} runs, seed ${SEED}`, () => {
    fc.assert(
      fc.property(
        fc.array(item, { maxLength: 12 }),
        fc.array(fc.tuple(fc.nat(), item), { minLength: 1, maxLength: 6 }),
        fc.constantFrom(...prefixes),
        (list, inserts, prefix) => {
          const longer = [...list];
          for (const [at, value] of inserts) longer.splice(at % (longer.length + 1), 0, value);
          const a = wrap(prefix, list);
          const b = wrap(prefix, longer);
          const patch = diff(a, b);
          expect(patch).toHaveLength(inserts.length);
          for (const op of patch) {
            expect(op.op).toBe('add');
            expect(op.path).toMatch(indexOp(prefix));
          }
          expect(isDeepStrictEqual(immutableJSONPatch(a, patch as JSONPatchDocument), b)).toBe(
            true,
          );
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  }, 300_000);

  it(`b removes items of a: only those removes, ${RUNS} runs, seed ${SEED}`, () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(item, fc.boolean()), { minLength: 1, maxLength: 16 }),
        fc.constantFrom(...prefixes),
        (marked, prefix) => {
          fc.pre(marked.some(([, drop]) => drop));
          const list = marked.map(([value]) => value);
          const shorter = marked.filter(([, drop]) => !drop).map(([value]) => value);
          const a = wrap(prefix, list);
          const b = wrap(prefix, shorter);
          const patch = diff(a, b);
          expect(patch).toHaveLength(list.length - shorter.length);
          for (const op of patch) {
            expect(op.op).toBe('remove');
            expect(op.path).toMatch(indexOp(prefix));
          }
          expect(isDeepStrictEqual(immutableJSONPatch(a, patch as JSONPatchDocument), b)).toBe(
            true,
          );
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  }, 300_000);
});

describe('commonSubsequence is a longest common subsequence', () => {
  /** LCS length by the textbook O(NM) table. */
  function lcsLength(a: number[], b: number[]): number {
    const row = new Array<number>(b.length + 1).fill(0);
    for (const x of a) {
      let diagonal = 0;
      for (let j = 1; j <= b.length; j++) {
        const above = row[j]!;
        row[j] = x === b[j - 1] ? diagonal + 1 : Math.max(row[j]!, row[j - 1]!);
        diagonal = above;
      }
    }
    return row[b.length]!;
  }

  it(`matches the table: ${RUNS} runs, seed ${SEED}`, () => {
    const list = fc.array(fc.integer({ min: 0, max: 4 }), { maxLength: 30 });
    fc.assert(
      fc.property(list, list, (a, b) => {
        const pairs = commonSubsequence(a, b);
        expect(pairs).toHaveLength(lcsLength(a, b));
        pairs.forEach(([i, j], n) => {
          expect(a[i]).toBe(b[j]);
          if (n > 0) {
            expect(i).toBeGreaterThan(pairs[n - 1]![0]);
            expect(j).toBeGreaterThan(pairs[n - 1]![1]);
          }
        });
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});
