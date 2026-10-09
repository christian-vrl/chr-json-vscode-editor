// The edit layer shared by the format adapters (002 T3, 002 T5, 002 T6): every RFC 6902 operation
// as minimal text edits computed from a parse tree's offsets and its token stream, following rules
// R1–R10 and R15 of spec 002 and the readings in tests/golden/README.md. Each adapter supplies the
// tree and tokens from its own parser, and a `Writer` for the bytes it adds (R4, R8).
import { parseIndex, parsePointer } from './pointer.js';
import { isComment, Kind, tokenAt, tokenFrom, type Token } from './tokens.js';
import { PatchError, type FormatNode, type PatchOperation, type Style } from './types.js';

/** How an adapter writes new keys and values. */
export interface Writer {
  /** A new member's key in `container`, as written before `: `. */
  key(name: string, container: FormatNode): string;
  /** A new value: on one line when `unit` is undefined, else laid out like
   *  `JSON.stringify(value, null, unit)` with `\n` line breaks and no indent before the lines after
   *  the first. Throws a `PatchError` for a value the format cannot hold. */
  value(value: unknown, unit: string | undefined): string;
}

export interface Edit {
  offset: number;
  end: number;
  text: string;
}

/** Makes a `Doc` of a text whose tree and tokens are already known (see `Doc.without`). */
export type Rebuild = (text: string, root: FormatNode, tokens: Token[]) => Doc;

/** A document being edited: text, tree and tokens for one operation. */
export class Doc {
  constructor(
    readonly text: string,
    /** Undefined when the text holds no value: empty, white space or comments only (R15). */
    readonly root: FormatNode | undefined,
    readonly tokens: readonly Token[],
    readonly style: Style,
    readonly writer: Writer,
    /** The characters that end a line: `\n` for JSON and JSONC, and also `\r`, U+2028 and U+2029
     *  for JSON5 (spec §6). */
    private readonly lineBreaks = '\n',
    /** The adapter's `Doc` for another text of this document, from its tree and tokens (its style
     *  and writer read the text). Without it, `without` always leaves the caller to parse. */
    private readonly rebuild?: Rebuild,
  ) {}

  /**
   * The document after `edits`, deletions that take out `member` (with its comments, comma and
   * white space): this tree and these tokens with the member left out and the offsets after each
   * deletion moved back, so `move` does not parse the document a second time (UNK-014). Style is
   * detected again from the new text. Undefined when an edit is not a deletion, or cuts into a
   * token or a node other than the member; the caller then parses the new text.
   */
  without(edits: readonly Edit[], member: FormatNode): Doc | undefined {
    if (!this.rebuild || !this.root || edits.some((e) => e.text !== '')) return undefined;
    const cuts = [...edits].sort((a, b) => a.offset - b.offset);
    const first = cuts[0]!.offset;
    const last = cuts.at(-1)!.end;
    const removed = cuts.reduce((sum, cut) => sum + cut.end - cut.offset, 0);
    /** Where `offset` lands after the cuts; -1 when a cut removes the character before it. */
    const moved = (offset: number): number => {
      if (offset >= last) return offset - removed;
      let before = 0;
      for (const cut of cuts) {
        if (cut.end <= offset) before += cut.end - cut.offset;
        else if (cut.offset < offset) return -1;
        else break;
      }
      return offset - before;
    };
    const cutAway = (offset: number, end: number) =>
      cuts.some((cut) => cut.offset <= offset && end <= cut.end);

    // Tokens before the first cut stay as they are; after the last one, all move by `removed`.
    const kept = tokenFrom(this.tokens, first);
    const tokens = this.tokens.slice(0, kept);
    if (kept > 0 && this.tokens[kept - 1]!.end > first) return undefined;
    for (let i = kept; i < this.tokens.length; i++) {
      const t = this.tokens[i]!;
      if (t.offset >= last) {
        tokens.push({ kind: t.kind, offset: t.offset - removed, end: t.end - removed });
        continue;
      }
      if (cutAway(t.offset, t.end)) continue;
      const offset = moved(t.offset);
      const end = moved(t.end);
      if (offset < 0 || end < 0) return undefined;
      tokens.push({ kind: t.kind, offset, end });
    }

    const copy = (node: FormatNode, offset: number, length: number, children?: FormatNode[]) => {
      const shifted: { -readonly [K in keyof FormatNode]: FormatNode[K] } = {
        type: node.type,
        offset,
        length,
      };
      if (node.value !== undefined) shifted.value = node.value;
      if (children) shifted.children = children;
      return shifted;
    };
    /** A node after every cut: it and its children move by `removed`. */
    const after = (node: FormatNode): FormatNode =>
      copy(node, node.offset - removed, node.length, node.children?.map(after));
    let ok = true;
    const shift = (node: FormatNode): FormatNode | undefined => {
      const end = node.offset + node.length;
      if (end <= first) return node;
      if (node.offset >= last) return after(node);
      if (node === member) return undefined;
      const offset = moved(node.offset);
      const movedEnd = moved(end);
      if (offset < 0 || movedEnd < 0 || cutAway(node.offset, end)) {
        ok = false;
        return node;
      }
      let children: FormatNode[] | undefined;
      if (node.children) {
        children = [];
        for (const child of node.children) {
          const kept = shift(child);
          if (kept) children.push(kept);
        }
      }
      return copy(node, offset, movedEnd - offset, children);
    };
    const root = shift(this.root);
    if (!ok || !root) return undefined;
    return this.rebuild(this.apply([...edits]), root, tokens);
  }

