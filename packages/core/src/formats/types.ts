// FormatAdapter contract (002 T3, AGENTS.md §Glossary). One adapter per format turns text into data
// and applies RFC 6902 operations as minimal text edits, so every byte outside the edited spans is
// kept (spec 002 §Goal). Format detection is the separate `detect(path, languageId?, text?)` of 002
// T2, since it picks the adapter.

export type Format = 'json' | 'jsonc' | 'json5';

/** How a document is written (AGENTS.md §Glossary). Edits follow it for the bytes they add. */
export interface Style {
  /** `'\t'`, or the number of spaces per level (R1). */
  indent: '\t' | number;
  eol: '\n' | '\r\n';
  finalNewline: boolean;
  quote: '"' | "'";
  unquotedKeys: boolean;
  trailingCommas: boolean;
}

export interface Diagnostic {
  severity: 'error' | 'warning';
  message: string;
  offset: number;
  length: number;
}

/** A node of the parsed document with the text span it covers. `property` nodes span the key
 *  to the end of the value and hold `[key, value]` as children. */
export interface FormatNode {
  readonly type: 'object' | 'array' | 'property' | 'string' | 'number' | 'boolean' | 'null';
  readonly offset: number;
  readonly length: number;
  readonly value?: unknown;
  readonly children?: readonly FormatNode[];
}

export interface ParseResult {
  data: unknown;
  /** Undefined when the text holds no value. */
  tree: FormatNode | undefined;
  style: Style;
  diagnostics: Diagnostic[];
}

/** RFC 6902 operations (002 T3: `add`, `replace`, `remove`; 002 T6: `move`, `copy`, `test`). */
export type PatchOperation =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'replace'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'move'; from: string; path: string }
  | { op: 'copy'; from: string; path: string }
  | { op: 'test'; path: string; value: unknown };

export interface FormatAdapter {
  readonly format: Format;
  parse(text: string): ParseResult;
  /** Applies the operations in order and returns the new text. Throws a `PatchError` (and the
   *  caller keeps its text) when an operation cannot apply. */
  applyPatch(text: string, patch: readonly PatchOperation[]): string;
  /** Writes data as a new document in this format and style (002 T7, see `stringify.ts`). */
  stringify(data: unknown, style: Style): string;
  /** R12: the text with no white space between tokens, keeping its comments (002 T10, `actions.ts`).
   *  Throws a `PatchError` when the text does not parse. */
  compact(text: string): string;
  /** R13: the text with one object's keys or one array's items sorted, each member moving with
   *  its attached comments (002 T10, `actions.ts`). Throws a `PatchError` for a text that does not
   *  parse or a path that is not an object or array. */
  sort(text: string, options?: SortOptions): string;
}

/** What `FormatAdapter.sort` sorts and how (002 T10). */
export interface SortOptions {
  /** JSON Pointer to the object or array to sort; the whole document (`""`) by default. */
  path?: string;
  /** For an array: JSON Pointer, inside each item, to the value the items are sorted by; the item
   *  itself (`""`) by default. Ignored for an object, whose keys are sorted. */
  property?: string;
  direction?: 'asc' | 'desc';
}

export class PatchError extends Error {
  override name = 'PatchError';
}
