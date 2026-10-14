// Whole-document actions that keep comments (002 T10, spec 002 R12 and R13): `compact` removes the
// white space between tokens, and `sort` reorders the members of one object or array, each member
// moving with the comments R5 (UNK-008) attaches to it. Both work on the same `Doc` (tree and token
// stream) as the edit layer, so they behave the same for JSON, JSONC and JSON5.
import naturalCompare from 'natural-compare-lite';
import { blockComment, dataOf, type Doc, type Open } from './edit.js';
import { compareNumbers, LosslessNumber } from './numbers.js';
import { parseIndex, parsePointer } from './pointer.js';
import { isComment, Kind, type Token } from './tokens.js';
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

/**
 * Format (003 T8, spec 003 criterion 10): the text laid out as `JSON.stringify(data, null, unit)`
 * lays out data, keeping every token as written (quotes, keys, numbers, trailing commas) and every
 * comment. `unit` is the document's indent unit (R1; 2 spaces for a text with no line breaks), the
 * line ending and final newline stay as detected (R10). Comments:
 * - one that started its own line still does, at the indent of what follows it;
 * - one that shared its line with the token before it stays after that token on the same line
 *   (after its comma, if the comma followed it), and what came after a `//` comment goes on the
 *   next line; but a block comment with a token after it on its line goes with that token;
 * - a blank line between a comment and the token next to it stays as one blank line, so comments
 *   attached to a member by UNK-008 stay attached and those attached to none stay unattached.
 * An empty container (no members, no comments) is written `{}` or `[]`.
 */
export function prettyPrint(text: string, open: Open): string {
  // A byte order mark stays where it is. JSON5 reads it as white space and JSONC as an error;
  // either way it is not part of the layout.
  if (text.startsWith('\uFEFF')) return '\uFEFF' + prettyPrint(text.slice(1), open);
  const doc = open(text);
  const { tokens, style } = doc;
  const unit = doc.unit;
  const eol = style.eol;
  let out = '';
  let depth = 0;
  /** The next token starts a new line at `depth`. */
  let pendingBreak = false;
  /** That new line comes after a blank line. */
  let blankLine = false;
  /** An inline block comment was written last: a space goes before the next token. */
  let pendingSpace = false;
  /** Line breaks since the last token that was not white space. */
  let breaks = 0;
  let previous: Token | undefined;
  /** The last piece added to `out` (ending `out`). Reading the end of `out` itself would flatten
   *  the string V8 builds by `+=`, a copy of all of it for every same-line comment. */
  let last = '';

  const append = (s: string) => {
    if (s === '') return;
    out += s;
    last = s;
  };

  const write = (s: string) => {
    if (pendingBreak && out !== '') append((blankLine ? eol : '') + eol + unit.repeat(depth));
    else if (pendingSpace) append(' ');
    pendingBreak = false;
    pendingSpace = false;
    append(s);
  };

  /** A block comment at `i` is followed on its line by a token that is not a comment: when a line
   *  break comes before the comment, it goes on the new line with that token, the member it
   *  belongs to (UNK-021 ★). */
  const leadsLine = (i: number): boolean => {
    if (tokens[i]!.kind !== Kind.BlockComment) return false;
    for (let j = i + 1; j < tokens.length; j++) {
      const t = tokens[j]!;
      if (t.kind === Kind.Whitespace) continue;
      return t.kind !== Kind.LineBreak && !isComment(t);
    }
    return false;
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === Kind.Whitespace) continue;
    if (t.kind === Kind.LineBreak) {
      breaks++;
      continue;
    }
    const raw = text.slice(t.offset, t.end);
    blankLine = breaks > 1 && (isComment(t) || isComment(previous));
    // A line break between a comment and the token next to it stays.
    if (breaks > 0 && previous && (isComment(t) || isComment(previous))) pendingBreak = true;
    if (isComment(t)) {
      if (previous === undefined || breaks > 0 || (pendingBreak && leadsLine(i))) write(raw);
      else {
        // Shares the line with the token before it, even when a line break is pending after it.
        if (!last.endsWith(' ')) append(' ');
        append(raw);
      }
      if (t.kind === Kind.LineComment) pendingBreak = true;
      else pendingSpace = !pendingBreak;
    } else {
      switch (t.kind) {
        case Kind.OpenBrace:
        case Kind.OpenBracket: {
          write(raw);
          let j = i + 1;
          while (j < tokens.length && isSpace(tokens[j]!)) j++;
          const next = tokens[j];
          if (next && (next.kind === Kind.CloseBrace || next.kind === Kind.CloseBracket)) {
            // Empty: the closing bracket follows at once.
            append(text.slice(next.offset, next.end));
            i = j;
          } else {
            depth++;
            pendingBreak = true;
          }
          break;
        }
        case Kind.CloseBrace:
        case Kind.CloseBracket:
          depth--;
          pendingBreak = true;
          write(raw);
          break;
        case Kind.Comma:
          // After a `//` comment the comma starts the next line, so it still follows its member.
          if (pendingBreak) write(raw);
          else append(raw);
          pendingSpace = false;
          pendingBreak = true;
          break;
        case Kind.Colon:
          write(raw + ' ');
          break;
        default:
          write(raw);
      }
    }
    previous = t;
    breaks = 0;
  }
  if (style.finalNewline && out !== '') out += eol;
  return out;
}

