// 007 T1 gate, spec 007 criteria 1 and 2 (fast-check, seed committed in `arbitraries.ts`, 10 000
// runs each): `compare(a, b)` against `diff(a, b)`, and `copyDifference` applied to data with a
// plain reference applier. Pairs are either independent or `b` is a random edit of
// `a`, with few distinct scalars so arrays have many equally long alignments.
import { isDeepStrictEqual } from 'node:util';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  compare,
  copyDifference,
  diff,
  type CompareSide,
  type Difference,
  type PatchOperation,
} from '../src/index.js';
import { dataArbitrary, SEED } from './arbitraries.js';

const RUNS = 10_000;

type Gen = fc.GeneratorValue;

/** Keys `immutable-json-patch` 6.0.3 handles (see diff.property.test.ts). */
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

const keys = fc.constantFrom('a', 'b', 'c', 'x/y', 'm~n', '~1', '');
const small = fc.letrec<{ data: unknown }>((tie) => ({
  data: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.constantFrom(0, 1, 2, -0, NaN, null, true, 'a'),
    fc.array(tie('data'), { maxLength: 5 }),
    // `fc.dictionary` objects have a null prototype; data from a parser has Object's.
    fc.dictionary(keys, tie('data'), { maxKeys: 4 }).map((o) => ({ ...o })),
  ),
})).data;
const data = fc.oneof(small, dataArbitrary('json5').map(plain));

/** `b` as a random edit of `a`: values replaced, array items inserted, removed and changed, object
 *  members added, removed and changed, at any depth. */
function edit(a: unknown, g: Gen): unknown {
  const roll = g(fc.integer, { min: 0, max: 9 });
  if (roll === 0) return g(() => small);
  if (roll <= 3) return a;
  if (Array.isArray(a)) {
    const out: unknown[] = [];
    for (const item of a) {
      const step = g(fc.integer, { min: 0, max: 5 });
      if (step === 0) continue;
      if (step === 1) out.push(g(() => small));
      out.push(step === 2 ? edit(item, g) : item);
    }
    while (g(fc.boolean))
      out.splice(
        g(fc.integer, { min: 0, max: out.length }),
        0,
        g(() => small),
      );
    return out;
  }
  if (a !== null && typeof a === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(a)) {
      const step = g(fc.integer, { min: 0, max: 4 });
      if (step === 0) continue;
      out[k] = step === 1 ? edit(v, g) : v;
    }
    while (g(fc.boolean)) out[g(() => keys)] = g(() => small);
    return out;
  }
  return g(fc.boolean) ? a : g(() => small);
}

const pairs = fc.oneof(
  fc.tuple(data, data),
  fc.tuple(data, fc.gen()).map(([a, g]) => [a, edit(a, g)] as [unknown, unknown]),
);

/** The value at `path`, and whether it exists. */
function at(data: unknown, path: string): { found: boolean; value?: unknown } {
  let value = data;
  if (path === '') return { found: true, value };
  for (const raw of path.slice(1).split('/')) {
    const token = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(value)) {
      if (!/^(0|[1-9]\d*)$/.test(token) || Number(token) >= value.length) return { found: false };
      value = value[Number(token)];
    } else if (value !== null && typeof value === 'object' && Object.hasOwn(value, token))
      value = (value as Record<string, unknown>)[token];
    else return { found: false };
  }
  return { found: true, value };
}

/** Same data with every object's keys in a new order. */
function shuffleKeys(data: unknown, random: () => number): unknown {
  if (Array.isArray(data)) return data.map((x) => shuffleKeys(x, random));
  if (data !== null && typeof data === 'object') {
    const entries = Object.entries(data);
    for (let i = entries.length - 1; i > 0; i--) {
      const j = random() % (i + 1);
      [entries[i], entries[j]] = [entries[j]!, entries[i]!];
    }
    return Object.fromEntries(entries.map(([k, v]) => [k, shuffleKeys(v, random)]));
  }
  return data;
}

/** A small seeded generator (an LCG), cheaper than drawing each shuffle from fast-check. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) >>> 8;
}

/** Applies `add`, `remove` and `replace` to a copy of `data`. A plain reference rather than
 *  `immutable-json-patch`, which skips a `replace` of `0` by `-0` (they are `===`). */
