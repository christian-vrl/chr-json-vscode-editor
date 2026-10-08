// The library's `parser` prop backed by core (003 T5, spec 003 criterion 10, plan 003 §Approach):
// vanilla-jsoneditor parses text with it instead of `JSON.parse`, so JSONC comments and JSON5
// syntax reach the tree and table views as data and are never lost on the way there. `stringify`
// stays `JSON.stringify`: the editor only writes text for display or copy, while the document's
// text always comes from the host (core's style-preserving `applyPatch`).
import { getAdapter, type Format } from '@chr-json-editor/core';

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

const parsers = new Map<Format, TextParser>();

/** One parser per format, so the library sees the same object until the format changes. */
export function parserFor(format: Format): TextParser {
  let parser = parsers.get(format);
  if (!parser) {
    parser = createParser(format);
    parsers.set(format, parser);
  }
  return parser;
}

function createParser(format: Format): TextParser {
  const adapter = getAdapter(format);
  return {
    parse(text) {
      const result = adapter.parse(text);
      // A text with an error diagnostic does not parse, whatever `data` holds (002 T5 F1: JSON5
      // returns `data` undefined with one error); warnings (JSON's strict-mode notes) do not count.
      const error = result.diagnostics.find((d) => d.severity === 'error');
      if (error) throw new SyntaxError(`${error.message} at position ${error.offset}`);
      if (result.tree === undefined) throw new SyntaxError('The document holds no value');
      return result.data;
    },
    stringify(value, replacer, space) {
      return JSON.stringify(value, replacer as Parameters<typeof JSON.stringify>[1], space);
    },
  };
}
