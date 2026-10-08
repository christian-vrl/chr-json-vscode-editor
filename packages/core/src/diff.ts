// Structural diff (002 T9, spec 002 criterion 9): `diff(a, b)` is an RFC 6902 patch that turns data
// `a` into data `b`. Data-level actions apply it to the document's text with `applyPatch`, so every
// member that survives keeps its comments and style (R14); spec 007's compare reuses it.
//
// Objects: keys only in `a` are removed, keys only in `b` are added (appended, R2), shared keys are
// diffed in place. Arrays: a longest common subsequence of deep-equal items stays put (Myers'
// linear-space O((N+M)D) algorithm); in each gap between kept items, removed and added items are
// paired by position and diffed in place, so a changed item keeps its comments, and the rest become
// `remove` and `add`. When `b` only inserts or only removes items of `a`, the patch is exactly those
// inserts or removes. Anything else that differs is one `replace`.
//
// Equality is `node:util` `isDeepStrictEqual` on data: key order is ignored, `NaN` equals `NaN`,
// `-0` differs from `0`.
import type { PatchOperation } from './formats/types.js';

/**
 * The operations that turn `a` into `b`, to apply in order. Only `add`, `remove` and `replace`;
 * array inserts use explicit indices, never `-`. Values in the patch are `b`'s own sub-values, not
 * copies. `diff(a, a)` is `[]`.
 */
export function diff(a: unknown, b: unknown): PatchOperation[] {
  const ops: PatchOperation[] = [];
  const keys = new WeakMap<object, string>();
  const keyOf = (x: unknown) => canonical(x, keys);
  if (keyOf(a) !== keyOf(b)) diffValue(a, b, '', ops, keyOf);
  return ops;
}

type KeyOf = (x: unknown) => string;

/** Appends the operations for unequal values `a` and `b` at `path`. */
function diffValue(a: unknown, b: unknown, path: string, ops: PatchOperation[], keyOf: KeyOf) {
  if (Array.isArray(a) && Array.isArray(b)) diffArray(a, b, path, ops, keyOf);
  else if (isObject(a) && isObject(b)) diffObject(a, b, path, ops, keyOf);
  else ops.push({ op: 'replace', path, value: b });
}

function diffObject(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  path: string,
  ops: PatchOperation[],
  keyOf: KeyOf,
) {
  for (const key of Object.keys(a))
    if (!hasOwn(b, key)) ops.push({ op: 'remove', path: `${path}/${escape(key)}` });
  for (const key of Object.keys(a))
    if (hasOwn(b, key) && keyOf(a[key]) !== keyOf(b[key]))
      diffValue(a[key], b[key], `${path}/${escape(key)}`, ops, keyOf);
  for (const key of Object.keys(b))
    if (!hasOwn(a, key)) ops.push({ op: 'add', path: `${path}/${escape(key)}`, value: b[key] });
}

function diffArray(
  a: readonly unknown[],
  b: readonly unknown[],
  path: string,
  ops: PatchOperation[],
  keyOf: KeyOf,
) {
  // Items as numbers, equal numbers for deep-equal items, so the LCS compares integers.
  const ids = new Map<string, number>();
  const id = (x: unknown) => {
    const key = keyOf(x);
    let n = ids.get(key);
    if (n === undefined) ids.set(key, (n = ids.size));
    return n;
  };
  const kept = commonSubsequence(a.map(id), b.map(id));
  kept.push([a.length, b.length]);

  // `at` is the index in the array as the operations so far left it.
  let at = 0;
  let i = 0;
  let j = 0;
  for (const [nextI, nextJ] of kept) {
    const removed = nextI - i;
    const added = nextJ - j;
    const paired = Math.min(removed, added);
    for (let t = 0; t < paired; t++, at++)
      diffValue(a[i + t], b[j + t], `${path}/${at}`, ops, keyOf);
    for (let t = paired; t < removed; t++) ops.push({ op: 'remove', path: `${path}/${at}` });
    for (let t = paired; t < added; t++, at++)
      ops.push({ op: 'add', path: `${path}/${at}`, value: b[j + t] });
    at++; // the kept item (one past the end for the closing sentinel)
    i = nextI + 1;
    j = nextJ + 1;
  }
}

/**
 * Index pairs `[i, j]` with `a[i] === b[j]`, increasing in both, of a longest common subsequence.
 * Myers 1986, "An O(ND) Difference Algorithm and Its Variations", §4b: linear space, the middle
 * snake splits the box in two until a side is empty.
 */
