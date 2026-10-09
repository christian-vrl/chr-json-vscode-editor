// JSON and JSONC adapter primitives on jsonc-parser (002 T3, plan 002 §Approach: JSON = JSONC with
// strict diagnostics). Patch operations are computed by the shared edit layer
// (`edit.ts`) from `parseTree` offsets and the scanner's tokens rather than jsonc-parser's `modify`
// (plan 002 risk R1).
import { parseTree, printParseErrorCode, visit, type Node, type ParseError } from 'jsonc-parser';
import { compact, prettyPrint, sort } from './actions.js';
import { lastText } from './cache.js';
import { applyOperation, Doc, type Open, type Rebuild, type Writer } from './edit.js';
import { detectStyle } from './style.js';
import { stringify } from './stringify.js';
import { isComment, Kind, tokenize, type Token } from './tokens.js';
import {
  PatchError,
  type Diagnostic,
  type Format,
  type FormatAdapter,
  type ParseResult,
  type Style,
} from './types.js';

const parseOptions = { allowTrailingComma: true, disallowComments: false };

/** One parse of a text: tree, tokens and style, shared by `parse` and the edit layer. */
interface Analysis {
  root: Node | undefined;
  errors: ParseError[];
  tokens: Token[];
  style: Style;
}

function analyze(text: string, format: Format): Analysis {
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, parseOptions);
  const tokens = tokenize(text);
  return { root, errors, tokens, style: detectStyle(text, format, tokens) };
}

function parse(analysis: Analysis, text: string, format: Format): ParseResult {
  const { root, errors, tokens, style } = analysis;
  const diagnostics: Diagnostic[] = errors.map((e) => ({
    severity: 'error',
    message: printParseErrorCode(e.error),
    offset: e.offset,
    length: e.length,
  }));
  if (format === 'json') diagnostics.push(...strictJsonWarnings(tokens));
  diagnostics.sort((a, b) => a.offset - b.offset);
  return { data: parseData(text), tree: root, style, diagnostics };
}

/**
 * The document's data, built like jsonc-parser's `parse` (same visitor, same error tolerance) except
 * that object members are defined as own properties. `parse` assigns them, so a `"__proto__"` key
 * set the object's prototype instead of becoming a member and its data was lost.
 */
function parseData(text: string): unknown {
  const root: unknown[] = [];
  let parent: unknown[] | Record<string, unknown> = root;
  let property: string | null = null;
  const parents: (unknown[] | Record<string, unknown>)[] = [];
  const onValue = (value: unknown): void => {
    if (Array.isArray(parent)) parent.push(value);
    else if (property !== null)
      Object.defineProperty(parent, property, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
  };
  const begin = (container: unknown[] | Record<string, unknown>): void => {
    onValue(container);
    parents.push(parent);
    parent = container;
    property = null;
  };
  const end = (): void => {
    parent = parents.pop()!;
  };
  visit(
    text,
    {
      onObjectBegin: () => begin({}),
      onObjectProperty: (name) => {
        property = name;
      },
      onObjectEnd: end,
      onArrayBegin: () => begin([]),
      onArrayEnd: end,
      onLiteralValue: onValue,
    },
    parseOptions,
  );
  return root[0];
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

/** JSON and JSONC always write double quotes and quoted keys (R4), and values as `JSON.stringify`
 *  does (R8). */
const writer: Writer = {
  key: (name) => JSON.stringify(name),
  value: (value, unit) => {
    const json = JSON.stringify(value, null, unit);
    if (json === undefined) throw new PatchError('value is not JSON');
    return json;
  },
};

/** The text as a `Doc` to edit. A text with no value (empty, white space or comments only) opens
 *  with no root (R15); one with a syntax error cannot be edited. */
function open({ root, errors, tokens, style }: Analysis, text: string, format: Format): Doc {
  const rebuild: Rebuild = (next, nextRoot, nextTokens) =>
    new Doc(
      next,
      nextRoot,
      nextTokens,
      detectStyle(next, format, nextTokens),
      writer,
      '\n',
      rebuild,
    );
  if (root === undefined && noValue(text)) return new Doc(text, undefined, tokens, style, writer);
  if (errors.length > 0 || root === undefined) {
    const first = errors[0];
    throw new PatchError(
      first
        ? `cannot edit a document that does not parse: ${printParseErrorCode(first.error)} at offset ${first.offset}`
        : 'cannot edit a document that does not parse',
    );
  }
  return new Doc(text, root, tokens, style, writer, '\n', rebuild);
}

/** Whether the text is only white space and complete comments: a value on a line after it parses. */
function noValue(text: string): boolean {
  const errors: ParseError[] = [];
  return parseTree(`${text}\nnull`, errors, parseOptions)?.type === 'null' && errors.length === 0;
}

/** Each format's `Doc` for a text, as its edits open it (for tests of `Doc.without`). */
export const openDocs = new Map<'json' | 'jsonc', Open>();

function makeAdapter(format: 'json' | 'jsonc'): FormatAdapter {
  // Each text is parsed once, however many callers parse or edit it (cache.ts).
  const analysis = lastText((text) => analyze(text, format));
  // The parse result lives with the analysis, so a `parse` never leaves an edit's parse behind.
  const results = new WeakMap<Analysis, ParseResult>();
  const parsed = (text: string): ParseResult => {
    const a = analysis(text);
    let result = results.get(a);
    if (!result) results.set(a, (result = parse(a, text, format)));
    return result;
  };
  const edited: Open = (text) => open(analysis(text), text, format);
  openDocs.set(format, edited);
  return {
    format,
    parse: parsed,
    applyPatch: (text, patch) =>
      patch.reduce((current, op) => applyOperation(current, op, edited), text),
    stringify: (data, style) => stringify(data, format, style),
    compact: (text) => compact(text, edited),
    sort: (text, options) => sort(text, edited, options),
    prettyPrint: (text) => prettyPrint(text, edited),
  };
}

export const jsonAdapter = makeAdapter('json');
export const jsoncAdapter = makeAdapter('jsonc');
