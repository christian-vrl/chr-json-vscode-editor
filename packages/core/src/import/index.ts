// `importData(text, kind)` (spec 017, ADR-015): YAML, TOML or XML text to JSON data, with a warning
// for each thing JSON cannot hold, or an error. Pure: no DOM, no Node APIs, nothing read but `text`.
import type { Style } from '../formats/types.js';
import { ImportFailure, tooDeep, utf8Text, type ImportKind, type ImportResult } from './common.js';
import { importToml } from './toml.js';
import { importXml } from './xml.js';
import { importYaml } from './yaml.js';

export type { ImportError, ImportKind, ImportResult, ImportWarning } from './common.js';

/** The output text's style (spec 017 §Terms): `stringify(data, 'json', IMPORT_OUTPUT_STYLE)`. */
export const IMPORT_OUTPUT_STYLE: Style = {
  indent: 2,
  eol: '\n',
  finalNewline: true,
  quote: '"',
  unquotedKeys: false,
  trailingCommas: false,
};

/**
 * Converts `text` (the file's bytes decoded as UTF-8, a BOM kept or not) of `kind` to data. Returns
 * `{ data, warnings }` or `{ error }`; it never throws (criterion 4).
 */
export function importData(text: string, kind: ImportKind): ImportResult {
  try {
    const source = utf8Text(text);
    return kind === 'yaml'
      ? importYaml(source)
      : kind === 'toml'
        ? importToml(source)
        : importXml(source);
  } catch (error) {
    if (error instanceof ImportFailure) return { error: error.result };
    // A library that recursed too deep while parsing (plan 017 §Approach): A5.
    if (error instanceof RangeError && /call stack/i.test(error.message))
      return { error: tooDeep().result };
    const message = error instanceof Error ? error.message : String(error);
    return { error: { message, line: 1 } };
  }
}
