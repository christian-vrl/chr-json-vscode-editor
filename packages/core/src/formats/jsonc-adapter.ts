// JSON and JSONC adapter primitives on jsonc-parser (002 T3, plan 002 §Approach: JSON = JSONC with
// strict diagnostics). `add`, `replace` and `remove` are computed from `parseTree` offsets and the
// scanner's tokens rather than jsonc-parser's `modify` (plan 002 risk R1), following rules R1–R6,
// R8 and R10 of spec 002 and the readings in tests/golden/README.md.
import { parse as parseJsonc, parseTree, printParseErrorCode, type ParseError } from 'jsonc-parser';
import { parseIndex, parsePointer } from './pointer.js';
import { detectStyle } from './style.js';
import { isComment, Kind, tokenAt, tokenFrom, tokenize, type Token } from './tokens.js';
import {
  PatchError,
  type Diagnostic,
  type Format,
  type FormatAdapter,
  type FormatNode,
  type ParseResult,
  type PatchOperation,
  type Style,
} from './types.js';

const parseOptions = { allowTrailingComma: true, disallowComments: false };

function parse(text: string, format: Format): ParseResult {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, parseOptions);
  const tokens = tokenize(text);
  const diagnostics: Diagnostic[] = errors.map((e) => ({
    severity: 'error',
    message: printParseErrorCode(e.error),
    offset: e.offset,
    length: e.length,
  }));
  if (format === 'json') diagnostics.push(...strictJsonWarnings(tokens));
  diagnostics.sort((a, b) => a.offset - b.offset);
  return {
    data: parseJsonc(text, [], parseOptions) as unknown,
    tree,
    style: detectStyle(text, format, tokens),
    diagnostics,
  };
}

/** Comments and trailing commas are not RFC 8259; in a `.json` file they are warnings, not load
 *  failures (spec 002 §Scope). */
function strictJsonWarnings(tokens: readonly Token[]): Diagnostic[] {
  const warnings: Diagnostic[] = [];
  let comma: Token | undefined;
  for (const t of tokens) {
    if (isComment(t)) {
      warnings.push({
        severity: 'warning',
        message: 'Comments are not allowed in JSON',
        offset: t.offset,
        length: t.end - t.offset,
      });
      continue;
    }
    if (t.kind === Kind.Whitespace || t.kind === Kind.LineBreak) continue;
    if (comma && (t.kind === Kind.CloseBrace || t.kind === Kind.CloseBracket)) {
      warnings.push({
        severity: 'warning',
        message: 'Trailing commas are not allowed in JSON',
        offset: comma.offset,
        length: 1,
      });
    }
    comma = t.kind === Kind.Comma ? t : undefined;
  }
  return warnings;
}

interface Edit {
  offset: number;
  end: number;
  text: string;
}

/** A document being edited: text, tree and tokens for one operation. */
class Doc {
  readonly tokens: Token[];
  readonly root: FormatNode;
  readonly style: Style;
  readonly unit: string;

  constructor(
    readonly text: string,
    format: Format,
  ) {
    const errors: ParseError[] = [];
    const root = parseTree(text, errors, parseOptions);
    if (errors.length > 0 || root === undefined) {
      const first = errors[0];
      throw new PatchError(
        first
          ? `cannot edit a document that does not parse: ${printParseErrorCode(first.error)} at offset ${first.offset}`
          : 'cannot edit an empty document',
      );
    }
    this.root = root;
    this.tokens = tokenize(text);
    this.style = detectStyle(text, format, this.tokens);
    this.unit = this.style.indent === '\t' ? '\t' : ' '.repeat(this.style.indent);
  }

  apply(edits: Edit[]): string {
    let text = this.text;
    for (const e of [...edits].sort((a, b) => b.offset - a.offset)) {
      text = text.slice(0, e.offset) + e.text + text.slice(e.end);
    }
    return text;
  }

  lineStart(offset: number): number {
    return this.text.lastIndexOf('\n', offset - 1) + 1;
  }

  indentAt(offset: number): string {
    const start = this.lineStart(offset);
    return /^[ \t]*/.exec(this.text.slice(start, offset))![0];
  }

  /** `value` as JSON (R8). In a multi-line container a new object or array is written like
   *  `JSON.stringify(value, null, unit)`, indented from its member's line (README reading 5). */
  serialize(value: unknown, indent: string, multiLine: boolean): string {
    const json = multiLine ? JSON.stringify(value, null, this.unit) : JSON.stringify(value);
    if (json === undefined) throw new PatchError('value is not JSON');
    return json.replace(/\n/g, this.style.eol + indent);
  }

  /** Where the member's same-line tail ends: its comma (if any) and the comments after the value
   *  on its line. `lineBreak` is the token ending that line, when nothing else follows on it. */
  tail(member: FormatNode): { comma?: Token; end: number; lineBreak?: Token } {
    let i = tokenFrom(this.tokens, member.offset + member.length);
    let comma: Token | undefined;
    let end = member.offset + member.length;
    for (; i < this.tokens.length; i++) {
      const t = this.tokens[i]!;
      if (t.kind === Kind.Whitespace) continue;
      if (t.kind === Kind.LineBreak) return { comma, end, lineBreak: t };
      if (isComment(t) && !this.text.slice(t.offset, t.end).includes('\n')) end = t.end;
      else if (t.kind === Kind.Comma && !comma) {
        comma = t;
        end = t.end;
      } else break;
    }
    return { comma, end };
  }

