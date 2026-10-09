// Whole-document actions that keep comments (002 T10, spec 002 R12 and R13): `compact` removes the
// white space between tokens, and `sort` reorders the members of one object or array, each member
// moving with the comments R5 (UNK-008) attaches to it. Both work on the same `Doc` (tree and token
// stream) as the edit layer, so they behave the same for JSON, JSONC and JSON5.
import naturalCompare from 'natural-compare-lite';
import { blockComment, dataOf, type Doc, type Open } from './edit.js';
import { parseIndex, parsePointer } from './pointer.js';
import { Kind } from './tokens.js';
import { PatchError, type FormatNode, type SortOptions } from './types.js';

/** R12: every token kept in order with no white space or line break between tokens; a `//` comment
 *  becomes a block comment (a `*\/` in its text escaped). Line breaks inside strings and block
 *  comments are bytes of those tokens and stay. A final newline stays as detected (R10). */
export function compact(text: string, open: Open): string {
  const doc = open(text);
  let out = '';
  for (const t of doc.tokens) {
    if (t.kind === Kind.Whitespace || t.kind === Kind.LineBreak) continue;
    const token = text.slice(t.offset, t.end);
    out += t.kind === Kind.LineComment ? blockComment(token) : token;
  }
  return doc.style.finalNewline && out !== '' ? out + doc.style.eol : out;
}

/** R13: the members of the container at `options.path` in sorted order, by the comparison
 *  `vanilla-jsoneditor` 3.13.0 uses (`src/lib/logic/sort.ts`: keys by case-insensitive natural
 *  order; array items by `property`, booleans < numbers < strings < other types). Each member
 *  moves with its attached comments (R5); the text between members, with any comment attached to
 *  none, stays where it is. */
export function sort(text: string, open: Open, options: SortOptions = {}): string {
  const doc = open(text);
  if (!doc.root) throw new PatchError('cannot sort: the document has no value');
  const container = lookup(doc.root, options.path ?? '');
  const members = container.children ?? [];
  const direction = options.direction === 'desc' ? -1 : 1;
  const property = parsePointer(options.property ?? '');
  const keyed = members.map((member, index) => ({
    index,
    key: container.type === 'object' ? member.children![0]!.value : getIn(dataOf(member), property),
  }));
  const compare = container.type === 'object' ? caseInsensitiveNaturalCompare : compareValues;
  // Array.prototype.sort is stable, as in the library, so equal members keep their order.
  const order = keyed.sort((a, b) => direction * compare(a.key, b.key)).map((k) => k.index);
  if (order.every((from, to) => from === to)) return text;
  return reorder(doc, members, order);
}

function lookup(root: FormatNode, path: string): FormatNode {
  let node = root;
  for (const key of parsePointer(path)) {
    const items = node.children ?? [];
    let next: FormatNode | undefined;
    if (node.type === 'object') {
      // The last duplicate wins, as in JSON.parse and the edit layer.
      for (let i = items.length - 1; i >= 0 && !next; i--)
        if (items[i]!.children![0]!.value === key) next = items[i]!.children![1];
    } else if (node.type === 'array') {
      const index = parseIndex(key);
      next = index === undefined ? undefined : items[index];
    }
    if (!next) throw new PatchError(`path "${path}" does not exist`);
    node = next;
  }
  if (node.type !== 'object' && node.type !== 'array')
    throw new PatchError(`cannot sort "${path}": not an object or array`);
  return node;
}

/** A member with the bytes that travel with it. */
interface Unit {
  /** Its attached comment lines above it and its line's indentation (one-per-line layout only). */
  lead: string;
  /** The member's own text: key, value and any comments between them. */
  body: string;
  /** What follows the value up to the end of its slot: its comma and same-line comments. */
  tail: string;
  /** Offset of the comma in `tail`, or -1. */
  comma: number;
  /** Its slot ends where a line ends, so a `//` comment there is safe. */
  endsLine: boolean;
}

/**
 * Puts the units of `members` into the members' slots in `order`. When every member sits on lines
 * of its own, a slot spans its attached comment lines above it (UNK-008) to the end of its line;
 * otherwise a slot spans the member and its same-line tail. The text between slots, the bytes
 * before the first and after the last stay. A unit placed last loses or gains its comma so the
 * container keeps or lacks a trailing comma as before (R6); one that gains a comma gets it right
 * after its value (README reading 1). A unit whose `//` comment would no longer end its line
 * carries it as a block comment (R12, README reading 7).
 */
function reorder(doc: Doc, members: readonly FormatNode[], order: readonly number[]): string {
  const ownLines = members.every((m) => doc.ownLines(m));
  const slots = members.map((member) => {
    const tail = doc.tail(member);
    const start = ownLines ? doc.blockStart(member) : member.offset;
    const end = member.offset + member.length;
    return {
      start,
      end: tail.end,
      unit: {
        lead: doc.text.slice(start, member.offset),
        body: doc.text.slice(member.offset, end),
        tail: doc.text.slice(end, tail.end),
        comma: tail.comma ? tail.comma.offset - end : -1,
        endsLine: tail.lineBreak !== undefined,
      } satisfies Unit,
    };
  });
  const trailing = slots.at(-1)!.unit.comma >= 0;
  let out = doc.text.slice(0, slots[0]!.start);
  slots.forEach((slot, to) => {
    const unit = slots[order[to]!]!.unit;
    const needsComma = to < slots.length - 1 || trailing;
    let tail = unit.tail;
    if (unit.comma >= 0 && !needsComma)
      tail = tail.slice(0, unit.comma) + tail.slice(unit.comma + 1);
    if (!slot.unit.endsLine && unit.endsLine) tail = inlineComments(doc, tail);
    out += unit.lead + unit.body + (unit.comma < 0 && needsComma ? ',' : '') + tail;
    const next = slots[to + 1];
    out += doc.text.slice(slot.end, next ? next.start : undefined);
  });
  return out;
}

/** `tail` with each `//` comment written as a block comment. A tail holds only white space, one
 *  comma and comments, so a `//` outside a block comment starts a line comment. */
function inlineComments(doc: Doc, tail: string): string {
  return tail.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, (comment) =>
    comment.startsWith('//') ? blockComment(comment) : comment,
  );
}

/** The value at `path` inside `value`, as `getIn` of `immutable-json-patch` 6.0.3 reads it
 *  (`lib/esm/immutabilityHelpers.js:67`), but with own properties only. */
function getIn(value: unknown, path: readonly string[]): unknown {
  for (const key of path) {
    if (Array.isArray(value)) value = value[Number.parseInt(key, 10)];
    else if (typeof value === 'object' && value !== null)
      value = Object.prototype.hasOwnProperty.call(value, key)
        ? (value as Record<string, unknown>)[key]
        : undefined;
    else value = undefined;
  }
  return value;
}

/** `caseInsensitiveNaturalCompare` of the library's `sort.ts`. */
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

/** The library's `createObjectComparator` for one direction (ascending). */
function compareValues(a: unknown, b: unknown): number {
  const rank: Record<string, number> = { boolean: 0, number: 1, string: 2, undefined: 4 };
  if (typeof a !== typeof b) {
    const ra = rank[typeof a] ?? 3;
    const rb = rank[typeof b] ?? 3;
    return ra > rb ? 1 : ra < rb ? -1 : 0;
  }
  if (typeof a === 'number' || typeof a === 'boolean') return a > b! ? 1 : a < b! ? -1 : 0;
  if (typeof a === 'object' && a !== null) return 0;
  return caseInsensitiveNaturalCompare(a, b);
}
