// JSON Lines adapter (spec 012, 012 T2): the `jsonl` format, whose data is the array of its items,
// one RFC 8259 value per non-blank line (§Terms, L1). Item-level operations splice whole lines
// (L3–L6); nested ones edit one item's value as a one-line `json` document with the edit layer the
// `json` adapter uses (L7); a new root array goes through `diff` (L8, 002 R14). So every line no
// operation names keeps its bytes, and an item edit never reads the other lines' values again.
//
// A leading BOM is the file's encoding mark: it belongs to the first line (§Terms) but is never a
// value byte, and it stays first whatever an edit does to that line, so an `add` at `/0` goes after
// it (tests/golden/README.md, JSON Lines reading 4).
import { parseTree, type Node } from 'jsonc-parser';
import { diff } from '../diff.js';
import { compact as compactValue, itemOrder, sort as sortValue } from './actions.js';
import { lastText } from './cache.js';
import { applyOperation, equal } from './edit.js';
import { openJson, visitData } from './jsonc-adapter.js';
import { jsonText, mayBeBig, mayHoldBigNumber, numberValue } from './numbers.js';
import type { ParseDataResult } from './parse-data.js';
import { parseIndex, parsePointer } from './pointer.js';
import { stringify } from './stringify.js';
import {
  PatchError,
  type Diagnostic,
  type FormatAdapter,
  type FormatNode,
  type ParseResult,
  type PatchOperation,
  type SortOptions,
  type Style,
} from './types.js';

const BOM = '﻿';

/** L8's message for a root that would not be an array. */
const NOT_AN_ARRAY = 'A JSON Lines document holds an array of items.';

export type Ending = '' | '\n' | '\r\n';

/** A line (§Terms): its text without its ending, and what it holds. */
export interface Line {
  /** On the first line, without the leading BOM. */
  readonly text: string;
  readonly ending: Ending;
  readonly kind: 'blank' | 'item' | 'bad';
  /** An item's data, once read (`UNREAD` for a line an edit wrote). */
  readonly data?: unknown;
}

const UNREAD = Symbol('unread');

/** A text as lines; `bom` is the leading BOM, or `''`. */
export interface Lines {
  readonly bom: string;
  readonly lines: readonly Line[];
  /** False when the text holds no big number (`mayHoldBigNumber`), so no line needs the exact path
   *  (spec 015 B1); absent means it may. */
  readonly mayHold?: boolean;
}

/** The 1-based message of L1 for a bad line. */
const badLine = (number: number) => `Line ${number} is not valid JSON.`;

/** An item line's data: `JSON.parse`'s, with big numbers as `LosslessNumber`s (spec 015 B1) when
 *  the line may hold one (`mayHold`: the whole text may, so a text with none is not scanned per
 *  line). Throws what `JSON.parse` throws. */
function itemData(text: string, mayHold = true): unknown {
  const data = JSON.parse(text) as unknown;
  // `visitData` reads a strict JSON text to `JSON.parse`'s data (parse-data.ts), numbers exactly.
  return mayHold && mayHoldBigNumber(text) ? visitData(text) : data;
}

/** What a line holds. `JSON.parse` reads exactly one RFC 8259 value and allows white space around
 *  it; a line has no LF, and a CR in it (a lone CR) makes it bad (§Terms). */
export function classify(text: string, mayHold = true): Pick<Line, 'kind' | 'data'> {
  if (/^[ \t]*$/.test(text)) return { kind: 'blank' };
  if (text.includes('\r')) return { kind: 'bad' };
  try {
    return { kind: 'item', data: itemData(text, mayHold) };
  } catch {
    return { kind: 'bad' };
  }
}

export function split(text: string): Lines {
  const mayHold = mayHoldBigNumber(text);
  const bom = text.startsWith(BOM) ? BOM : '';
  const lines: Line[] = [];
  let start = bom.length;
  while (start < text.length) {
    const lf = text.indexOf('\n', start);
    const crlf = lf > start && text.charCodeAt(lf - 1) === 13;
    const content = text.slice(start, lf < 0 ? text.length : crlf ? lf - 1 : lf);
    lines.push({
      text: content,
      ending: lf < 0 ? '' : crlf ? '\r\n' : '\n',
      ...classify(content, mayHold),
    });
    start = lf < 0 ? text.length : lf + 1;
  }
  return { bom, lines, mayHold };
}

/** L2: the first line ending (`\n` when there is none); a final newline when the text ends with a
 *  line ending or has no line (an empty text, or a BOM alone). */