  apply(edits: Edit[]): string {
    let text = this.text;
    for (const e of [...edits].sort((a, b) => b.offset - a.offset)) {
      text = text.slice(0, e.offset) + e.text + text.slice(e.end);
    }
    return text;
  }

  lineStart(offset: number): number {
    let i = offset - 1;
    while (i >= 0 && !this.lineBreaks.includes(this.text[i]!)) i--;
    return i + 1;
  }

  indentAt(offset: number): string {
    const start = this.lineStart(offset);
    return /^[ \t]*/.exec(this.text.slice(start, offset))![0];
  }

  /** `value` as the writer writes it (R4, R8). In a multi-line container a new object or array is
   *  laid out like `JSON.stringify(value, null, unit)`, indented from its member's line (README
   *  reading 5). */
  serialize(value: unknown, indent: string, multiLine: boolean): string {
    return this.writer
      .value(value, multiLine ? this.unit : undefined)
      .replace(/\n/g, this.style.eol + indent);
  }

  get unit(): string {
    return this.style.indent === '\t' ? '\t' : ' '.repeat(this.style.indent);
  }

  /** Where the member's same-line tail ends: its comma (if any) and the comments after the value
   *  on its line, except block comments after the comma that lead the next member on that line
   *  (`leadStart`). `lineBreak` is the token ending that line, when nothing else follows on it. */
  tail(member: FormatNode): { comma?: Token; end: number; lineBreak?: Token } {
    let i = tokenFrom(this.tokens, member.offset + member.length);
    let comma: Token | undefined;
    let end = member.offset + member.length;
    for (; i < this.tokens.length; i++) {
      const t = this.tokens[i]!;
      if (t.kind === Kind.Whitespace) continue;
      if (t.kind === Kind.LineBreak) return { comma, end, lineBreak: t };
      if (isComment(t) && !this.text.slice(t.offset, t.end).includes('\n')) {
        if (comma && this.leads(i)) break;
        end = t.end;
      } else if (t.kind === Kind.Comma && !comma) {
        comma = t;
        end = t.end;
      } else break;
    }
    return { comma, end };
  }

  /** Whether the block comment at token `i` comes before a member on its line: white space and
   *  block comments only between them. */
  private leads(i: number): boolean {
    for (let j = i + 1; j < this.tokens.length; j++) {
      const t = this.tokens[j]!;
      if (
        t.kind === Kind.Whitespace ||
        (isComment(t) && !this.text.slice(t.offset, t.end).includes('\n'))
      )
        continue;
      return ![
        Kind.LineBreak,
        Kind.LineComment,
        Kind.BlockComment,
        Kind.Comma,
        Kind.CloseBrace,
        Kind.CloseBracket,
      ].includes(t.kind as never);
    }
    return false;
  }