function apply(data: unknown, patch: PatchOperation[]): unknown {
  let result = data;
  for (const op of patch) {
    if (op.op !== 'add' && op.op !== 'remove' && op.op !== 'replace') throw new Error(op.op);
    const value = op.op === 'remove' ? undefined : op.value;
    if (op.path === '') {
      result = value;
      continue;
    }
    const tokens = op.path
      .slice(1)
      .split('/')
      .map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));
    const write = (node: unknown, n: number): unknown => {
      const token = tokens[n]!;
      if (Array.isArray(node)) {
        const copy: unknown[] = [...(node as unknown[])];
        const index = Number(token);
        if (n < tokens.length - 1) copy[index] = write(copy[index], n + 1);
        else if (op.op === 'add') copy.splice(index, 0, value);
        else if (op.op === 'remove') copy.splice(index, 1);
        else copy[index] = value;
        return copy;
      }
      const copy: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as object))
        Object.defineProperty(copy, k, {
          value: v,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      if (n < tokens.length - 1) copy[token] = write(copy[token], n + 1);
      else if (op.op === 'remove') delete copy[token];
      else
        Object.defineProperty(copy, token, {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      return copy;
    };
    result = write(result, 0);
  }
  return result;
}

describe('criterion 1: compare(a, b)', () => {
  it(`is empty exactly when a and b are equal: ${RUNS} runs, seed ${SEED}`, () => {
    fc.assert(
      fc.property(pairs, ([a, b]) => {
        expect(compare(a, b).length === 0).toBe(isDeepStrictEqual(a, b));
        expect(compare(a, a)).toEqual([]);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  }, 300_000);

  it(`has one difference per operation of diff, each path resolving to diff's value: ${RUNS} runs, seed ${SEED}`, () => {
    fc.assert(
      fc.property(pairs, ([a, b]) => {
        const differences = compare(a, b);
        const patch = diff(a, b);
        expect(differences).toHaveLength(patch.length);
        // Replay the patch; each operation's difference names the value it removes or replaces
        // (in `a`) and the value it writes (in `b`).
        const kinds = { add: 'added', remove: 'removed', replace: 'changed' } as const;
        const unmatched = [...differences];
        let current = a;
        for (const op of patch) {
          if (op.op !== 'add' && op.op !== 'remove' && op.op !== 'replace') throw new Error(op.op);
          const before = op.op === 'add' ? undefined : at(current, op.path).value;
          const index = unmatched.findIndex(
            (d) =>
              d.kind === kinds[op.op] &&
              (d.leftPath === undefined ||
                (at(a, d.leftPath).found && isDeepStrictEqual(at(a, d.leftPath).value, before))) &&
              (d.rightPath === undefined ||
                (at(b, d.rightPath).found &&
                  Object.is(at(b, d.rightPath).value, (op as { value: unknown }).value))),
          );
          expect(
            index,
            `${JSON.stringify(op)} in ${JSON.stringify(differences)}`,
          ).toBeGreaterThanOrEqual(0);
          unmatched.splice(index, 1);
          current = apply(current, [op]);
        }
        for (const d of differences) {
          expect('leftPath' in d).toBe(d.kind !== 'added');
          expect('rightPath' in d).toBe(d.kind !== 'removed');
          if (d.leftPath !== undefined) expect(at(a, d.leftPath).found).toBe(true);
          if (d.rightPath !== undefined) expect(at(b, d.rightPath).found).toBe(true);
        }
      }),
      { seed: SEED, numRuns: RUNS },
    );
  }, 300_000);

  it(`ignores the key order of b: ${RUNS} runs, seed ${SEED}`, () => {
    fc.assert(
      fc.property(pairs, fc.nat(), ([a, b], seed) => {
        expect(compare(a, shuffleKeys(b, lcg(seed)))).toEqual(compare(a, b));
      }),
      { seed: SEED, numRuns: RUNS },
    );
  }, 300_000);

  // Few distinct items, so the alignment has many equally long choices.
  const item = fc.oneof(fc.integer({ min: 0, max: 3 }), small);
  const prefixes = ['', '/x', '/x/1/y'] as const;
  const wrap = (prefix: (typeof prefixes)[number], list: unknown[]): unknown =>
    prefix === '' ? list : prefix === '/x' ? { w: [1], x: list } : { x: [0, { y: list, z: 2 }] };
  const itemOf = (prefix: string) => new RegExp(`^${prefix.replace(/\//g, '\\/')}\\/\\d+$`);

  it(`b inserts items into an array of a: only those, added: ${RUNS} runs, seed ${SEED}`, () => {
    fc.assert(
      fc.property(
        fc.array(item, { maxLength: 12 }),
        fc.array(fc.tuple(fc.nat(), item), { minLength: 1, maxLength: 6 }),
        fc.constantFrom(...prefixes),
        (list, inserts, prefix) => {
          const longer = [...list];
          for (const [index, value] of inserts)
            longer.splice(index % (longer.length + 1), 0, value);
          const differences = compare(wrap(prefix, list), wrap(prefix, longer));
          expect(differences).toHaveLength(inserts.length);
          for (const d of differences) {
            expect(d.kind).toBe('added');
            expect(d.rightPath).toMatch(itemOf(prefix));
          }
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  }, 300_000);

  it(`b removes items of an array of a: only those, removed: ${RUNS} runs, seed ${SEED}`, () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(item, fc.boolean()), { minLength: 1, maxLength: 16 }),
        fc.constantFrom(...prefixes),
        (marked, prefix) => {
          fc.pre(marked.some(([, drop]) => drop));
          const list = marked.map(([value]) => value);
          const shorter = marked.filter(([, drop]) => !drop).map(([value]) => value);
          const differences = compare(wrap(prefix, list), wrap(prefix, shorter));
          expect(differences).toHaveLength(list.length - shorter.length);
          for (const d of differences) {
            expect(d.kind).toBe('removed');
            expect(d.leftPath).toMatch(itemOf(prefix));
          }
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  }, 300_000);
});

describe('criterion 2: copyDifference', () => {
  /** Copies `d` and checks the copy against criterion 2; returns both sides after the copy. */
  function check(a: unknown, b: unknown, d: Difference, from: CompareSide) {
    const [source, target] = from === 'right' ? [b, a] : [a, b];
    const patch = copyDifference(source, target, d, from);
    const copied = apply(target, patch);
    const [op] = patch;
    expect(patch).toHaveLength(1);
    // At d's location: the source's value, or nothing.
    const sourcePath = from === 'right' ? d.rightPath : d.leftPath;
    if (sourcePath === undefined) expect(op!.op).toBe('remove');
    else expect(Object.is(at(copied, op!.path).value, at(source, sourcePath).value)).toBe(true);
    // Elsewhere: unchanged, so undoing the one operation gives the target back.
    const undo: PatchOperation =
      op!.op === 'add'
        ? { op: 'remove', path: op!.path }
        : op!.op === 'remove'
          ? { op: 'add', path: op!.path, value: at(target, op!.path).value }
          : { op: 'replace', path: op!.path, value: at(target, op!.path).value };
    expect(isDeepStrictEqual(apply(copied, [undo]), target)).toBe(true);
    const [left, right] = from === 'right' ? [copied, b] : [a, copied];
    return { left, right };
  }

  for (const from of ['right', 'left'] as const) {
    it(`copying one difference from the ${from} changes the target only there: ${RUNS} runs, seed ${SEED}`, () => {
      fc.assert(
        fc.property(pairs, fc.nat(), ([a, b], pick) => {
          const differences = compare(a, b);
          fc.pre(differences.length > 0);
          check(a, b, differences[pick % differences.length]!, from);
        }),
        { seed: SEED, numRuns: RUNS },
      );
    }, 300_000);

    // UNK-039: a copy can change how the arrays around it align, so the count does not always drop
    // by exactly one; copying one difference at a time still ends with equal sides.
    it(`copying differences from the ${from} one at a time ends equal within 2n copies: ${RUNS} runs, seed ${SEED}`, () => {
      fc.assert(
        fc.property(pairs, fc.boolean(), fc.nat(), ([a, b], first, seed) => {
          let sides = { left: a, right: b };
          const total = compare(a, b).length;
          let copies = 0;
          for (let differences = compare(a, b); differences.length > 0; copies++) {
            expect(copies, 'copies').toBeLessThan(2 * total);
            const d = differences[first ? 0 : (seed + copies) % differences.length]!;
            sides = check(sides.left, sides.right, d, from);
            differences = compare(sides.left, sides.right);
          }
          expect(isDeepStrictEqual(sides.left, sides.right)).toBe(true);
          expect(
            isDeepStrictEqual(
              from === 'right' ? sides.right : sides.left,
              from === 'right' ? b : a,
            ),
          ).toBe(true);
        }),
        { seed: SEED, numRuns: RUNS },
      );
    }, 300_000);
  }
});