function styleOf(lines: readonly Line[]): Style {
  const first = lines.find((line) => line.ending !== '');
  return {
    indent: 0,
    eol: first ? (first.ending as '\n' | '\r\n') : '\n',
    finalNewline: lines.length === 0 || lines.at(-1)!.ending !== '',
    quote: '"',
    unquotedKeys: false,
    trailingCommas: false,
  };
}

const join = ({ bom, lines }: Lines) => bom + lines.map((l) => l.text + l.ending).join('');

/** L9: a text with a bad line takes no operation. */
function refuseBadLines({ lines }: Lines): void {
  const bad = lines.findIndex((line) => line.kind === 'bad');
  if (bad >= 0) throw new PatchError(badLine(bad + 1));
}

/** The value bytes of an item line: its text without the spaces and tabs around it. */
function valueSpan(text: string): { start: number; end: number } {
  const start = /^[ \t]*/.exec(text)![0].length;
  const end = text.length - /[ \t]*$/.exec(text)![0].length;
  return { start, end };
}

/** `text` with its value bytes replaced by `edit(value bytes)`; the spaces around them stay (L5). */
function editValue(text: string, edit: (value: string) => string): string {
  const { start, end } = valueSpan(text);
  return text.slice(0, start) + edit(text.slice(start, end)) + text.slice(end);
}

const valueOf = (text: string) => {
  const { start, end } = valueSpan(text);
  return text.slice(start, end);
};

/** L1: the items' data, a node per item with offsets into the whole text, one error per bad line
 *  spanning the line without its ending (on the first line, the BOM included: the BOM belongs to
 *  the first line, §Terms; README reading 5). */
function parse(text: string, { bom, lines, mayHold }: Lines): ParseResult {
  const data: unknown[] = [];
  const children: FormatNode[] = [];
  const diagnostics: Diagnostic[] = [];
  let offset = bom.length;
  lines.forEach((line, index) => {
    if (line.kind === 'item') {
      data.push(line.data);
      const tree = parseTree(line.text)!;
      children.push(
        mayHold === false ? shifted(tree, offset) : shiftedExact(tree, offset, line.text),
      );
    } else if (line.kind === 'bad') {
      const head = index === 0 ? bom.length : 0;
      diagnostics.push({
        severity: 'error',
        message: badLine(index + 1),
        offset: offset - head,
        length: line.text.length + head,
      });
    }
    offset += line.text.length + line.ending.length;
  });
  return {
    data,
    tree: { type: 'array', offset: 0, length: text.length, children },
    style: styleOf(lines),
    diagnostics,
  };
}

/** A jsonc-parser node as a `FormatNode` moved `by` characters. */
function shifted(node: Node, by: number): FormatNode {
  const out: { -readonly [K in keyof FormatNode]: FormatNode[K] } = {
    type: node.type,
    offset: node.offset + by,
    length: node.length,
  };
  if (node.value !== undefined) out.value = node.value;
  if (node.children) out.children = node.children.map((child) => shifted(child, by));
  return out;
}

/** `shifted` for a line `text` that may hold a big number: a big number's value is its
 *  `LosslessNumber` (spec 015 B1). Kept apart so lines of a text with none take `shifted` as it
 *  was (spec 015 criterion 11). */
function shiftedExact(node: Node, by: number, text: string): FormatNode {
  const out: { -readonly [K in keyof FormatNode]: FormatNode[K] } = {
    type: node.type,
    offset: node.offset + by,
    length: node.length,
  };
  if (node.value !== undefined)
    out.value =
      node.type === 'number' && mayBeBig(text, node.offset, node.offset + node.length)
        ? numberValue(text.slice(node.offset, node.offset + node.length), node.value as number)
        : node.value;
  if (node.children) out.children = node.children.map((child) => shiftedExact(child, by, text));
  return out;
}

/** The node at `tokens` under `root`, as the edit layer finds it (the last duplicate key wins). */
function nodeAt(root: FormatNode, tokens: readonly string[]): FormatNode | undefined {
  let node: FormatNode | undefined = root;
  for (const key of tokens) {
    const members: readonly FormatNode[] = node.children ?? [];
    let next: FormatNode | undefined;
    if (node.type === 'object') {
      for (let i = members.length - 1; i >= 0 && !next; i--)
        if (members[i]!.children![0]!.value === key) next = members[i]!.children![1];
    } else if (node.type === 'array') {
      const index = parseIndex(key);
      next = index === undefined ? undefined : members[index];
    }
    if (!next) return undefined;
    node = next;
  }
  return node;
}

