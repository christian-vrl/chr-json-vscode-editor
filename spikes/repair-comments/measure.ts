// Measurement helpers shared by run.ts and fuzz.ts. They find comments and anchors with
// jsonc-parser, independently of the engine's own scanner.
import { createScanner, getNodePath, type Node } from 'jsonc-parser';

// jsonc-parser's `SyntaxKind` is an ambient const enum, which `isolatedModules` cannot read
// (node_modules/jsonc-parser/lib/esm/main.d.ts, as in packages/core/src/formats/tokens.ts).
const LINE_COMMENT = 12;
const BLOCK_COMMENT = 13;
const EOF = 17;

export interface Anchor {
  container: string | null;
  outside?: 'before' | 'after';
  before?: number;
  trailing?: boolean;
  inside?: string;
}

export const pointer = (segments: (string | number)[]): string =>
  segments.map((s) => '/' + String(s).replace(/~/g, '~0').replace(/\//g, '~1')).join('');

export const lineOf = (text: string, offset: number): number => {
  let line = 0;
  for (let i = 0; i < offset; i++) if (text[i] === '\n') line++;
  return line;
};

/** Comments in `text` as jsonc-parser's scanner tokenizes them. */
export function outputComments(text: string): { start: number; end: number; text: string }[] {
  const scanner = createScanner(text, false);
  const found: { start: number; end: number; text: string }[] = [];
  for (let kind: number = scanner.scan(); kind !== EOF; kind = scanner.scan()) {
    if (kind === LINE_COMMENT || kind === BLOCK_COMMENT) {
      const start = scanner.getTokenOffset();
      const end = start + scanner.getTokenLength();
      found.push({ start, end, text: text.slice(start, end) });
    }
  }
  return found;
}

/** The anchor of a comment at [start, end) in a parsed document, in case.json's terms. */
export function anchorOf(text: string, root: Node, start: number, end: number): Anchor {
  if (end <= root.offset) return { container: null, outside: 'before' };
  if (start >= root.offset + root.length) return { container: null, outside: 'after' };
  // Innermost container whose brackets enclose the comment.
  let container = root;
  for (;;) {
    const members = container.children ?? [];
    const holder = members.find((m) => m.offset <= start && end <= m.offset + m.length);
    const value = holder?.type === 'property' ? holder.children?.[1] : holder;
    if (
      value &&
      (value.type === 'object' || value.type === 'array') &&
      value.offset <= start &&
      end <= value.offset + value.length
    ) {
      container = value;
      continue;
    }
    break;
  }
  const members = container.children ?? [];
  const before = members.filter((m) => m.offset + m.length <= start).length;
  const holder = members.find((m) => m.offset < start && end <= m.offset + m.length);
  const anchor: Anchor = { container: pointer(getNodePath(container)), before };
  if (holder) {
    const valueNode = holder.type === 'property' ? holder.children?.[1] : holder;
    anchor.inside = valueNode ? pointer(getNodePath(valueNode)) : '?';
    anchor.trailing = false;
  } else {
    const prev = members[before - 1];
    anchor.trailing = prev
      ? lineOf(text, prev.offset + prev.length) === lineOf(text, start)
      : false;
  }
  return anchor;
}

export const sameAnchor = (a: Anchor, b: Anchor): boolean =>
  a.container === b.container &&
  a.outside === b.outside &&
  a.before === b.before &&
  (a.trailing ?? false) === (b.trailing ?? false) &&
  a.inside === b.inside;
