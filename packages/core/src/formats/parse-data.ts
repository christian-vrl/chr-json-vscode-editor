// Data-only parse for large-file mode (spec 008 criterion 6, plan 008 §Approach). `parse` builds
// the data, a node tree, the token stream and the style, and core keeps the last result per format
// (cache.ts): about 2 GB of heap for a 50 MiB document (bench/RESULTS.md §Memory). `parseData`
// builds the data alone and keeps nothing, while agreeing with `getAdapter(format).parse(text)` on
// the data and, for a text that does not parse, on its first error.
import { printParseErrorCode } from 'jsonc-parser';
import { parseJson5Data } from './json5-parser.js';
import { visitData } from './jsonc-adapter.js';
import { parseLinesData } from './jsonl-adapter.js';
import type { Format } from './types.js';

export type ParseDataResult = { data: unknown } | { error: { message: string; offset: number } };

/**
 * The data of `text` in `format`: `{ data }` when `getAdapter(format).parse(text)` reports no error
 * (equal to its `data`), or `{ error }` with the message and offset of its first error (the error
 * diagnostic with the lowest offset). Never adds an entry to core's parse cache.
 */
export function parseData(format: Format, text: string): ParseDataResult {
  // JSON Lines reads line by line (spec 012 L1): a one-line text is valid JSON whose data is the
  // item, not the array of items, so it never takes the whole-text path below.
  if (format === 'jsonl') return parseLinesData(text);
  // Strict JSON is valid in every format and parses to the same data: `JSON.parse` defines
  // members as own properties (`__proto__` too), keeps `-0` and lets a duplicate key's last value
  // win in the first one's place, as both parsers do. Anything else takes the format's own walk.
  try {
    return { data: JSON.parse(text) as unknown };
  } catch {
    // Not strict JSON: comments, trailing commas, JSON5 syntax, or an error.
  }
  if (format === 'json5') {
    const { data, error } = parseJson5Data(text);
    return error ? { error: { message: error.message, offset: error.offset } } : { data };
  }
  // JSON and JSONC: `parse` reports jsonc-parser's errors (comments and trailing commas in JSON
  // are warnings); its diagnostics are sorted by offset, so the first error is the earliest one.
  let first: { error: number; offset: number } | undefined;
  const data = visitData(text, (error, offset) => {
    if (first === undefined || offset < first.offset) first = { error, offset };
  });
  if (first === undefined) return { data };
  return {
    error: {
      message: printParseErrorCode(first.error),
      offset: first.offset,
    },
  };
}