/** The pointer after its first reference token (`/0/a/b` → `/a/b`, `/0` → `""`), escapes kept. */
function rest(pointer: string): string {
  const slash = pointer.indexOf('/', 1);
  return slash < 0 ? '' : pointer.slice(slash);
}

/** L3, L5: a value as `JSON.stringify` writes it, as the `json` adapter writes values (R8), big
 *  numbers as their digits (spec 015 B2). */
function write(value: unknown): string {
  const json = jsonText(value);
  if (json === undefined) throw new PatchError('value is not JSON');
  return json;
}

const notFound = (path: string) => new PatchError(`path "${path}" does not exist`);

/** What an `add` writes: data, or bytes carried from elsewhere in the document (L6, L7). `line` is
 *  the whole line of an item that `move` carries to another item position. */
type Piece = { value: unknown } | { bytes: string; line?: string };

/** `bytes` added at `pointer` inside the one-line JSON text `json`: the edit layer adds a placeholder
 *  string, whose literal then makes way for the bytes, so the member gets the layout an `add` gives
 *  and the value keeps its bytes (L7: a move or copy between items carries the value's bytes). */
function addBytes(json: string, pointer: string, bytes: string): string {
  let marker = '\u0000chr-json-editor';
  while (json.includes(JSON.stringify(marker))) marker += '+';
  const literal = JSON.stringify(marker);
  const out = applyOperation(json, { op: 'add', path: pointer, value: marker }, openJson);
  const at = out.indexOf(literal);
  return out.slice(0, at) + bytes + out.slice(at + literal.length);
}

/** One `applyPatch`: the lines being edited, each operation applied to them in turn. */
class Editor {
  private readonly lines: Line[];
  /** Indices in `lines` of the items, in order; recomputed after a line is added or removed. */
  private itemLines: number[] | undefined;

  /** The line ending new lines get: the document's (L2), read before the first operation, so a
   *  `move` that takes away the only line ending still writes the one the document had (R10). */
  private readonly eol: Ending;

  constructor(private readonly doc: Lines) {
    this.lines = [...doc.lines];
    this.eol = styleOf(doc.lines).eol;
  }

  text(): string {
    return join({ bom: this.doc.bom, lines: this.lines });
  }

  apply(op: PatchOperation): void {
    switch (op.op) {
      case 'add':
      case 'replace':
        return this.put(op.op, op.path, { value: op.value });
      case 'remove':
        return this.remove(op.path);
      case 'test':
        return this.test(op.path, op.value);
      case 'move':
      case 'copy':
        return this.carry(op);
      default:
        throw new PatchError(`unknown operation "${(op as { op: unknown }).op as string}"`);
    }
  }

  private items(): number[] {
    if (!this.itemLines) {
      this.itemLines = [];
      this.lines.forEach((line, index) => {
        if (line.kind === 'item') this.itemLines!.push(index);
      });
    }
    return this.itemLines;
  }

  private dataAt(index: number): unknown {
    const line = this.lines[index]!;
    if (line.data !== UNREAD) return line.data;
    const data = itemData(line.text);
    this.lines[index] = { ...line, data };
    return data;
  }

  private data(): unknown[] {
    return this.items().map((index) => this.dataAt(index));
  }

  /** The line of item `token` (an existing index), or a `PatchError` naming `path`. */
  private item(token: string | undefined, path: string): number {
    const index = token === undefined ? undefined : parseIndex(token);
    const line = index === undefined ? undefined : this.items()[index];
    if (line === undefined) throw notFound(path);
    return line;
  }

  private setText(index: number, text: string): void {
    this.lines[index] = { ...this.lines[index]!, text, data: UNREAD };
  }

  /** L7: an operation on one item's value, as a one-line `json` document. */
  private nested(index: number, op: PatchOperation): void {
    const text = editValue(this.lines[index]!.text, (value) => applyOperation(value, op, openJson));
    this.setText(index, text);
  }

