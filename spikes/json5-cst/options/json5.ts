// Option B: json5 keeps no positions, so the only way to edit is parse → change data → stringify
// with the file's indent and majority quote. Comments and literal spellings cannot survive.
import JSON5 from 'json5';
import type { PatchOp } from '../engine.ts';
import type { Option } from './option.ts';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function applyData(doc: Json, op: PatchOp): Json {
  const tokens = op.path
    .split('/')
    .slice(1)
    .map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));
  const last = tokens.pop();
  if (last === undefined) throw new Error('whole-document ops are out of the spike');
  let parent = doc;
  for (const t of tokens) {
    if (parent === null || typeof parent !== 'object')
      throw new Error(`path not found: ${op.path}`);
    parent = Array.isArray(parent) ? parent[Number(t)]! : parent[t]!;
  }
  if (Array.isArray(parent)) {
    const i = last === '-' ? parent.length : Number(last);
    if (op.op === 'add') parent.splice(i, 0, op.value as Json);
    else if (op.op === 'remove') parent.splice(i, 1);
    else parent[i] = op.value as Json;
  } else if (parent !== null && typeof parent === 'object') {
    if (op.op === 'remove') delete parent[last];
    else parent[last] = op.value as Json;
  } else throw new Error(`not a container: ${op.path}`);
  return doc;
}

function apply(text: string, ops: PatchOp[]): string {
  let doc = JSON5.parse<Json>(text);
  for (const op of ops) doc = applyData(doc, op);
  const indent = /\n([ \t]+)\S/.exec(text)?.[1] ?? '';
  const single = (text.match(/'/g) ?? []).length;
  const double = (text.match(/"/g) ?? []).length;
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  let out = JSON5.stringify(doc, { space: indent, quote: single > double ? "'" : '"' });
  if (eol === '\r\n') out = out.replace(/\n/g, '\r\n');
  return /\r?\n$/.test(text) ? out + eol : out;
}

export const option: Option = {
  id: 'B',
  name: 'json5 2.2.3',
  packages: ['json5'],
  via: 'parse → change data → JSON5.stringify (no positions)',
  apply,
  parse: (text) => JSON5.parse(text),
};
