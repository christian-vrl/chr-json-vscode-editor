// Option D: jsonc-eslint-parser (acorn based) with jsonSyntax json5.
import { parseJSON, type AST } from 'jsonc-eslint-parser';
import { applyPatch, type CstNode } from '../engine.ts';
import type { Option } from './option.ts';

function toCst(n: AST.JSONExpression): CstNode {
  const [start, end] = n.range;
  if (n.type === 'JSONObjectExpression') {
    const members = n.properties.map((p) => {
      const k = p.key;
      const key = k.type === 'JSONIdentifier' ? k.name : String(k.value);
      return { key, keyStart: k.range[0], keyEnd: k.range[1], value: toCst(p.value) };
    });
    return { kind: 'object', start, end, members };
  }
  if (n.type === 'JSONArrayExpression') {
    const items = n.elements.map((e) => {
      if (!e) throw new Error('array hole');
      return toCst(e);
    });
    return { kind: 'array', start, end, items };
  }
  return { kind: 'scalar', start, end };
}

function parse(text: string): CstNode {
  return toCst(parseJSON(text, { jsonSyntax: 'json5' }).body[0].expression);
}

export const option: Option = {
  id: 'D',
  name: 'jsonc-eslint-parser 3.3.0',
  packages: ['jsonc-eslint-parser'],
  via: "parseJSON(jsonSyntax: 'json5') → shared engine",
  apply: (text, ops) => applyPatch(text, ops, parse),
  parse,
};