  private put(kind: 'add' | 'replace', path: string, piece: Piece): void {
    const tokens = parsePointer(path);
    if (tokens.length === 0) {
      // L8: the new items through `diff`, so lines of unchanged items keep their bytes.
      const value = 'value' in piece ? piece.value : itemData(piece.bytes);
      if (!Array.isArray(value)) throw new PatchError(NOT_AN_ARRAY);
      for (const op of diff(this.data(), value)) this.apply(op);
      return;
    }
    if (tokens.length === 1) {
      const text = 'value' in piece ? write(piece.value) : (piece.line ?? piece.bytes);
      if (kind === 'replace') {
        // L5: the value's bytes are replaced; the spaces and tabs around it stay.
        const index = this.item(tokens[0], path);
        return this.setText(
          index,
          editValue(this.lines[index]!.text, () => text),
        );
      }
      const count = this.items().length;
      const at = tokens[0] === '-' ? count : parseIndex(tokens[0]!);
      if (at === undefined || at > count) throw notFound(path);
      return this.insert(at, text);
    }
    const index = this.item(tokens[0], path);
    if ('value' in piece)
      return this.nested(index, { op: kind, path: rest(path), value: piece.value });
    this.setText(
      index,
      editValue(this.lines[index]!.text, (value) => addBytes(value, rest(path), piece.bytes)),
    );
  }

  /** L3: a new item line at item position `at`. */
  private insert(at: number, text: string): void {
    const items = this.items();
    const eol = this.eol;
    const line = (ending: Ending): Line => ({ text, ending, kind: 'item', data: UNREAD });
    if (at < items.length) {
      // At the start of item `at`'s line (after the BOM on the first line).
      this.lines.splice(items[at]!, 0, line(eol));
    } else {
      // After the last item's line ending; on a text with no item, after its blank lines.
      const after = items.length > 0 ? items.at(-1)! : this.lines.length - 1;
      const last = this.lines[after];
      if (last && last.ending === '') {
        // That line has no ending: it gets one, and the new line none (R10).
        this.lines[after] = { ...last, ending: eol };
        this.lines.splice(after + 1, 0, line(''));
      } else {
        this.lines.splice(after + 1, 0, line(eol));
      }
    }
    this.itemLines = undefined;
  }

  private remove(path: string): void {
    const tokens = parsePointer(path);
    if (tokens.length === 0) throw new PatchError(NOT_AN_ARRAY);
    const index = this.item(tokens[0], path);
    if (tokens.length > 1) return this.nested(index, { op: 'remove', path: rest(path) });
    // L4: the line and its ending; a last line without an ending takes the ending before it. An
    // empty line left with no ending is no line any more (§Terms): it goes too.
    let first = index;
    if (this.lines[index]!.ending === '' && index > 0) {
      const previous = this.lines[index - 1]!;
      if (previous.text === '') first--;
      else this.lines[index - 1] = { ...previous, ending: '' };
    }
    this.lines.splice(first, index - first + 1);
    this.itemLines = undefined;
  }

  private test(path: string, value: unknown): void {
    const tokens = parsePointer(path);
    if (tokens.length > 1) {
      return this.nested(this.item(tokens[0], path), { op: 'test', path: rest(path), value });
    }
    const actual = tokens.length === 0 ? this.data() : this.dataAt(this.item(tokens[0], path));
    if (!equal(actual, value)) throw new PatchError(`test failed: the value at "${path}" differs`);
  }

  /** L6, L7: `move` and `copy`. Within one item, the `json` adapter's own operation; between items,
   *  the value's bytes (a moved item keeps its whole line, README reading 2). */
  private carry(op: Extract<PatchOperation, { op: 'move' | 'copy' }>): void {
    const from = parsePointer(op.from);
    const to = parsePointer(op.path);
    if (op.op === 'move') {
      if (from.length < to.length && from.every((token, i) => token === to[i]))
        throw new PatchError(`cannot move "${op.from}" into itself`);
      if (op.path === op.from) {
        this.source(op.from, from);
        return;
      }
    }
    if (from.length >= 1 && to.length >= 2 && from[0] === to[0]) {
      const index = this.item(from[0], op.from);
      return this.nested(index, { op: op.op, from: rest(op.from), path: rest(op.path) });
    }
    const piece = this.source(op.from, from);
    if (op.op === 'move') this.remove(op.from);
    const wholeLine = op.op === 'move' && from.length === 1 && to.length === 1;
    this.put('add', op.path, 'bytes' in piece && !wholeLine ? { bytes: piece.bytes } : piece);
  }

  /** What `from` holds: the items' data at the root, else the value's bytes (and an item's line). */
  private source(pointer: string, tokens: readonly string[]): Piece {
    if (tokens.length === 0) return { value: this.data() };
    const line = this.lines[this.item(tokens[0], pointer)]!.text;
    const value = valueOf(line);
    if (tokens.length === 1) return { bytes: value, line };
    const node = nodeAt(openJson(value).root!, tokens.slice(1));
    if (!node) throw notFound(pointer);
    return { bytes: value.slice(node.offset, node.offset + node.length) };
  }
}