  /** Whether only whitespace precedes the member on its line. */
  startsLine(member: FormatNode): boolean {
    let i = tokenAt(this.tokens, member.offset) - 1;
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
    let i = tokenAt(this.tokens, member.offset) - 1;
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

/** The node `tokens` lead to, with its parent container and its member node (the property for an
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

function replace(doc: Doc, value: FormatNode, newValue: unknown, container?: FormatNode): string {
  const multiLine =
    container === undefined ||
    doc.text.slice(container.offset, container.offset + container.length).includes('\n');
  const indent = container === undefined ? '' : doc.indentAt(value.offset);
  return doc.apply([
    {
      offset: value.offset,
      end: value.offset + value.length,
      text: doc.serialize(newValue, indent, multiLine),
    },
  ]);
}

/** The separator between members of a single-line container: the first one used, else `, ` (R3). */
function separator(doc: Doc, items: readonly FormatNode[]): string {
  const first = items[0];
  const second = items[1];
  if (!first || !second) return ', ';
  const comma = doc.tail(first).comma;
  return comma ? doc.text.slice(comma.offset, second.offset) : ', ';
}

function add(doc: Doc, target: Target, newValue: unknown): string {
  const { container, member, value, index, key } = target;
  if (!container) return replace(doc, value!, newValue);
  // RFC 6902 §4.1: adding an existing object member replaces its value.
  if (container.type === 'object' && member) return replace(doc, value!, newValue, container);
  const items = children(container);
  const name = container.type === 'object' ? `${JSON.stringify(key)}: ` : '';
  const eol = doc.style.eol;

  if (index < items.length) {
    // Insert before the member now at that index (R2), above its attached comments (UNK-022 ★).
    const next = items[index]!;
    if (doc.ownLines(next)) {
      const indent = doc.indentAt(next.offset);
      const at = doc.blockStart(next);
      const text = `${indent}${name}${doc.serialize(newValue, indent, true)},${eol}`;
      return doc.apply([{ offset: at, end: at, text }]);
    }
    const text = `${name}${doc.serialize(newValue, '', false)}${separator(doc, items)}`;
    return doc.apply([{ offset: next.offset, end: next.offset, text }]);
  }

  const last = items[items.length - 1];
  if (!last) return addToEmpty(doc, container, name, newValue);
  const tail = doc.tail(last);
  const trailing = tail.comma !== undefined;
  if (doc.ownLines(last)) {
    // Append on a new line after the last member's tail, indented like it (R1, R2). Its comma goes
    // right after its value, before a same-line comment (README reading 1); a trailing comma stays
    // trailing (R6).
    const indent = doc.indentAt(last.offset);
    const text = `${eol}${indent}${name}${doc.serialize(newValue, indent, true)}${trailing ? ',' : ''}`;
    const lastEnd = last.offset + last.length;
    const edits: Edit[] = [{ offset: tail.end, end: tail.end, text }];
    if (!trailing) edits.push({ offset: lastEnd, end: lastEnd, text: ',' });
    return doc.apply(edits);
  }
  // Single-line container: join with the separator already used (R3).
  const sep = separator(doc, items);
  const member_ = `${name}${doc.serialize(newValue, '', false)}`;
  if (trailing)
    return doc.apply([
      { offset: tail.comma!.end, end: tail.comma!.end, text: `${sep.slice(1)}${member_},` },
    ]);
  return doc.apply([{ offset: tail.end, end: tail.end, text: `${sep}${member_}` }]);
}

/** A container with no members. One already written over several lines gets the member on its
 *  own line at the parent's indent plus one unit (R1); otherwise it stays on one line (R3). */
function addToEmpty(doc: Doc, container: FormatNode, name: string, newValue: unknown): string {
  const open = container.offset + 1;
  const close = container.offset + container.length - 1;
  if (!doc.text.slice(open, close).includes('\n')) {
    return doc.apply([
      { offset: open, end: close, text: `${name}${doc.serialize(newValue, '', false)}` },
    ]);
  }
  const indent = doc.indentAt(container.offset) + doc.unit;
  const at = doc.text.lastIndexOf('\n', close) + 1;
  const text = `${indent}${name}${doc.serialize(newValue, indent, true)}${doc.style.eol}`;
  return doc.apply([{ offset: at, end: at, text }]);
}

function remove(doc: Doc, target: Target): string {
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
    return doc.apply(edits);
  }
  if (!isLast) {
    return doc.apply([{ offset: member.offset, end: items[index + 1]!.offset, text: '' }]);
  }
  if (!previous) return doc.apply([{ offset: member.offset, end: tail.end, text: '' }]);
  const prevComma = doc.tail(previous).comma!;
  // `[1, 2,]` → `[1,]`: the trailing comma stays (R6); `[1, 2]` → `[1]`.
  return tail.comma
    ? doc.apply([{ offset: prevComma.end, end: tail.comma.end, text: '' }])
    : doc.apply([{ offset: prevComma.offset, end: tail.end, text: '' }]);
}

function applyOperation(text: string, op: PatchOperation, format: Format): string {
  const doc = new Doc(text, format);
  switch (op.op) {
    case 'add':
      return add(doc, resolve(doc.root, op.path), op.value);
    case 'replace': {
      const target = resolve(doc.root, op.path);
      if (!target.value) throw new PatchError(`path "${op.path}" does not exist`);
      return replace(doc, target.value, op.value, target.container);
    }
    case 'remove':
      return remove(doc, resolve(doc.root, op.path));
    default:
      throw new PatchError(`operation "${op.op}" is not supported yet (002 T6)`);
  }
}

function makeAdapter(format: 'json' | 'jsonc'): FormatAdapter {
  return {
    format,
    parse: (text) => parse(text, format),
    applyPatch: (text, patch) =>
      patch.reduce((current, op) => applyOperation(current, op, format), text),
  };
}

export const jsonAdapter = makeAdapter('json');
export const jsoncAdapter = makeAdapter('jsonc');
