// JSON5 adapter (002 T5, ADR-009) on our own parser (`json5-parser.ts`). Patch operations run
// through the edit layer shared with JSON and JSONC (`edit.ts`); this adapter supplies
// JSON5's tree, tokens and line terminators, and writes new keys and values by R4 and R8.
import { compact, sort } from './actions.js';
import { applyOperation, Doc, type Writer } from './edit.js';
import { parseJson5 } from './json5-parser.js';
import { detectStyle } from './style.js';
import { stringify } from './stringify.js';
import {
  PatchError,
  type FormatAdapter,
  type FormatNode,
  type ParseResult,
  type Style,
} from './types.js';

/** Keys written without quotes, as in `stringify`: an ASCII ES5 IdentifierName. */
const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function parse(text: string): ParseResult {
  const { data, tree, tokens, error } = parseJson5(text);
  return {
    data,
    tree,
    style: detectStyle(text, 'json5', tokens),
    diagnostics: error ? [error] : [],
  };
}

/** A string in the file's quote character (R4). */
const string = (s: string, style: Style): string =>
  stringify(s, 'json5', { ...style, finalNewline: false });

function writer(text: string, style: Style): Writer {
  return {
    // R4: unquoted when identifier-safe and most of the object's keys are unquoted (the file's key
    // style for an object with no keys yet).
    key(name, container: FormatNode) {
      let quoted = 0;
      let unquoted = 0;
      for (const property of container.children ?? []) {
        const c = text[property.offset];
        if (c === '"' || c === "'") quoted++;
        else unquoted++;
      }
      const bare = quoted + unquoted === 0 ? style.unquotedKeys : unquoted > quoted;
      return bare && identifier.test(name) ? name : string(name, style);
    },
    // R8: written as `JSON.stringify` would, with the file's quote and key style, and no trailing
    // commas inside a new container (R6: a container gains none).
    value(value, unit) {
      try {
        return stringify(value, 'json5', {
          ...style,
          indent: unit === undefined ? 0 : unit === '\t' ? '\t' : unit.length,
          eol: '\n',
          finalNewline: false,
          trailingCommas: false,
        });
      } catch (e) {
        if (e instanceof TypeError) throw new PatchError(e.message);
        throw e;
      }
    },
  };
}

/** The text as a `Doc` to edit, with no root when it holds no value (R15). */
function open(text: string): Doc {
  const { tree, tokens, error } = parseJson5(text);
  const style = detectStyle(text, 'json5', tokens);
  const doc = (root: FormatNode | undefined) =>
    new Doc(text, root, tokens, style, writer(text, style), '\n\r\u2028\u2029');
  if (tree === undefined && parseJson5(`${text}\nnull`).tree?.type === 'null')
    return doc(undefined);
  if (error || tree === undefined) {
    throw new PatchError(`cannot edit a document that does not parse: ${error?.message}`);
  }
  return doc(tree);
}

export const json5Adapter: FormatAdapter = {
  format: 'json5',
  parse,
  applyPatch: (text, patch) =>
    patch.reduce((current, op) => applyOperation(current, op, open), text),
  stringify: (data, style) => stringify(data, 'json5', style),
  compact: (text) => compact(text, open),
  sort: (text, options) => sort(text, open, options),
};