/** `parseData('jsonl', text)` (spec 008 criterion 6 for JSON Lines, 012 T2): the items, or the first
 *  bad line's message and offset as `parse` reports them; keeps nothing. The same reading as
 *  `classify`, written for speed (criterion 12): CRs are found once per CR rather than per line,
 *  and only a line that starts with a space or a tab is checked for being blank. */
export function parseLinesData(text: string): ParseDataResult {
  const data: unknown[] = [];
  const length = text.length;
  const mayHold = mayHoldBigNumber(text);
  let start = text.startsWith(BOM) ? 1 : 0;
  /** The next CR at or after `start`, or `length`. */
  let cr = text.indexOf('\r', start);
  if (cr < 0) cr = length;
  for (let number = 1; start < length; number++) {
    let lf = text.indexOf('\n', start);
    if (lf < 0) lf = length;
    let end = lf;
    let bad = false;
    if (cr < lf) {
      // A CR right before the LF is the line ending; any other is a lone CR (§Terms).
      if (cr === lf - 1 && lf < length) end = cr;
      else bad = true;
      cr = text.indexOf('\r', lf);
      if (cr < 0) cr = length;
    }
    if (!bad) {
      let i = start;
      while (i < end && (text.charCodeAt(i) === 32 || text.charCodeAt(i) === 9)) i++;
      if (i < end) {
        try {
          data.push(itemData(text.slice(start, end), mayHold));
        } catch {
          bad = true;
        }
      }
    }
    if (bad) return { error: { message: badLine(number), offset: number === 1 ? 0 : start } };
    start = lf + 1;
  }
  return { data };
}

function makeAdapter(): FormatAdapter {
  // Each text is split and read once, however many callers parse or edit it (cache.ts).
  const analysis = lastText(split);
  const results = new WeakMap<Lines, ParseResult>();
  const lines = (text: string): Lines => analysis(text);
  return {
    format: 'jsonl',
    parse: (text) => {
      const doc = lines(text);
      let result = results.get(doc);
      if (!result) results.set(doc, (result = parse(text, doc)));
      return result;
    },
    applyPatch: (text, patch) => {
      const doc = lines(text);
      refuseBadLines(doc);
      const editor = new Editor(doc);
      for (const op of patch) editor.apply(op);
      return editor.text();
    },
    stringify: (data, style) => stringify(data, 'jsonl', style),
    compact: (text) => {
      // R12 on each item; blank lines and line endings stay.
      const doc = lines(text);
      refuseBadLines(doc);
      return join({
        bom: doc.bom,
        lines: doc.lines.map((line) =>
          line.kind === 'item'
            ? { ...line, text: compactValue(valueOf(line.text), openJson) }
            : line,
        ),
      });
    },
    sort: (text, options: SortOptions = {}) => {
      const doc = lines(text);
      refuseBadLines(doc);
      const path = options.path ?? '';
      const tokens = parsePointer(path);
      const items = doc.lines.flatMap((line, index) => (line.kind === 'item' ? [index] : []));
      if (tokens.length === 0) {
        // R13 on the root: whole lines reorder; blank lines and each place's ending stay.
        const order = itemOrder(
          items.map((index) => doc.lines[index]!.data),
          options,
        );
        if (order.every((from, to) => from === to)) return text;
        const sorted = [...doc.lines];
        items.forEach((index, to) => {
          sorted[index] = { ...doc.lines[index]!, text: doc.lines[items[order[to]!]!]!.text };
        });
        return join({ bom: doc.bom, lines: sorted });
      }
      // A nested sort sorts inside one item (L7).
      const position = parseIndex(tokens[0]!);
      const index = position === undefined ? undefined : items[position];
      if (index === undefined) throw notFound(path);
      const sorted = [...doc.lines];
      sorted[index] = {
        ...doc.lines[index]!,
        text: editValue(doc.lines[index]!.text, (value) =>
          sortValue(value, openJson, { ...options, path: rest(path) }),
        ),
      };
      return join({ bom: doc.bom, lines: sorted });
    },
    prettyPrint: () => {
      throw new PatchError('Format is not available for JSON Lines.');
    },
  };
}

export const jsonlAdapter = makeAdapter();
