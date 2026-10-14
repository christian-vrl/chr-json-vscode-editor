// Data-level changes (003 T8, spec 002 R14): the library's sort and transform dialogs, the table
// header sort and a paste over a selection all replace a whole object or array with new data. Sent
// as that one `replace`, the host would write the container afresh and drop the comments and style
// inside it. Instead the UI sends what changed: a pure reordering (every sort, and a transform that
// only sorts) as core's `sort` with that order, so each member moves with its comments (R13);
// anything else as core's `diff` of the old and new data, so every member that survives keeps its
// comments (R14).
import { bigNumberKey, diff, LosslessNumber } from '@chr-json-editor/core';
import type { DocumentChange, JsonPatchOperation } from './protocol.js';

/**
 * The change that turns the value `before` at JSON Pointer `path` into `after`; undefined when the
 * two are deep-equal in the same order (nothing to send).
 */
export function dataChange(
  path: string,
  before: unknown,
  after: unknown,
): DocumentChange | undefined {
  const order = reordering(before, after);
  if (order) {
    if (order.every((from, to) => from === to)) return undefined;
    return { kind: 'action', action: { name: 'sort', path, order } };
  }
  const patch = diff(before, after).map(
    (op) => ({ ...op, path: path + op.path }) as JsonPatchOperation,
  );
  return patch.length > 0 ? { kind: 'patch', patch } : undefined;
}

/** Whether `value` is an object or array the host can reorder or diff into. */
export function isContainer(value: unknown): boolean {
  return typeof value === 'object' && value !== null;
}

/**
 * When `after` holds exactly the members of `before` in another order (or the same), the order as
 * indices into `before`: `order[i]` is the old index of the member now at `i`. Equal members keep
 * their relative order, as a stable sort leaves them. Undefined otherwise.
 */
export function reordering(before: unknown, after: unknown): number[] | undefined {
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length) return undefined;
    const slots = new Map<string, number[]>();
    before.forEach((item, i) => {
      const key = keyOf(item);
      const list = slots.get(key);
      if (list) list.push(i);
      else slots.set(key, [i]);
    });
    const order: number[] = [];
    for (const item of after) {
      const next = slots.get(keyOf(item))?.shift();
      if (next === undefined) return undefined;
      order.push(next);
    }
    return order;
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = Object.keys(before);
    const index = new Map(keys.map((k, i) => [k, i]));
    const order: number[] = [];
    for (const [key, value] of Object.entries(after)) {
      const from = index.get(key);
      if (from === undefined || keyOf(before[key]) !== keyOf(value)) return undefined;
      order.push(from);
    }
    return order.length === keys.length ? order : undefined;
  }
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return isContainer(value) && !Array.isArray(value);
}

/** Equal for two members exactly when they are the same data, key order included (a sort does not
 *  reorder inside members). Numbers JSON cannot write (JSON5's `NaN`, `Infinity`, `-0`) and
 *  `undefined` get their own markers so they do not pass for `null` or `0`. A big number (spec 015)
 *  keys by its exact value, as core's `diff` does (B3): as the plain number it equals, or by a
 *  marker no plain number or object member gives (an object with `isLosslessNumber` and `value`
 *  members stays an object). */
function keyOf(value: unknown): string {
  return (
    JSON.stringify(value, (_key, v: unknown) => {
      if (v === undefined) return '\u0000undefined';
      if (typeof v === 'number' && (!Number.isFinite(v) || Object.is(v, -0)))
        return `\u0000${Object.is(v, -0) ? '-0' : String(v)}`;
      if (v instanceof LosslessNumber) {
        const key = bigNumberKey(v);
        return key.startsWith('d') ? Number(v.value) : `\u0000${key}`;
      }
      return v;
    }) ?? '\u0000undefined'
  );
}
