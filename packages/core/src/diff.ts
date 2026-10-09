// Structural diff (002 T9, spec 002 criterion 9): `diff(a, b)` is an RFC 6902 patch that turns data
// `a` into data `b`. Data-level actions apply it to the document's text with `applyPatch`, so every
// member that survives keeps its comments and style (R14); spec 007's compare reuses it.
//
// Objects: keys only in `a` are removed, keys only in `b` are added (appended, R2), shared keys are
// diffed in place. Arrays: a longest common subsequence of deep-equal items stays put (Myers'
// linear-space O((N+M)D) algorithm); in each gap between kept items, removed and added items are
// paired by position and diffed in place, so a changed item keeps its comments, and the rest become
// `remove` and `add`. When `b` only inserts or only removes items of `a`, the patch is exactly those
// inserts or removes. Anything else that differs is one `replace`. When two arrays differ so much
// that the LCS search would run past its budget (`LCS_BUDGET`), a pure insert or remove is still
// found exactly; otherwise the common start and end are kept and the items between are paired by
// position (003 T8, 002 T9 review): still a correct patch, only a longer one.
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
  const keys: Keys = { ids: new WeakMap(), shapes: new Map() };
  const keyOf = (x: unknown) => canonical(x, keys);
  if (keyOf(a) === keyOf(b)) return ops;
  // An explicit stack instead of recursion, so deeply nested data does not overflow the call
  // stack. A container's steps are pushed in reverse, so they run (and emit) in order; a nested
  // diff never changes the indices its container's later steps use.
  const stack: Step[] = [{ a, b, path: '' }];
  for (let step = stack.pop(); step; step = stack.pop()) {
    if ('op' in step) ops.push(step);
    else stack.push(...diffValue(step.a, step.b, step.path, keyOf).reverse());
  }
  return ops;
}

type KeyOf = (x: unknown) => string;
/** An operation to emit, or two unequal values to diff at `path`. */
type Step = PatchOperation | { a: unknown; b: unknown; path: string };

/** The steps for unequal values `a` and `b` at `path`. */
function diffValue(a: unknown, b: unknown, path: string, keyOf: KeyOf): Step[] {
  if (Array.isArray(a) && Array.isArray(b)) return diffArray(a, b, path, keyOf);
  if (isObject(a) && isObject(b)) return diffObject(a, b, path, keyOf);
  return [{ op: 'replace', path, value: b }];
}

function diffObject(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  path: string,
  keyOf: KeyOf,
): Step[] {
  const steps: Step[] = [];
  for (const key of Object.keys(a))
    if (!hasOwn(b, key)) steps.push({ op: 'remove', path: `${path}/${escape(key)}` });
  for (const key of Object.keys(a))
    if (hasOwn(b, key) && keyOf(a[key]) !== keyOf(b[key]))
      steps.push({ a: a[key], b: b[key], path: `${path}/${escape(key)}` });
  for (const key of Object.keys(b))
    if (!hasOwn(a, key)) steps.push({ op: 'add', path: `${path}/${escape(key)}`, value: b[key] });
  return steps;
}

function diffArray(
  a: readonly unknown[],
  b: readonly unknown[],
  path: string,
  keyOf: KeyOf,
): Step[] {
  // Items as numbers, equal numbers for deep-equal items, so the LCS compares integers.
  const ids = new Map<string, number>();
  const id = (x: unknown) => {
    const key = keyOf(x);
    let n = ids.get(key);
    if (n === undefined) ids.set(key, (n = ids.size));
    return n;
  };
  const ia = a.map(id);
  const ib = b.map(id);
  const kept = commonSubsequence(ia, ib, LCS_BUDGET) ?? subsequence(ia, ib) ?? positional(ia, ib);
  kept.push([a.length, b.length]);

  // `at` is the index in the array as the operations so far left it.
  const steps: Step[] = [];
  let at = 0;
  let i = 0;
  let j = 0;
  for (const [nextI, nextJ] of kept) {
    const removed = nextI - i;
    const added = nextJ - j;
    const paired = Math.min(removed, added);
    for (let t = 0; t < paired; t++, at++)
      steps.push({ a: a[i + t], b: b[j + t], path: `${path}/${at}` });
    for (let t = paired; t < removed; t++) steps.push({ op: 'remove', path: `${path}/${at}` });
    for (let t = paired; t < added; t++, at++)
      steps.push({ op: 'add', path: `${path}/${at}`, value: b[j + t] });
    at++; // the kept item (one past the end for the closing sentinel)
    i = nextI + 1;
    j = nextJ + 1;
  }
  return steps;
}

