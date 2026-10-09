// Structural compare (spec 007, T1): the differences between two documents' data, each with a path
// on the side or sides where its value exists, and the patch that copies one difference across.
//
// `compare(left, right)` turns each operation of `diff(left, right)` (002 T9) into a `Difference`.
// `diff` writes array indices in the coordinates of the array as its earlier operations left it, so
// `compare` replays the patch's index arithmetic: when `diff` reaches position `p` of an array, the
// items before `p` are already in their right-side form, so `p` is the right index, and the left
// index is `p` minus the items added before it plus the items removed before it (plan 007 §Approach).
//
// `copyDifference(source, target, d, from)` is the smallest patch that makes the target match the
// source at `d`'s location: replace a changed value, remove a member the source lacks, or add one
// the target lacks. An array item the target lacks goes right after the target item aligned with
// the source's previous item (the same alignment `diff` uses), so later items keep their alignment.
import type { PatchOperation } from './formats/types.js';
import { diff } from './diff.js';

/** Which side of `compare(left, right)`. */
export type CompareSide = 'left' | 'right';

/**
 * One data difference between `left` and `right`, as JSON Pointers into each side's data:
 * `added` exists only on the right, `removed` only on the left, `changed` on both, with unequal
 * values. A path is absent on the side where the value does not exist.
 */
export interface Difference {
  kind: 'added' | 'removed' | 'changed';
  leftPath?: string;
  rightPath?: string;
}

/**
 * The differences between `left` and `right`, one per operation of `diff(left, right)`, in the
 * patch's order, except that the members an object gains are listed by key, so the result does
 * not depend on the right side's key order (criterion 1). Equal data (`isDeepStrictEqual`: key
 * order ignored, `NaN` equals `NaN`, `-0` differs from `0`) gives `[]`.
 */
export function compare(left: unknown, right: unknown): Difference[] {
  const differences: Difference[] = [];
  // Per array, by its path in the partly patched data: the items `diff` added and removed so far.
  const counts = new Map<string, { added: number; removed: number }>();
  // The run of members added to the same object, sorted by key once the run ends.
  let run: { parent: string; start: number } | undefined;
  const endRun = () => {
    if (run && differences.length - run.start > 1) {
      const sorted = differences.slice(run.start).sort((x, y) => {
        const a = lastToken(x.rightPath!);
        const b = lastToken(y.rightPath!);
        return a < b ? -1 : a > b ? 1 : 0;
      });
      // A loop, not `splice(...sorted)`: spreading 100k+ members would overflow the call stack.
      for (let n = 0; n < sorted.length; n++) differences[run.start + n] = sorted[n]!;
    }
    run = undefined;
  };

  for (const op of diff(left, right)) {
    const tokens = op.path === '' ? [] : op.path.slice(1).split('/');
    let leftPath = '';
    let rightPath = '';
    let patched = '';
    let value = left;
    // Every container above the operation's target holds a value on both sides.
    for (let n = 0; n < tokens.length - 1; n++) {
      const token = tokens[n]!;
      if (Array.isArray(value)) {
        const at = Number(token);
        const c = count(counts, patched);
        const index = at - c.added + c.removed;
        leftPath += `/${index}`;
        rightPath += `/${at}`;
        value = value[index];
      } else {
        leftPath += `/${token}`;
        rightPath += `/${token}`;
        value = (value as Record<string, unknown>)[unescapeToken(token)];
      }
      patched += `/${token}`;
    }

    let difference: Difference;
    if (tokens.length === 0) difference = { kind: 'changed', leftPath: '', rightPath: '' };
    else {
      const token = tokens[tokens.length - 1]!;
      let leftToken = token;
      if (Array.isArray(value)) {
        const c = count(counts, patched);
        leftToken = String(Number(token) - c.added + c.removed);
        if (op.op === 'add') c.added++;
        else if (op.op === 'remove') c.removed++;
      }
      difference =
        op.op === 'add'
          ? { kind: 'added', rightPath: `${rightPath}/${token}` }
          : op.op === 'remove'
            ? { kind: 'removed', leftPath: `${leftPath}/${leftToken}` }
            : {
                kind: 'changed',
                leftPath: `${leftPath}/${leftToken}`,
                rightPath: `${rightPath}/${token}`,
              };
    }

    const objectAdd = difference.kind === 'added' && !Array.isArray(value);
    if (!objectAdd || run?.parent !== rightPath) endRun();
    if (objectAdd && !run) run = { parent: rightPath, start: differences.length };
    differences.push(difference);
  }
  endRun();
  return differences;
}

function count(counts: Map<string, { added: number; removed: number }>, path: string) {
  let c = counts.get(path);
  if (!c) counts.set(path, (c = { added: 0, removed: 0 }));
  return c;
}