const isSpace = (t: Token) => t.kind === Kind.Whitespace || t.kind === Kind.LineBreak;

/** R13: the members of the container at `options.path` in sorted order, by the comparison
 *  `vanilla-jsoneditor` 3.13.0 uses (`src/lib/logic/sort.ts`: keys by case-insensitive natural
 *  order; array items by `property`, booleans < numbers < strings < other types). Each member
 *  moves with its attached comments (R5); the text between members, with any comment attached to
 *  none, stays where it is. With `options.order` the members go in that order instead (003 T8:
 *  the editor's own sort dialog and table header sort the data; the text follows their order). */
export function sort(text: string, open: Open, options: SortOptions = {}): string {
  const doc = open(text);
  if (!doc.root) throw new PatchError('cannot sort: the document has no value');
  const path = options.path ?? '';
  const container = lookup(doc.root, path);
  const members = container.children ?? [];
  const order = options.order ? checkedOrder(options.order, members.length) : sortedOrder();
  if (order.every((from, to) => from === to)) return text;
  const sorted = reorder(doc, members, order);
  // 002 T10 review F1: a layout `reorder` does not read (commas at the start of lines) can come
  // out with misplaced commas. Such a result is refused rather than written.
  try {
    open(sorted);
  } catch (error) {
    if (!(error instanceof PatchError)) throw error;
    throw new PatchError(`cannot sort "${path}" in this layout: the result would not parse`);
  }
  return sorted;

  function sortedOrder(): number[] {
    const direction = options.direction === 'desc' ? -1 : 1;
    const property = parsePointer(options.property ?? '');
    const keyed = members.map((member, index) => ({
      index,
      key:
        container.type === 'object' ? member.children![0]!.value : getIn(dataOf(member), property),
    }));
    const compare = container.type === 'object' ? caseInsensitiveNaturalCompare : compareValues;
    // Array.prototype.sort is stable, as in the library, so equal members keep their order.
    return keyed.sort((a, b) => direction * compare(a.key, b.key)).map((k) => k.index);
  }
}

/** The order `sort` puts array items with data `values` in (R13): `options.order` checked, or
 *  sorted by `options.property` and `options.direction`. For containers that are not one text
 *  node, such as the lines of a JSON Lines document (012 T2). */
export function itemOrder(
  values: readonly unknown[],
  options: SortOptions = {},
): readonly number[] {
  if (options.order) return checkedOrder(options.order, values.length);
  const direction = options.direction === 'desc' ? -1 : 1;
  const property = parsePointer(options.property ?? '');
  return values
    .map((value, index) => ({ index, key: getIn(value, property) }))
    .sort((a, b) => direction * compareValues(a.key, b.key))
    .map((k) => k.index);
}

/** `order` when it is a permutation of the `length` members' indices. */
function checkedOrder(order: readonly number[], length: number): readonly number[] {
  const seen = new Set<number>();
  for (const n of order) if (Number.isInteger(n) && n >= 0 && n < length) seen.add(n);
  if (order.length !== length || seen.size !== length)
    throw new PatchError(`order must be a permutation of the container's ${length} members`);
  return order;
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
 * otherwise a slot spans the member with its leading block comments (UNK-021 ★) and its same-line
 * tail. The text between slots, the bytes
 * before the first and after the last stay. A unit placed last loses or gains its comma so the
 * container keeps or lacks a trailing comma as before (R6); one that gains a comma gets it right
 * after its value (README reading 1). A unit whose `//` comment would no longer end its line
 * carries it as a block comment (R12, README reading 7).
 */
function reorder(doc: Doc, members: readonly FormatNode[], order: readonly number[]): string {
  const ownLines = members.every((m) => doc.ownLines(m));
  const slots = members.map((member) => {
    const tail = doc.tail(member);
    const start = ownLines ? doc.blockStart(member) : doc.leadStart(member);
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
    if (!slot.unit.endsLine && unit.endsLine) tail = inlineComments(tail);
    out += unit.lead + unit.body + (unit.comma < 0 && needsComma ? ',' : '') + tail;
    const next = slots[to + 1];
    out += doc.text.slice(slot.end, next ? next.start : undefined);
  });
  return out;
}

/** `tail` with each `//` comment written as a block comment. A tail holds only white space, one
 *  comma and comments, so a `//` outside a block comment starts a line comment. */
function inlineComments(tail: string): string {
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

/** `typeof v`, with a big number a `number`. */
const kind = (v: unknown) => (v instanceof LosslessNumber ? 'number' : typeof v);

/** The library's `createObjectComparator` for one direction (ascending), with big numbers (spec 015
 *  B3): a `LosslessNumber` is a number, and numbers compare by exact value (`compareNumbers`). */
function compareValues(a: unknown, b: unknown): number {
  const ta = kind(a);
  const tb = kind(b);
  const rank: Record<string, number> = { boolean: 0, number: 1, string: 2, undefined: 4 };
  if (ta !== tb) {
    const ra = rank[ta] ?? 3;
    const rb = rank[tb] ?? 3;
    return ra > rb ? 1 : ra < rb ? -1 : 0;
  }
  if (ta === 'number')
    return compareNumbers(a as number | LosslessNumber, b as number | LosslessNumber);
  if (typeof a === 'boolean') return a > b! ? 1 : a < b! ? -1 : 0;
  if (typeof a === 'object' && a !== null) return 0;
  return caseInsensitiveNaturalCompare(a, b);
}
