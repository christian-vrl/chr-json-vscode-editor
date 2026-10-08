// Option F: our own JSON5 parser (own-parser.ts) feeding the shared engine.
import { applyPatch } from '../engine.ts';
import { parseJson5Tree } from '../own-parser.ts';
import type { Option } from './option.ts';

export const option: Option = {
  id: 'F',
  name: 'Own parser (own-parser.ts)',
  packages: [],
  via: 'own recursive descent → shared engine',
  apply: (text, ops) => applyPatch(text, ops, parseJson5Tree),
  parse: parseJson5Tree,
};
