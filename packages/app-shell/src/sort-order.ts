// B3's order for the library's two sorts (spec 015 B3, 015 T4): the sort dialog and the table
// header sort. The library orders by `typeof` first, so a big number (an object) sorts after every
// plain number, and it compares two big numbers by text, so `…891` and `…890` keep file order
// (spike 015 T1 REPORT §4). It has no hook for a comparator of our own, so the app reads what the
// user asked for (the array, the property and the direction, from the dialog or the header clicked)
// and, when the library hands its result over, puts the items in B3's order instead: numbers, plain
// and big, by exact value; every other value where the library put it.
import { compareNumbers, LosslessNumber } from '@chr-json-editor/core';
import { getIn, type JSONPath } from 'immutable-json-patch';

/** A sort the user asked for: the property path in each item (given the array's items: the
 *  header names a column, and the dialog shows no property select when the items have one path or
 *  none), and 1 for ascending, -1 for descending. */
export interface SortRequest {
  itemPath: (items: readonly unknown[]) => JSONPath;
  direction: 1 | -1;
}

/** The library's rank of each kind of value (sort.ts `createObjectComparator`), numbers of both
 *  kinds as one: booleans, numbers, strings, anything else, then a missing property. */
function kindOf(value: unknown): number {
  if (typeof value === 'number' || value instanceof LosslessNumber) return 1;
  if (typeof value === 'boolean') return 0;
  if (typeof value === 'string') return 2;
  if (value === undefined) return 4;
  return 3;
}

/**
 * The order of `items` sorted as `request` asks, by B3: `order[i]` is the index in `items` of the
 * item now at `i`, as core's `sort` action takes it. `libraryOrder` is the order the library gave
 * (same form): the kinds of value come in the library's order, and values of one kind other than
 * numbers keep the library's order among them (its case-insensitive natural order of strings,
 * booleans false first); numbers are ordered by exact value (core's `compareNumbers`). The sort is
 * stable: equal items keep their order in `items`.
 */
export function exactOrder(
  items: readonly unknown[],
  libraryOrder: readonly number[],
  request: SortRequest,
): number[] {
  const itemPath = request.itemPath(items);
  const { direction } = request;
  const rank = new Array<number>(items.length);
  libraryOrder.forEach((from, to) => (rank[from] = to));
  const values: unknown[] = items.map((item): unknown => getIn(item, itemPath));
  return items
    .map((_item, i) => i)
    .sort((i, j) => {
      const a = values[i];
      const b = values[j];
      const ka = kindOf(a);
      const kb = kindOf(b);
      if (ka !== kb) return (ka - kb) * direction;
      if (ka === 1) {
        const byValue = compareNumbers(a as number | LosslessNumber, b as number | LosslessNumber);
        return byValue !== 0 ? byValue * direction : i - j;
      }
      return rank[i]! - rank[j]! || i - j;
    });
}

/** The one property path the items of an array have (the dialog's only choice): `[]` when an
 *  item is not an object, else the first leaf path found. */
export function onlyNestedPath(items: readonly unknown[]): JSONPath {
  const leaf = (value: unknown, path: JSONPath): JSONPath | undefined => {
    if (!isPlainObject(value)) return Array.isArray(value) ? undefined : path;
    for (const [key, member] of Object.entries(value)) {
      const found = leaf(member, [...path, key]);
      if (found) return found;
    }
    return undefined;
  };
  for (const item of items) {
    const found = leaf(item, []);
    if (found) return found;
  }
  return [];
}

/**
 * The property path of a table column from its header's name, the library's `stringifyJSONPath`
 * of the path read back with `parse` (the library's `parseJSONPath`); `values` is the column of
 * items that are not objects, unless every item is an object with a `values` member.
 */
export function columnPath(
  name: string,
  items: readonly unknown[],
  parse: (text: string) => JSONPath,
): JSONPath {
  if (name !== 'values') return parse(name);
  const member = items.every((item) => isPlainObject(item) && Object.hasOwn(item, 'values'));
  return member ? ['values'] : [];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof LosslessNumber)
  );
}
