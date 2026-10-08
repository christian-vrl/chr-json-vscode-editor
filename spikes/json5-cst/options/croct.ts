// Options E and E': @croct/json5-parser, a JSON5 CST. E feeds its node locations to the shared
// engine; E' uses the package's own style-learning writer (set/delete/splice + toString).
import {
  JsonArrayNode,
  JsonIdentifierNode,
  JsonObjectNode,
  JsonParser,
  JsonPrimitiveNode,
  type JsonValueNode,
} from '@croct/json5-parser';
import { applyPatch, type CstNode, type PatchOp } from '../engine.ts';
import type { Option } from './option.ts';

function toCst(n: JsonValueNode): CstNode {
  const start = n.location.start.index;
  const end = n.location.end.index;
  if (n instanceof JsonObjectNode) {
    const members = n.properties.map((p) => {
      const k = p.key;
      const key = k instanceof JsonIdentifierNode ? k.toJSON() : String(k.toJSON());
      return {
        key,
        keyStart: k.location.start.index,
        keyEnd: k.location.end.index,
        value: toCst(p.value),
      };
    });
    return { kind: 'object', start, end, members };
  }
  if (n instanceof JsonArrayNode)
    return { kind: 'array', start, end, items: n.elements.map(toCst) };
  if (n instanceof JsonPrimitiveNode || n instanceof JsonIdentifierNode)
    return { kind: 'scalar', start, end };
  throw new Error(`unknown node ${n.constructor.name}`);
}

export const engineOption: Option = {
  id: 'E',
  name: '@croct/json5-parser 0.2.2',
  packages: ['@croct/json5-parser'],
  via: 'JsonParser.parse locations → shared engine',
  apply: (text, ops) => applyPatch(text, ops, (t) => toCst(JsonParser.parse(t))),
  parse: (text) => toCst(JsonParser.parse(text)),
};

function nativeApply(text: string, ops: PatchOp[]): string {
  const root = JsonParser.parse(text);
  for (const op of ops) {
    const tokens = op.path
      .split('/')
      .slice(1)
      .map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));
    const last = tokens.pop();
    if (last === undefined) throw new Error('whole-document ops are out of the spike');
    let parent: JsonValueNode = root;
    for (const t of tokens) {
      parent =
        parent instanceof JsonArrayNode
          ? parent.get(Number(t))
          : parent.cast(JsonObjectNode).get(t);
    }
    const value = op.value as Parameters<JsonObjectNode['set']>[1];
    if (parent instanceof JsonArrayNode) {
      const i = last === '-' ? parent.elements.length : Number(last);
      if (op.op === 'add') parent.splice(i, 0, value);
      else if (op.op === 'remove') parent.delete(i);
      else parent.set(i, value);
    } else {
      const obj = parent.cast(JsonObjectNode);
      if (op.op === 'remove') obj.delete(last);
      else obj.set(last, value);
    }
  }
  return root.toString();
}

export const nativeOption: Option = {
  id: "E'",
  name: '@croct/json5-parser 0.2.2 (own writer)',
  packages: ['@croct/json5-parser'],
  via: 'set / delete / splice → toString()',
  apply: nativeApply,
};