  /** Where the member starts with the block comments before it on its line, with only white space
   *  between them and it (`[80, /* tls *\/ 443]`): they belong to it, so they are removed, moved
   *  and sorted with it, and an insert at its index goes before them (UNK-021 ★). The member's own
   *  offset when there are none. */
  leadStart(member: FormatNode): number {
    let start = member.offset;
    for (let i = tokenAt(this.tokens, member.offset) - 1; i >= 0; i--) {
      const t = this.tokens[i]!;
      if (t.kind === Kind.Whitespace) continue;
      if (t.kind !== Kind.BlockComment || this.text.slice(t.offset, t.end).includes('\n')) break;
      start = t.offset;
    }
    return start;
  }

  /** Whether only whitespace, and the member's leading comments, precede it on its line. */
  startsLine(member: FormatNode): boolean {
    let i = tokenAt(this.tokens, this.leadStart(member)) - 1;
    while (i >= 0 && this.tokens[i]!.kind === Kind.Whitespace) i--;
    return i < 0 || this.tokens[i]!.kind === Kind.LineBreak;
  }

  /** The member sits on lines of its own: nothing else before it or after its tail. */
  ownLines(member: FormatNode): boolean {
    return this.startsLine(member) && this.tail(member).lineBreak !== undefined;
  }

  /** Start of the line where the member's attached comments begin: comment lines directly above
   *  it, with no blank line between (UNK-008). The member's own line start when there are none. */
  blockStart(member: FormatNode): number {
    let start = this.lineStart(member.offset);
    let i = tokenAt(this.tokens, this.leadStart(member)) - 1;
    while (i >= 0 && this.tokens[i]!.kind === Kind.Whitespace) i--;
    // i is the line break ending the line above.
    for (;;) {
      let j = i - 1;
      let sawComment = false;
      while (j >= 0 && (this.tokens[j]!.kind === Kind.Whitespace || isComment(this.tokens[j]))) {
        if (isComment(this.tokens[j])) sawComment = true;
        j--;
      }
      if (!sawComment || (j >= 0 && this.tokens[j]!.kind !== Kind.LineBreak)) return start;
      start = this.lineStart(this.tokens[j + 1]!.offset);
      i = j;
      if (j < 0) return start;
    }
  }
}

/** The node a pointer leads to, with its parent container and its member node (the property for an
 *  object member, the value for an array item). */
interface Target {
  container?: FormatNode;
  member?: FormatNode;
  value?: FormatNode;
  index: number;
  key: string;
}

function children(node: FormatNode): readonly FormatNode[] {
  return node.children ?? [];
}

function valueOf(member: FormatNode): FormatNode {
  return member.type === 'property' ? children(member)[1]! : member;
}

function find(container: FormatNode, key: string): { member?: FormatNode; index: number } {
  const items = children(container);
  if (container.type === 'object') {
    // RFC 8259 leaves duplicate names open; the last one wins, as in JSON.parse.
    for (let i = items.length - 1; i >= 0; i--) {
      if (children(items[i]!)[0]!.value === key) return { member: items[i], index: i };
    }
    return { index: items.length };
  }
  if (container.type === 'array') {
    const index = key === '-' ? items.length : parseIndex(key);
    if (index === undefined || index > items.length) return { index: -1 };
    return { member: items[index], index };
  }
  return { index: -1 };
}

function resolve(root: FormatNode, path: string): Target {
  const tokens = parsePointer(path);
  if (tokens.length === 0) return { value: root, index: 0, key: '' };
  let node = root;
  for (const [n, key] of tokens.entries()) {
    const { member, index } = find(node, key);
    if (n === tokens.length - 1) {
      if (index < 0) throw new PatchError(`path "${path}" does not exist`);
      return { container: node, member, value: member && valueOf(member), index, key };
    }
    if (!member) throw new PatchError(`path "${path}" does not exist`);
    node = valueOf(member);
  }
  throw new Error('unreachable');
}