export function commonSubsequence(a: readonly number[], b: readonly number[]): [number, number][] {
  const pairs: [number, number][] = [];
  const size = a.length + b.length + 2;
  const forward = new Int32Array(2 * size + 1);
  const backward = new Int32Array(2 * size + 1);

  /** The middle snake of box [a0, a1) × [b0, b1) as [x, y, u, v]: from (x, y) to (u, v). */
  const middleSnake = (a0: number, a1: number, b0: number, b1: number) => {
    const n = a1 - a0;
    const m = b1 - b0;
    const delta = n - m;
    const odd = (delta & 1) !== 0;
    const max = Math.ceil((n + m) / 2);
    // Diagonal k = x - y is stored at index size + k. `backward` runs on the reversed box, where
    // its diagonal k is the forward diagonal delta - k.
    forward[size + 1] = 0;
    backward[size + 1] = 0;
    for (let d = 0; d <= max; d++) {
      for (let k = -d; k <= d; k += 2) {
        let x =
          k === -d || (k !== d && forward[size + k - 1]! < forward[size + k + 1]!)
            ? forward[size + k + 1]!
            : forward[size + k - 1]! + 1;
        let y = x - k;
        const x0 = x;
        const y0 = y;
        while (x < n && y < m && a[a0 + x] === b[b0 + y]) {
          x++;
          y++;
        }
        forward[size + k] = x;
        const kb = delta - k;
        if (odd && kb >= -(d - 1) && kb <= d - 1 && x + backward[size + kb]! >= n)
          return [a0 + x0, b0 + y0, a0 + x, b0 + y] as const;
      }
      for (let k = -d; k <= d; k += 2) {
        let x =
          k === -d || (k !== d && backward[size + k - 1]! < backward[size + k + 1]!)
            ? backward[size + k + 1]!
            : backward[size + k - 1]! + 1;
        let y = x - k;
        const x0 = x;
        const y0 = y;
        while (x < n && y < m && a[a1 - 1 - x] === b[b1 - 1 - y]) {
          x++;
          y++;
        }
        backward[size + k] = x;
        const kf = delta - k;
        if (!odd && kf >= -d && kf <= d && x + forward[size + kf]! >= n)
          return [a1 - x, b1 - y, a1 - x0, b1 - y0] as const;
      }
    }
    throw new Error('unreachable: the paths always meet by d = ceil((n + m) / 2)');
  };

  const solve = (a0: number, a1: number, b0: number, b1: number): void => {
    while (a0 < a1 && b0 < b1 && a[a0] === b[b0]) pairs.push([a0++, b0++]);
    let end = 0;
    while (a0 < a1 && b0 < b1 && a[a1 - 1] === b[b1 - 1]) {
      a1--;
      b1--;
      end++;
    }
    // Both sides non-empty with unequal ends: D >= 2, so both halves are strictly smaller.
    if (a0 < a1 && b0 < b1) {
      const [x, y, u, v] = middleSnake(a0, a1, b0, b1);
      solve(a0, x, b0, y);
      for (let s = 0; s < u - x; s++) pairs.push([x + s, y + s]);
      solve(u, a1, v, b1);
    }
    for (let s = 0; s < end; s++) pairs.push([a1 + s, b1 + s]);
  };

  solve(0, a.length, 0, b.length);
  return pairs;
}

/** A string equal for two values exactly when they are deep-equal (see the header). */
function canonical(x: unknown, cache: WeakMap<object, string>): string {
  if (x === null) return 'n';
  switch (typeof x) {
    case 'boolean':
      return x ? 't' : 'f';
    case 'number':
      return Object.is(x, -0) ? 'd-0' : `d${x}`;
    case 'string':
      return JSON.stringify(x);
    case 'object': {
      let key = cache.get(x);
      if (key !== undefined) return key;
      if (Array.isArray(x)) key = `[${x.map((v) => canonical(v, cache)).join(',')}]`;
      else {
        const record = x as Record<string, unknown>;
        const members = Object.keys(record)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(record[k], cache)}`);
        key = `{${members.join(',')}}`;
      }
      cache.set(x, key);
      return key;
    }
    default:
      // Not JSON data (undefined, a function): equal only to the same kind.
      return `u${typeof x}`;
  }
}

function isObject(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** An RFC 6901 reference token: `~` → `~0`, `/` → `~1`. */
function escape(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}
