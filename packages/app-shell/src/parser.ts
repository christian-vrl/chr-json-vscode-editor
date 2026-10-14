// The library's `parser` prop backed by core (003 T5, spec 003 criterion 10, plan 003 §Approach):
// vanilla-jsoneditor parses text with it instead of `JSON.parse`, so JSONC comments and JSON5
// syntax reach the tree and table views as data and are never lost on the way there. The editor
// only writes text for display or copy, while the document's text always comes from the host
// (core's style-preserving `applyPatch`).
// A large-file tab (spec 008 criterion 8) parses with core's data-only `parseData`, which builds the
// data alone and keeps nothing in core's parse cache; strict JSON still goes through `JSON.parse`.
// JSON Lines (spec 012) never takes the `JSON.parse` fast path: a one-line JSON Lines text is valid
// JSON whose data is the item, not the array of items (plan 012 risk R2). Its bad lines are no parse
// error: the data is the items of the other lines (L1), shown read-only under the bad-line banner,
// on a large-file tab too (spec 012 criterion 10, 012 T6), where core's `readLines` reads them.
//
// Big numbers (spec 015 B4, 015 T4): the editor's data holds them as core does (B1), as
// `EditorNumber`s (editor-numbers.ts), and `stringify` writes their digits (B2), so the tree and
// table show them, search finds them, a value typed or pasted with more digits than a float holds
// becomes one, and copy puts the exact digits on the clipboard. Strict JSON with no big-number
// candidate (core's `mayHoldBigNumber`, a scan of number-token shapes, spike 015 T1 REPORT §3)
// keeps `JSON.parse`; strict JSON with one goes through lossless-json's parser (`readJsonExact`),
// which reads it several times faster than core. A large-file tab still shows nearest numbers until
// UNK-068 is settled (015 T6), and so does the parser that hands the library's validator its data
// (`validationParserFor`): Ajv validates nearest numbers (B6).
import {
  getAdapter,
  jsonText,
  mayHoldBigNumber,
  nearestNumbers,
  parseData,
  readJsonExact,
  readLines,
  type Format,
} from '@chr-json-editor/core';
import { editorNumber, editorNumbers } from './editor-numbers.js';

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
  return cached(large ? `${format}:large` : format, () =>
    large ? createDataParser(format) : createParser(format),
  );
}

/**
 * The library's `validationParser`: the data `parserFor` gives, with big numbers as their nearest
 * numbers (B6). The library re-reads its data through it only when it differs from `parser`, and
 * only to hand the validator data; the host runs Ajv (ADR-010), on nearest numbers too.
 */
export function validationParserFor(format: Format, large = false): TextParser {
  if (large) return parserFor(format, true);
  return cached(`${format}:validation`, () => {
    const parser = parserFor(format);
    return { parse: (text) => nearestNumbers(parser.parse(text)), stringify };
  });
}

function cached(key: string, create: () => TextParser): TextParser {
  let parser = parsers.get(key);
  if (!parser) {
    parser = create();
    parsers.set(key, parser);
  }
  return parser;
}

/** The last large JSON Lines text read with `readLines`: `badLinesOf` and the large-file parser
 *  read the same text one after the other when a tab opens or its text changes, so it is read once.
 *  The parser takes the data (`data` is then dropped, the library holds it); the bad lines stay. */
let lastLines: { text: string; bad: number[]; data?: unknown[] } | undefined;

function linesOf(text: string): { text: string; bad: number[]; data?: unknown[] } {
  if (lastLines?.text !== text) {
    const { data, bad } = readLines(text);
    lastLines = { text, bad, data };
  }
  return lastLines;
}

/**
 * The 1-based numbers of a JSON Lines text's bad lines (spec 012 criterion 8), empty when there is
 * none. A large-file tab reads them with core's data-only `readLines`, shared with its parser
 * (spec 008 criterion 8: no full parse); a normal tab reads core's parse, the one its parser makes
 * of the same text (core keeps the last parse per format), so neither costs a second read.
 */
export function badLinesOf(text: string, large: boolean): number[] {
  if (large) return linesOf(text).bad;
  const errors = getAdapter('jsonl')
    .parse(text)
    .diagnostics.filter((d) => d.severity === 'error');
  // Each error spans its line (L1), in order: count the line feeds before each one.
  let line = 1;
  let lf = text.indexOf('\n');
  return errors.map(({ offset }) => {
    while (lf >= 0 && lf < offset) {
      line += 1;
      lf = text.indexOf('\n', lf + 1);
    }
    return line;
  });
}

/** The large-file parser: the data alone, with the same errors as `createParser`'s. JSON Lines
 *  gives the items of the lines that are not bad, as its normal parser does (L1, 012 T6). */
function createDataParser(format: Format): TextParser {
  if (format === 'jsonl')
    return {
      parse(text) {
        const lines = linesOf(text);
        const data = lines.data ?? readLines(text).data;
        lines.data = undefined;
        return mayHoldBigNumber(text) ? nearestNumbers(data) : data;
      },
      stringify,
    };
  return {
    parse(text) {
      const result = parseData(format, text);
      if ('error' in result) {
        throw new SyntaxError(`${result.error.message} at position ${result.error.offset}`);
      }
      // Only text without a value (empty, whitespace, comments) reads as undefined.
      if (result.data === undefined) throw new SyntaxError('The document holds no value');
      return mayHoldBigNumber(text) ? nearestNumbers(result.data) : result.data;
    },
    stringify,
  };
}

/**
 * `JSON.stringify` with big numbers written as their digits (B2, core's `jsonText`). The library
 * passes no replacer; one given goes to `JSON.stringify` as it is.
 */
function stringify(
  value: unknown,
  replacer?: ((this: unknown, key: string, value: unknown) => unknown) | (number | string)[] | null,
  space?: string | number,
): string | undefined {
  if (replacer != null)
    return JSON.stringify(value, replacer as Parameters<typeof JSON.stringify>[1], space);
  return jsonText(value, gap(space));
}

/** The indent `JSON.stringify` makes of its `space` argument. */
function gap(space: string | number | undefined): string | undefined {
  if (typeof space === 'number') return ' '.repeat(Math.max(0, Math.min(10, Math.floor(space))));
  if (typeof space === 'string') return space.slice(0, 10);
  return undefined;
}

function createParser(format: Format): TextParser {
  const adapter = getAdapter(format);
  if (format === 'jsonl')
    return {
      parse: (text) => {
        const data = adapter.parse(text).data;
        return mayHoldBigNumber(text) ? editorNumbers(data) : data;
      },
      stringify,
    };
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
      // Core's big numbers (JSON5 hex ones too) as the editor's.
      return editorNumbers(result.data);
    },
    stringify,
  };
}

const NOT_JSON = Symbol('not JSON');

/** The text's data when it is strict JSON (RFC 8259), its big numbers as `EditorNumber`s, else
 *  `NOT_JSON` (core reads it, and reports its error). */
function parseStrictJson(text: string): unknown {
  if (mayHoldBigNumber(text)) {
    const read = readJsonExact(text, editorNumber);
    return read ? read.data : NOT_JSON;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return NOT_JSON;
  }
}