/** The existing value at `path`; a `PatchError` when there is none. */
function existing(root: FormatNode, path: string): Target & { value: FormatNode } {
  const target = resolve(root, path);
  if (!target.value) throw new PatchError(`path "${path}" does not exist`);
  return target as Target & { value: FormatNode };
}

/** The bytes a new member is written with. `add` and `copy` write data (R8, README reading 4);
 *  `move` carries the member's own text and its comments (R7, README reading 3). */
interface Piece {
  /** The value for a member at `indent`, in a multi-line container or not. */
  value(indent: string, multiLine: boolean): string;
  /** Comment lines that go above the member, each indented with `indent` and ending its line. */
  above(indent: string): string;
  /** The same comments for a member that shares its line with others: block comments, each
   *  followed by a space. */
  aboveInline: string;
  /** Block comments before the member on its line, as written up to it (UNK-021 ★). */
  lead: string;
  /** Comments after the value on its line, each preceded by white space. `inline` converts line
   *  comments to block comments, for a member that has more text after it on its line. */
  after(inline: boolean): string;
}

function dataPiece(doc: Doc, value: unknown): Piece {
  return {
    value: (indent, multiLine) => doc.serialize(value, indent, multiLine),
    above: () => '',
    aboveInline: '',
    lead: '',
    after: () => '',
  };
}

/** A comment that can share its line with code: a line comment becomes a block comment, with a `*\/`
 *  in its text escaped as R12 does. */
export function blockComment(comment: string): string {
  return comment.startsWith('//') ? `/*${comment.slice(2).replace(/\*\//g, '*\\/')} */` : comment;
}

/** The text of `start`–`end` with the line indentation `from` replaced by `to`: on the first line
 *  when `start` begins a line, and after each line break between tokens. Line breaks inside strings
 *  and comments are bytes of those tokens and stay as written. */
function relocate(doc: Doc, start: number, end: number, from: string, to: string): string {
  let out = '';
  let lineStart = doc.lineStart(start) === start;
  for (let i = tokenFrom(doc.tokens, start); i < doc.tokens.length; i++) {
    const t = doc.tokens[i]!;
    if (t.offset >= end) break;
    let text = doc.text.slice(t.offset, Math.min(t.end, end));
    if (lineStart && t.kind === Kind.Whitespace && text.startsWith(from)) {
      text = to + text.slice(from.length);
    } else if (lineStart && t.kind !== Kind.Whitespace && t.kind !== Kind.LineBreak) {
      if (from === '') text = to + text;
    }
    lineStart = t.kind === Kind.LineBreak;
    out += text;
  }
  return out;
}

function commentsIn(doc: Doc, start: number, end: number): string[] {
  const comments: string[] = [];
  for (let i = tokenFrom(doc.tokens, start); i < doc.tokens.length; i++) {
    const t = doc.tokens[i]!;
    if (t.offset >= end) break;
    if (isComment(t)) comments.push(doc.text.slice(t.offset, t.end));
  }
  return comments;
}

/** The member at `target` as `move` carries it: its value's text as written, with the comments
 *  `remove` takes away with it (UNK-008), re-indented for its new place (R1, R7). */