/**
 * The JSON Patch, for `target`, that copies difference `d` of `compare(left, right)` from
 * `source` into `target`. `from` names the source's side; by default the source is the right side
 * and the target the left, as in `copyDifference(right, left, d)`. Applied to the target, the patch
 * leaves it equal to before except at `d`'s location, which then holds the source's value there,
 * or no member when `d` exists only on the target side. Values in the patch are the source's own
 * sub-values, not copies.
 */
export function copyDifference(
  source: unknown,
  target: unknown,
  d: Difference,
  from: CompareSide = 'right',
): PatchOperation[] {
  const sourcePath = from === 'right' ? d.rightPath : d.leftPath;
  const targetPath = from === 'right' ? d.leftPath : d.rightPath;
  if (sourcePath === undefined && targetPath === undefined)
    throw new Error('copyDifference: the difference has no path');
  // Only on the target side: remove it.
  if (sourcePath === undefined) return [{ op: 'remove', path: targetPath! }];
  const value = resolve(source, sourcePath);
  // On both sides: replace the target's value.
  if (targetPath !== undefined) return [{ op: 'replace', path: targetPath, value }];
  // Only on the source side: add it, at the place in the target that matches its place in the
  // source. The containers above it exist on both sides; follow the alignment down to them.
  const tokens = sourcePath.slice(1).split('/');
  let s = source;
  let t = target;
  let path = '';
  for (let n = 0; n < tokens.length; n++) {
    const token = tokens[n]!;
    const last = n === tokens.length - 1;
    if (Array.isArray(s)) {
      const sourceIndex = Number(token);
      const { leftOf, rightOf } = align(
        from === 'right' ? (t as unknown[]) : s,
        from === 'right' ? s : (t as unknown[]),
      );
      const toTarget = from === 'right' ? leftOf : rightOf;
      if (last) {
        // After the target item aligned with the nearest earlier source item that has one.
        let before = sourceIndex - 1;
        while (before >= 0 && toTarget[before]! < 0) before--;
        const index = before < 0 ? 0 : toTarget[before]! + 1;
        return [{ op: 'add', path: `${path}/${index}`, value }];
      }
      const index = toTarget[sourceIndex]!;
      path += `/${index}`;
      s = s[sourceIndex];
      t = (t as unknown[])[index];
    } else {
      if (last) return [{ op: 'add', path: `${path}/${token}`, value }];
      path += `/${token}`;
      const key = unescapeToken(token);
      s = (s as Record<string, unknown>)[key];
      t = (t as Record<string, unknown>)[key];
    }
  }
  // Unreachable for a difference of `compare(left, right)`: the loop returns at the last token.
  throw new Error(`copyDifference: cannot place ${sourcePath}`);
}

/**
 * How `diff(left, right)` aligns two arrays: for each right item, the index of the left item it
 * is kept or paired with, or -1 when it is added (`leftOf`); and the converse (`rightOf`).
 */
function align(left: readonly unknown[], right: readonly unknown[]) {
  const leftOf = new Int32Array(right.length).fill(-1);
  const rightOf = new Int32Array(left.length).fill(-1);
  // The patch's operations on the array's own items, by position, in order; nested operations
  // only mark their item as paired.
  const ops = diff(left, right);
  let k = 0;
  let added = 0;
  let removed = 0;
  const position = (op: PatchOperation) => Number(op.path.slice(1).split('/', 1)[0]);
  const own = (op: PatchOperation) => op.path.indexOf('/', 1) < 0;
  for (let at = 0; at < right.length; at++) {
    while (k < ops.length && own(ops[k]!) && ops[k]!.op === 'remove' && position(ops[k]!) === at) {
      removed++;
      k++;
    }
    if (k < ops.length && own(ops[k]!) && ops[k]!.op === 'add' && position(ops[k]!) === at) {
      added++;
      k++;
      continue;
    }
    const index = at - added + removed;
    leftOf[at] = index;
    rightOf[index] = at;
    while (k < ops.length && position(ops[k]!) === at) k++;
  }
  return { leftOf, rightOf };
}

/** The value at JSON Pointer `path` in `data`. */
function resolve(data: unknown, path: string): unknown {
  if (path === '') return data;
  let value = data;
  for (const token of path.slice(1).split('/'))
    value = Array.isArray(value)
      ? value[Number(token)]
      : (value as Record<string, unknown>)[unescapeToken(token)];
  return value;
}

function lastToken(path: string): string {
  return unescapeToken(path.slice(path.lastIndexOf('/') + 1));
}

/** An RFC 6901 reference token's text: `~1` → `/`, `~0` → `~`. */
function unescapeToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}
