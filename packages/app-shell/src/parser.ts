// The library's `parser` prop backed by core (003 T5, spec 003 criterion 10, plan 003 §Approach):
// vanilla-jsoneditor parses text with it instead of `JSON.parse`, so JSONC comments and JSON5
// syntax reach the tree and table views as data and are never lost on the way there. `stringify`
// stays `JSON.stringify`: the editor only writes text for display or copy, while the document's
// text always comes from the host (core's style-preserving `applyPatch`).
// A large-file tab (spec 008 criterion 8) parses with core's data-only `parseData`, which builds the
// data alone and keeps nothing in core's parse cache; strict JSON still goes through `JSON.parse`.
// JSON Lines (spec 012) never takes the `JSON.parse` fast path: a one-line JSON Lines text is valid
// JSON whose data is the item, not the array of items (plan 012 risk R2). Its bad lines are no parse
// error: the data is the items of the other lines (L1), shown read-only under the bad-line banner.
// Core reads big numbers as lossless-json `LosslessNumber`s (spec 015 B1). Until this parser
// writes them back (015 T4), the editor gets their nearest numbers, as `JSON.parse` gives.
import {
  getAdapter,
  mayHoldBigNumber,
  nearestNumbers,
  parseData,
  type Format,
} from '@chr-json-editor/core';

/** The shape of vanilla-jsoneditor's `JSONParser` (index.d.ts, `interface JSONParser`). */
export interface TextParser {
  parse(
    text: string,
    reviver?: ((this: unknown, key: string, value: unknown) => unknown) | null,
  ): unknown;
  stringify(
    value: unknown,
    replacer?:
      ((this: unknown, key: string, value: unknown) => unknown) | (number | string)[] | null,
    space?: string | number,
  ): string | undefined;
}

const parsers = new Map<string, TextParser>();

/** One parser per format (and per kind, `large` for a large-file tab), so the library sees the
 *  same object until the format changes. */
export function parserFor(format: Format, large = false): TextParser {
  const key = large ? `${format}:large` : format;
  let parser = parsers.get(key);
  if (!parser) {
    parser = large ? createDataParser(format) : createParser(format);
    parsers.set(key, parser);
  }
  return parser;
}

/** The large-file parser: the data alone, with the same errors as `createParser`'s. */
function createDataParser(format: Format): TextParser {
  return {
    parse(text) {
      const result = parseData(format, text);
      if ('error' in result) {
        throw new SyntaxError(`${result.error.message} at position ${result.error.offset}`);
      }
      // Only text without a value (empty, whitespace, comments) reads as undefined.
      if (result.data === undefined) throw new SyntaxError('The document holds no value');
      return nearest(text, result.data);
    },
    stringify,
  };
}

function stringify(
  value: unknown,
  replacer?: ((this: unknown, key: string, value: unknown) => unknown) | (number | string)[] | null,
  space?: string | number,
): string | undefined {
  return JSON.stringify(value, replacer as Parameters<typeof JSON.stringify>[1], space);
}

function createParser(format: Format): TextParser {
  const adapter = getAdapter(format);
  if (format === 'jsonl')
    return { parse: (text) => nearest(text, adapter.parse(text).data), stringify };
  return {
    parse(text) {
      // Valid JSON is valid JSONC and JSON5 with the same data, and `JSON.parse` reads it many
      // times faster than core (UNK-014; it also defines a `__proto__` key as a member, as core
      // does). Anything else, comments and JSON5 syntax included, goes to core.
      const data = parseStrictJson(text);
      if (data !== NOT_JSON) return data;
      const result = adapter.parse(text);
      // A text with an error diagnostic does not parse, whatever `data` holds (002 T5 F1: JSON5
      // returns `data` undefined with one error); warnings (JSON's strict-mode notes) do not count.
      const error = result.diagnostics.find((d) => d.severity === 'error');
      if (error) throw new SyntaxError(`${error.message} at position ${error.offset}`);
      if (result.tree === undefined) throw new SyntaxError('The document holds no value');
      return nearest(text, result.data);
    },
    stringify,
  };
}

/** `data` with its big numbers as nearest numbers; a text that holds none is not walked. */
const nearest = (text: string, data: unknown): unknown =>
  mayHoldBigNumber(text) ? nearestNumbers(data) : data;

const NOT_JSON = Symbol('not JSON');

/** The text's data when it is strict JSON (RFC 8259), else `NOT_JSON`. */
function parseStrictJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return NOT_JSON;
  }
}