function movedPiece(doc: Doc, target: Target & { value: FormatNode }): Piece {
  const member = target.member ?? target.value;
  const from = doc.indentAt(member.offset);
  let start = target.value.offset;
  if (member.type === 'property') {
    // Comments between the key and the value travel with the value.
    let i = tokenFrom(doc.tokens, children(member)[0]!.offset + children(member)[0]!.length);
    while (doc.tokens[i]!.kind !== Kind.Colon) i++;
    i++;
    while (doc.tokens[i]!.kind === Kind.Whitespace || doc.tokens[i]!.kind === Kind.LineBreak) i++;
    start = doc.tokens[i]!.offset;
  }
  const end = member.offset + member.length;
  const ownLines = target.container !== undefined && doc.ownLines(member);
  const lead = target.container ? doc.text.slice(doc.leadStart(member), member.offset) : '';
  const aboveStart = ownLines ? doc.blockStart(member) : doc.lineStart(member.offset);
  const aboveEnd = doc.lineStart(member.offset);
  const above = commentsIn(doc, aboveStart, aboveEnd);
  const tail = target.container ? doc.tail(member) : { end, comma: undefined };
  const after = commentsIn(doc, end, tail.end);
  const afterText = tail.comma
    ? doc.text.slice(end, tail.comma.offset) + doc.text.slice(tail.comma.end, tail.end)
    : doc.text.slice(end, tail.end);
  return {
    value: (indent) => relocate(doc, start, end, from, indent),
    above: (indent) =>
      above.length === 0 ? '' : relocate(doc, aboveStart, aboveEnd, from, indent),
    aboveInline: above.map((c) => `${blockComment(c)} `).join(''),
    lead,
    after: (inline) =>
      after.length === 0
        ? ''
        : inline
          ? after.map((c) => ` ${blockComment(c)}`).join('')
          : afterText,
  };
}

function replace(doc: Doc, value: FormatNode, piece: Piece, container?: FormatNode): string {
  const multiLine =
    container === undefined ||
    doc.text.slice(container.offset, container.offset + container.length).includes('\n');
  const indent = container === undefined ? '' : doc.indentAt(value.offset);
  return doc.apply([
    {
      offset: value.offset,
      end: value.offset + value.length,
      text: piece.value(indent, multiLine),
    },
  ]);
}

/** The separator between members of a single-line container: the first one used, else `, ` (R3). */
function separator(doc: Doc, items: readonly FormatNode[]): string {
  const first = items[0];
  const second = items[1];
  if (!first || !second) return ', ';
  const comma = doc.tail(first).comma;
  return comma ? doc.text.slice(comma.offset, doc.leadStart(second)) : ', ';
}

function add(doc: Doc, target: Target, piece: Piece): string {
  const { container, member, value, index, key } = target;
  if (!container) return replace(doc, value!, piece);
  // RFC 6902 §4.1: adding an existing object member replaces its value.
  if (container.type === 'object' && member) return replace(doc, value!, piece, container);
  const items = children(container);
  const name = container.type === 'object' ? `${doc.writer.key(key, container)}: ` : '';
  const eol = doc.style.eol;

  if (index < items.length) {
    // Insert before the member now at that index (R2), above its attached comments (UNK-022 ★).
    const next = items[index]!;
    if (doc.ownLines(next)) {
      const indent = doc.indentAt(next.offset);
      const at = doc.blockStart(next);
      const text = `${piece.above(indent)}${indent}${piece.lead}${name}${piece.value(indent, true)},${piece.after(false)}${eol}`;
      return doc.apply([{ offset: at, end: at, text }]);
    }
    const sep = separator(doc, items);
    // A carried comment keeps a space before the next member, also after a bare `,` (R3).
    const after = piece.after(true);
    const text = `${piece.aboveInline}${piece.lead}${name}${piece.value(doc.indentAt(next.offset), false)}${sep.slice(0, 1)}${after}${after && !sep.slice(1) ? ' ' : sep.slice(1)}`;
    // Before the next member's leading comments, which stay with it (UNK-021 ★).
    const at = doc.leadStart(next);
    return doc.apply([{ offset: at, end: at, text }]);
  }

  const last = items[items.length - 1];
  if (!last) return addToEmpty(doc, container, name, piece);
  const tail = doc.tail(last);
  const trailing = tail.comma !== undefined;
  const lastEnd = last.offset + last.length;
  if (doc.ownLines(last)) {
    // Append on a new line after the last member's tail, indented like it (R1, R2). Its comma goes
    // right after its value, before a same-line comment (README reading 1); a trailing comma stays
    // trailing (R6).
    const indent = doc.indentAt(last.offset);
    const text = `${eol}${piece.above(indent)}${indent}${piece.lead}${name}${piece.value(indent, true)}${trailing ? ',' : ''}${piece.after(false)}`;
    const edits: Edit[] = [{ offset: tail.end, end: tail.end, text }];
    if (!trailing) edits.push({ offset: lastEnd, end: lastEnd, text: ',' });
    return doc.apply(edits);
  }
  // Single-line container: join with the separator already used (R3).
  const sep = separator(doc, items);
  const indent = doc.indentAt(last.offset);
  const member_ = `${piece.aboveInline}${piece.lead}${name}${piece.value(indent, false)}`;
  if (trailing)
    return doc.apply([
      {
        offset: tail.comma!.end,
        end: tail.comma!.end,
        text: `${sep.slice(1)}${member_},${piece.after(true)}`,
      },
    ]);
  // A line comment ends the last member's tail: the new member goes before it, after the value.
  const at =
    tail.lineBreak && doc.text.slice(lastEnd, tail.end).includes('//') ? lastEnd : tail.end;
  return doc.apply([{ offset: at, end: at, text: `${sep}${member_}${piece.after(true)}` }]);
}

