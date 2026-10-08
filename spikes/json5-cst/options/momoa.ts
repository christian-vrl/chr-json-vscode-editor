// Option C: @humanwhocodes/momoa in json5 mode with ranges.
import { parse as momoaParse, type ValueNode } from '@humanwhocodes/momoa';
import { applyPatch, type CstNode } from '../engine.ts';
import type { Option } from './option.ts';

function range(n: { range?: [number, number] }): [number, number] {
  if (!n.range) throw new Error('node without range');
  return n.range;
}

function toCst(n: ValueNode): CstNode {
  const [start, end] = range(n);
  if (n.type === 'Object') {
    const members = n.members.map((m) => {
      const [keyStart, keyEnd] = range(m.name);
      const key = m.name.type === 'String' ? m.name.value : m.name.name;
      return { key, keyStart, keyEnd, value: toCst(m.value) };
    });
    return { kind: 'object', start, end, members };
  }
  if (n.type === 'Array')
    return { kind: 'array', start, end, items: n.elements.map((e) => toCst(e.value)) };
  return { kind: 'scalar', start, end };
}

function parse(text: string): CstNode {
  return toCst(momoaParse(text, { mode: 'json5', ranges: true, allowTrailingCommas: true }).body);
}

export const option: Option = {
  id: 'C',
  name: '@humanwhocodes/momoa 3.3.13',
  packages: ['@humanwhocodes/momoa'],
  via: "parse(mode: 'json5', ranges) → shared engine",
  apply: (text, ops) => applyPatch(text, ops, parse),
  parse,
};
