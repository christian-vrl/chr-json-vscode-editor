// Option A: jsonc-parser's parseTree (offsets per node). Any parse error fails the case, since a
// tree recovered from errors cannot be trusted for edits.
import { parseTree, printParseErrorCode, type Node, type ParseError } from 'jsonc-parser';
import { applyPatch, type CstNode } from '../engine.ts';
import type { Option } from './option.ts';

function toCst(n: Node): CstNode {
  const start = n.offset;
  const end = n.offset + n.length;
  if (n.type === 'object') {
    const members = (n.children ?? []).map((p) => {
      const [k, v] = p.children ?? [];
      if (!k || !v) throw new Error('property without key or value');
      return {
        key: String(k.value),
        keyStart: k.offset,
        keyEnd: k.offset + k.length,
        value: toCst(v),
      };
    });
    return { kind: 'object', start, end, members };
  }
  if (n.type === 'array')
    return { kind: 'array', start, end, items: (n.children ?? []).map(toCst) };
  return { kind: 'scalar', start, end };
}

function parse(text: string): CstNode {
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) {
    const e = errors[0]!;
    throw new Error(
      `${errors.length} parse error(s), first ${printParseErrorCode(e.error)} at offset ${e.offset}`,
    );
  }
  if (!root) throw new Error('no tree');
  return toCst(root);
}

export const option: Option = {
  id: 'A',
  name: 'jsonc-parser 3.3.1',
  packages: ['jsonc-parser'],
  via: 'parseTree → shared engine',
  apply: (text, ops) => applyPatch(text, ops, parse),
  parse,
};