/** A container with no members. One already written over several lines gets the member on its
 *  own line at the parent's indent plus one unit (R1); otherwise it stays on one line (R3). */
function addToEmpty(doc: Doc, container: FormatNode, name: string, piece: Piece): string {
  const open = container.offset + 1;
  const close = container.offset + container.length - 1;
  const inner = doc.text.slice(open, close);
  if (!inner.includes('\n')) {
    const text = `${piece.aboveInline}${piece.lead}${name}${piece.value(doc.indentAt(container.offset), false)}${piece.after(true)}`;
    // Comments already inside the container stay; the member goes after them.
    if (inner.trim() !== '') return doc.apply([{ offset: close, end: close, text }]);
    return doc.apply([{ offset: open, end: close, text }]);
  }
  const indent = doc.indentAt(container.offset) + doc.unit;
  const at = doc.text.lastIndexOf('\n', close) + 1;
  const text = `${piece.above(indent)}${indent}${piece.lead}${name}${piece.value(indent, true)}${piece.after(false)}${doc.style.eol}`;
  return doc.apply([{ offset: at, end: at, text }]);
}

function remove(doc: Doc, target: Target): string {
  return doc.apply(removal(doc, target));
}

/** The deletions that remove the member at `path`, and that member (for tests of `Doc.without`). */
export function removalAt(doc: Doc, path: string): { edits: Edit[]; member: FormatNode } {
  const target = existing(doc.root!, path);
  return { edits: removal(doc, target), member: target.member! };
}

/** The edits that remove the member at `target`: only deletions (R5, R6, UNK-008, UNK-021 ★). */
function removal(doc: Doc, target: Target): Edit[] {
  const { container, member, index } = target;
  if (!container) throw new PatchError('cannot remove the root');
  if (!member) throw new PatchError('path does not exist');
  const items = children(container);
  const isLast = index === items.length - 1;
  const previous = items[index - 1];
  const tail = doc.tail(member);

  if (doc.ownLines(member)) {
    // Remove its lines with the comments attached to it (UNK-008). When it was last and the
    // container has no trailing comma, the new last member loses its comma (R6).
    const edits: Edit[] = [{ offset: doc.blockStart(member), end: tail.lineBreak!.end, text: '' }];
    if (isLast && !tail.comma && previous) {
      const comma = doc.tail(previous).comma;
      if (comma) edits.push({ offset: comma.offset, end: comma.end, text: '' });
    }
    return edits;
  }
  // The member's leading comments go with it; the next member's stay (UNK-021 ★).
  const start = doc.leadStart(member);
  if (!isLast) return [{ offset: start, end: doc.leadStart(items[index + 1]!), text: '' }];
  if (!previous) return [{ offset: start, end: tail.end, text: '' }];
  const prevComma = doc.tail(previous).comma!;
  // `[1, 2,]` → `[1,]`: the trailing comma stays (R6); `[1, 2]` → `[1]`.
  return tail.comma
    ? [{ offset: prevComma.end, end: tail.comma.end, text: '' }]
    : [{ offset: prevComma.offset, end: tail.end, text: '' }];
}

