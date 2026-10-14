// Reference data for golden `sort` cases (002 T10), independent of the format code: the comparison
// `vanilla-jsoneditor` 3.13.0 sorts with (its source map's `src/lib/logic/sort.ts`:
// `caseInsensitiveNaturalCompare`, `sortObjectKeys`, `sortArray`, `createObjectComparator`), applied
// to plain data. Spec 002 R13 sorts text the same way. Big numbers (spec 015 B3, "Sort order" in
// §Changes to approved specs): a big number (the corpus's marked string or a `LosslessNumber`) is a
// number, and two numbers of which one is big compare by exact value, with BigInt arithmetic
// (`facts.ts` `compareExact`); plain numbers compare as the library compares them.
import naturalCompare from 'natural-compare-lite';
import { parsePath } from 'immutable-json-patch';
import { compareExact, isBig, numberText } from './facts.js';

export interface SortAction {
  path: string;
  property?: string;
  direction?: 'asc' | 'desc';
  /** The members' new order by their old indices (003 T8), replacing the comparison. */
  order?: number[];
}

function caseInsensitiveNaturalCompare(a: unknown, b: unknown): number {
  const lower = (v: unknown) => (typeof v === 'string' ? v.toLowerCase() : text(v));
  return naturalCompare(lower(a), lower(b));
}

/** `v` as naturalCompare reads it (`v + ""`), or `[object Object]` where that throws: an object
 *  with an own `toString` or `valueOf` member that is not a function. The library throws there. */
function text(v: unknown): string {
  try {
    return `${v as string}`;
  } catch {
    return Object.prototype.toString.call(v);
  }
}

/** `getIn` of immutable-json-patch 6.0.3 (`lib/esm/immutabilityHelpers.js:67`) on own members
 *  only, as spec 002 sorts: that `getIn` reads `item.constructor` from the prototype when an item
 *  lacks it, and fails on an item whose own `constructor` member is not a function. */
function getIn(value: unknown, path: readonly string[]): unknown {
  for (const key of path) {
    if (Array.isArray(value)) value = value[Number.parseInt(key, 10)];
    else if (typeof value === 'object' && value !== null && Object.hasOwn(value, key))
      value = (value as Record<string, unknown>)[key];
    else value = undefined;
  }
  return value;
}

/** Two numbers, one of them big, by exact value; a plain infinity is beyond every big number, and
 *  `NaN` is neither below nor above one. */
function bigOrder(a: unknown, b: unknown): number {
  const ta = numberText(a);
  const tb = numberText(b);
  if (ta !== undefined && tb !== undefined) return compareExact(ta, tb);
  const infinite = (v: unknown) => (v === Infinity ? 1 : v === -Infinity ? -1 : 0);
  return infinite(a) - infinite(b);
}

function createObjectComparator(propertyPath: string[], direction: 1 | -1) {
  const sortableTypes: Record<string, number> = { boolean: 0, number: 1, string: 2, undefined: 4 };
  const otherTypes = 3;
  return (a: unknown, b: unknown): number => {
    const valueA = getIn(a, propertyPath);
    const valueB = getIn(b, propertyPath);
    const typeA = isBig(valueA) ? 'number' : typeof valueA;
    const typeB = isBig(valueB) ? 'number' : typeof valueB;
    if (typeA !== typeB) {
      const aIndex = sortableTypes[typeA] ?? otherTypes;
      const bIndex = sortableTypes[typeB] ?? otherTypes;
      return aIndex > bIndex ? direction : aIndex < bIndex ? -direction : 0;
    }
    if (isBig(valueA) || isBig(valueB)) return direction * bigOrder(valueA, valueB);
    if (typeof valueA === 'number' || typeof valueA === 'boolean')
      return valueA > valueB! ? direction : valueA < valueB! ? -direction : 0;
    if (typeof valueA === 'object' && valueA !== null) return 0;
    return direction * caseInsensitiveNaturalCompare(valueA, valueB);
  };
}

/** `data` with the container at `action.path` sorted (not recursively), as the library's sort
 *  modal leaves it. */
export function sortData(data: unknown, action: SortAction): unknown {
  const path = parsePath(data, action.path);
  const direction = action.direction === 'desc' ? -1 : 1;
  const sorted = (value: unknown): unknown => {
    if (action.order) {
      if (Array.isArray(value)) return action.order.map((i): unknown => value[i]);
      const entries = Object.entries(value as Record<string, unknown>);
      return Object.fromEntries(action.order.map((i) => entries[i]!));
    }
    if (Array.isArray(value))
      return value
        .slice()
        .sort(createObjectComparator(parsePath(value, action.property ?? ''), direction));
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort(
      (a, b) => direction * caseInsensitiveNaturalCompare(a, b),
    );
    return Object.fromEntries(keys.map((k) => [k, object[k]]));
  };
  const replace = (value: unknown, depth: number): unknown => {
    if (depth === path.length) return sorted(value);
    const key = path[depth]!;
    if (Array.isArray(value))
      return (value as unknown[]).map((v, i) => (String(i) === key ? replace(v, depth + 1) : v));
    const object = value as Record<string, unknown>;
    return { ...object, [key]: replace(object[key], depth + 1) };
  };
  return replace(data, 0);
}
