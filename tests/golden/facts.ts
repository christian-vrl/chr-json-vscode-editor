// Checks that a case's tags describe its own input and patch (002 T1), so a case cannot cover a
// grid cell it does not exercise. The scanner below only needs to tell strings, comments and other
// code apart; it is not a parser for any format.
import { immutableJSONPatch, type JSONPatchDocument } from 'immutable-json-patch';
import JSON5 from 'json5';
import { wholeDocumentOps, type GoldenCase } from './load.js';

interface Scan {
  /** The text with comments removed and every string replaced by `""`. */
  code: string;
  comments: string[];
  strings: { quote: string; body: string; isKey: boolean }[];
}

function scan(text: string): Scan {
  let code = '';
  const comments: string[] = [];
  const strings: Scan['strings'] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (text.startsWith('//', i)) {
      const start = i;
      while (i < text.length && text[i] !== '\n') i++;
      comments.push(text.slice(start, i).replace(/\r$/, ''));
    } else if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      const start = i;
      i = end < 0 ? text.length : end + 2;
      comments.push(text.slice(start, i));
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) j += text[j] === '\\' ? 2 : 1;
      const isKey = /^\s*:/.test(text.slice(j + 1).replace(/^\s*\/\*.*?\*\//s, ''));
      strings.push({ quote: ch, body: text.slice(i + 1, j), isKey });
      code += '""';
      i = j + 1;
    } else {
      code += ch;
      i++;
    }
  }
  return { code, comments, strings };
}

/** The comments of a text, as written. */
export const commentsOf = (text: string): string[] => scan(text).comments;

/** The data of a text, read by the json5 package; `undefined` for a text with no value: empty,
 *  white space or comments only (R15). */
export function parseData(text: string): unknown {
  try {
    return JSON5.parse(text);
  } catch (error) {
    // A text with no value is one after which a lone value parses.
    if (JSON5.parse(`${text}\nnull`) === null) return undefined;
    throw error;
  }
}

function parsePointer(pointer: string): string[] {
  return pointer === ''
    ? []
    : pointer
        .slice(1)
        .split('/')
        .map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function getIn(data: unknown, tokens: string[]): unknown {
  let node = data;
  for (const t of tokens) {
    node = Array.isArray(node) ? node[Number(t)] : (node as Record<string, unknown>)[t];
  }
  return node;
}

/** The `location` tag the op at `index` of `patch` has, on the data left by the ops before it. */
function locationOf(data: unknown, patch: JSONPatchDocument, index: number): string {
  const op = patch[index]!;
  let before = immutableJSONPatch(data, patch.slice(0, index));
  // move = remove at `from`, then add at `path` (RFC 6902 §4.4).
  if (op.op === 'move') before = immutableJSONPatch(before, [{ op: 'remove', path: op.from }]);
  const tokens = parsePointer(op.path);
  // A whole-document action's path names the container it works on: `""` is the root container.
  if (tokens.length === 0) return wholeDocumentOps.includes(op.op) ? 'root' : 'document';
  const last = tokens.at(-1);
  const parent = getIn(before, tokens.slice(0, -1));
  if (Array.isArray(parent)) {
    const insert = op.op === 'add' || op.op === 'move' || op.op === 'copy';
    const end = insert ? parent.length : parent.length - 1;
    if (last === '0') return 'array-start';
    return last === '-' || Number(last) === end ? 'array-end' : 'array-middle';
  }
  return tokens.length === 1 ? 'root' : 'nested-object';
}

const majority = (values: string[], a: string, b: string) => {
  const countA = values.filter((v) => v === a).length;
  const countB = values.length - countA;
  return countA === countB ? undefined : countA > countB ? a : b;
};

/** Tags of `c` that its input and patch contradict, as readable messages. */
export function tagMismatches(c: GoldenCase): string[] {
  const errors: string[] = [];
  const tags = c.tags as Record<string, string>;
  const patch = c.patch as JSONPatchDocument;
  const { code, comments, strings } = scan(c.input);

  const opName = tags.op === 'test-fail' ? 'test' : tags.op!;
  // A test-fail case's failing op is its last `test`; other cases are about their first `op`.
  const ops = patch.map((o) => o.op as string);
  const index = tags.op === 'test-fail' ? ops.lastIndexOf('test') : ops.indexOf(opName);
  if (index < 0) {
    errors.push(`op: patch has no "${opName}" operation`);
  } else {
    const data = parseData(c.input);
    const location = locationOf(data, patch, index);
    if (location !== tags.location) errors.push(`location: path points at ${location}`);
  }

  if ((tags.comments !== 'none') !== comments.length > 0) {
    errors.push(`comments: input has ${comments.length} comment(s)`);
  }
  const trailingComma = /,\s*[\]}]/.test(code) ? 'yes' : 'no';
  if (trailingComma !== tags.trailingComma)
    errors.push(`trailingComma: input says ${trailingComma}`);

  if (c.format === 'json5') {
    const values = strings.filter((s) => !s.isKey).map((s) => s.quote);
    const quote = majority(values, "'", '"');
    if (quote !== undefined && (quote === "'" ? 'single' : 'double') !== tags.quote) {
      errors.push(`quote: most strings use ${quote}`);
    }
    const keys = [
      ...strings.filter((s) => s.isKey).map(() => 'quoted'),
      ...(code.match(/[A-Za-z_$][\w$]*\s*:/g) ?? []).map(() => 'unquoted'),
    ];
    const keyStyle = majority(keys, 'quoted', 'unquoted');
    if (keyStyle !== undefined && keyStyle !== tags.keyStyle) {
      errors.push(`keyStyle: most keys are ${keyStyle}`);
    }
    const special = [
      /\b0x[0-9a-f]+/i.test(code) && 'hex',
      /\b(Infinity|NaN)\b/.test(code) && 'infinity-nan',
      strings.some((s) => /\\\r?\n/.test(s.body)) && 'multiline-string',
    ].filter((s): s is string => typeof s === 'string');
    if (tags.special === 'none' ? special.length > 0 : !special.includes(tags.special!)) {
      errors.push(`special: input has ${special.join(', ') || 'none'}`);
    }
  }
  return errors;
}