/** The data a node holds. */
export function dataOf(node: FormatNode): unknown {
  if (node.type === 'array') return children(node).map(dataOf);
  if (node.type === 'object') {
    const object: Record<string, unknown> = {};
    for (const property of children(node)) {
      // Defined, not assigned, so a `__proto__` key is a member rather than the prototype.
      Object.defineProperty(object, children(property)[0]!.value as string, {
        value: dataOf(children(property)[1]!),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    return object;
  }
  return node.value;
}

/** RFC 6902 §4.6 equality: same type; numbers by value; arrays item by item; objects with the same
 *  members, in any order. */
function equal(a: unknown, b: unknown): boolean {
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => equal(item, b[i]))
    );
  }
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (k) =>
        Object.prototype.hasOwnProperty.call(b, k) &&
        equal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    )
  );
}

function isPrefix(prefix: readonly string[], tokens: readonly string[]): boolean {
  return prefix.length < tokens.length && prefix.every((t, i) => t === tokens[i]);
}

/** A document with no value (R15, UNK-026): `add` or `replace` at `""` writes the value as the
 *  whole document, after any comments; every other operation is an error (R9). */
function writeDocument(doc: Doc, op: PatchOperation): string {
  if ((op.op !== 'add' && op.op !== 'replace') || op.path !== '') {
    const path = op.op === 'move' || op.op === 'copy' ? op.from : op.path;
    throw new PatchError(`path "${path}" does not exist: the document has no value`);
  }
  const lineBreak = doc.tokens.some((t) => t.kind === Kind.LineBreak);
  const eol = lineBreak ? doc.style.eol : '\n';
  const finalNewline = lineBreak ? doc.style.finalNewline : true;
  const comments = doc.tokens.filter(isComment);
  const prefix = comments.length > 0 ? doc.text.slice(0, comments.at(-1)!.end) + eol : '';
  const value = doc.writer.value(op.value, '  ').replace(/\n/g, eol);
  return `${prefix}${value}${finalNewline ? eol : ''}`;
}

/** Parses a text for editing; throws a `PatchError` when it does not parse. */
export type Open = (text: string) => Doc;

/** Applies one operation to the text and returns the new text. Throws a `PatchError` when it
 *  cannot apply; the caller keeps its text (R9). */
export function applyOperation(text: string, op: PatchOperation, open: Open): string {
  const doc = open(text);
  const root = doc.root;
  if (!root) return writeDocument(doc, op);
  switch (op.op) {
    case 'add':
      return add(doc, resolve(root, op.path), dataPiece(doc, op.value));
    case 'replace': {
      const target = existing(root, op.path);
      return replace(doc, target.value, dataPiece(doc, op.value), target.container);
    }
    case 'remove':
      return remove(doc, resolve(root, op.path));
    case 'test': {
      if (!equal(dataOf(existing(root, op.path).value), op.value))
        throw new PatchError(`test failed: the value at "${op.path}" differs`);
      return text;
    }
    case 'copy': {
      const value = dataOf(existing(root, op.from).value);
      return add(doc, resolve(root, op.path), dataPiece(doc, value));
    }
    case 'move': {
      // RFC 6902 §4.4: remove at `from`, then add at `path`, which may not lie inside `from`.
      const source = existing(root, op.from);
      if (isPrefix(parsePointer(op.from), parsePointer(op.path)))
        throw new PatchError(`cannot move "${op.from}" into itself`);
      if (op.path === op.from) return text;
      const piece = movedPiece(doc, source);
      // The document without the member, from this parse rather than a second one (UNK-014).
      const edits = removal(doc, source);
      const after = doc.without(edits, source.member!) ?? open(doc.apply(edits));
      return add(after, resolve(after.root!, op.path), piece);
    }
    default:
      throw new PatchError(`unknown operation "${(op as { op: unknown }).op as string}"`);
  }
}