/**
 * How many diagonals the LCS search may visit for one array before `diff` gives up on it (002 T9
 * review: two disjoint arrays of 20 000 items took about 6 s). About 0.1 s; arrays that differ
 * little stay far below it.
 */
const LCS_BUDGET = 5_000_000;

/**
 * When one array is a subsequence of the other (`b` only inserts into `a`, or only removes from
 * it), the pairs of a greedy match, which are a longest common subsequence; else undefined. Linear,
 * so criterion 9's "only those adds or removes" holds at any size, past the LCS budget too.
 */
function subsequence(a: readonly number[], b: readonly number[]): [number, number][] | undefined {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const pairs: [number, number][] = [];
  let at = 0;
  for (let s = 0; s < short.length; s++) {
    while (at < long.length && long[at] !== short[s]) at++;
    if (at === long.length) return undefined;
    pairs.push(a === short ? [s, at] : [at, s]);
    at++;
  }
  return pairs;
}

/**
 * The fallback when the LCS search runs out of budget: the common prefix and suffix are kept and
 * the items between them are paired by position, so the patch is still correct, only longer.
 */
function positional(a: readonly number[], b: readonly number[]): [number, number][] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  const pairs: [number, number][] = [];
  for (let s = 0; s < start; s++) pairs.push([s, s]);
  for (let s = end; s > 0; s--) pairs.push([a.length - s, b.length - s]);
  return pairs;
}

/**
 * Index pairs `[i, j]` with `a[i] === b[j]`, increasing in both, of a longest common subsequence.
 * Myers 1986, "An O(ND) Difference Algorithm and Its Variations", §4b: linear space, the middle
 * snake splits the box in two until a side is empty. With a `budget`, returns undefined once more
 * than `budget` diagonals have been visited.
 */
export function commonSubsequence(
  a: readonly number[],
  b: readonly number[],
  budget = Infinity,
): [number, number][] | undefined {
  const pairs: [number, number][] = [];
  let visited = 0;
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
      visited += 2 * d + 2;
      if (visited > budget) throw OVER_BUDGET;
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

  try {
    solve(0, a.length, 0, b.length);
  } catch (error) {
    if (error === OVER_BUDGET) return undefined;
    throw error;
  }
  return pairs;
}

const OVER_BUDGET = new Error('LCS budget exceeded');

/** Canonical keys: each container's id, and the id of each container shape seen. */
interface Keys {
  ids: WeakMap<object, string>;
  shapes: Map<string, string>;
}

/**
 * A string equal for two values exactly when they are deep-equal (see the header). A container's
 * key is an id interned from its shape, the keys of its members, so keys stay short and building
 * them is linear in the size of the data. Built with an explicit stack rather than recursion, so
 * deeply nested data does not overflow the call stack (002 T9 review: about 3000 levels did).
 */
function canonical(root: unknown, keys: Keys): string {
  const leaf = (x: unknown): string | undefined => {
    if (x === null) return 'n';
    switch (typeof x) {
      case 'boolean':
        return x ? 't' : 'f';
      case 'number':
        return Object.is(x, -0) ? 'd-0' : `d${x}`;
      case 'string':
        return JSON.stringify(x);
      case 'object':
        return keys.ids.get(x);
      default:
        // Not JSON data (undefined, a function): equal only to the same kind.
        return `u${typeof x}`;
    }
  };
  const done = leaf(root);
  if (done !== undefined) return done;
  // Each frame is a container whose members are keyed first, then the container itself.
  const stack: { value: object; expanded: boolean }[] = [
    { value: root as object, expanded: false },
  ];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    const record = frame.value as Record<string, unknown>;
    const members = Array.isArray(record) ? (record as unknown[]) : Object.values(record);
    if (!frame.expanded) {
      frame.expanded = true;
      for (const member of members)
        if (leaf(member) === undefined) stack.push({ value: member as object, expanded: false });
      continue;
    }
    stack.pop();
    if (keys.ids.has(frame.value)) continue;
    const shape = Array.isArray(record)
      ? `[${members.map((v) => leaf(v)!).join(',')}]`
      : `{${Object.keys(record)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${leaf(record[k])!}`)
          .join(',')}}`;
    let id = keys.shapes.get(shape);
    if (id === undefined) keys.shapes.set(shape, (id = `#${keys.shapes.size}`));
    keys.ids.set(frame.value, id);
  }
  return keys.ids.get(root as object)!;
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
