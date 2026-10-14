// What the CSV panel (spec 009 T4) reads, writes and says, as pure functions with no `vscode`
// import so unit tests can call them; csvPanel.ts and csvCommands.ts bind them to VS Code. The
// conversions are core's `jsonToCsv` and `csvToJson` (009 T2); the page previews the first 100 rows
// with the same functions (app-shell's Csv.svelte, 009 T3).
import type {
  CsvRunOutcome,
  CsvSourceMessageBody,
  CsvExportOptionsMessage,
  CsvImportOptionsMessage,
} from '@chr-json-editor/app-shell/protocol';
import {
  csvToJson,
  diff,
  getAdapter,
  jsonToCsv,
  parseData,
  stringify,
  type Format,
  type Style,
  type WriteOptions,
} from '@chr-json-editor/core';
import { csvPreviewText, previewRows } from '@chr-json-editor/app-shell/csv-preview';
import { FORMAT_LABELS } from './convertPlan';
import { mib } from './sizeCeiling';

/** How a JSON file "Create JSON File" writes is laid out: as a new document gets it (core
 *  `stringify`), like the dev host's (app-shell's dev-csv-host-adapter.ts). The extension writes
 *  with VS Code's indent for JSON instead of this 2 (spec 019 I1, `newJsonText`). */
export const NEW_JSON_STYLE: Style = {
  indent: 2,
  eol: '\n',
  finalNewline: true,
  quote: '"',
  unquotedKeys: false,
  trailingCommas: false,
};

/** One line of JSON5: how an export's preview travels to the page (protocol `csvSource`). */
const PREVIEW_STYLE: Style = { ...NEW_JSON_STYLE, indent: 0, finalNewline: false };

/** `name` with its last extension replaced by `extension` (`people.json` → `people.csv`). */
export function renamed(name: string, extension: 'csv' | 'json'): string {
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}.${extension}`;
}

/** The panel's tab title: what it converts, with the row source's JSON Pointer when it is not the
 *  root (spec 009 criterion 7). */
export function panelTitle(source: CsvSourceMessageBody): string {
  if (source.mode === 'import') return `Import ${source.name}`;
  return source.pointer === ''
    ? `Export ${source.name} to CSV`
    : `Export ${source.pointer} of ${source.name} to CSV`;
}

/** Criterion 7: why a broken document is not exported, as 006 criterion 7 says it for convert.
 *  `line` and `column` count from 1. */
export function brokenMessage(format: Format, line: number, column: number): string {
  return (
    `CHR JSON Editor: can't export to CSV: the document is not valid ${FORMAT_LABELS[format]} ` +
    `(error at line ${line}, column ${column}). Fix it or run "Repair JSON" first.`
  );
}

/** Why "Replace Document Data" changed nothing: the document does not parse. */
export function brokenTargetMessage(format: Format, line: number, column: number): string {
  return (
    `CHR JSON Editor: can't replace the document's data: it is not valid ${FORMAT_LABELS[format]} ` +
    `(error at line ${line}, column ${column}). Fix it or run "Repair JSON" first.`
  );
}

/** Criterion 8: a CSV file above the ceiling is not read. */
export function tooLargeMessage(name: string, bytes: number): string {
  return (
    `CHR JSON Editor: ${name} is ${mib(bytes)} MiB, too large for CSV import ` +
    `(the limit is 50 MiB).`
  );
}

/**
 * The value "Export to CSV…" exports (criterion 7): the value at `pointer` when it is an array or
 * an object, else the document's data. `pointer` comes from the editor's webview, so it is checked
 * against the data the host holds; a pointer that names nothing there, or a scalar, gives the root.
 */
export function rowSourceAt(data: unknown, pointer: string): { pointer: string; value: unknown } {
  if (pointer === '') return { pointer, value: data };
  let value: unknown = data;
  for (const token of pointer.slice(1).split('/')) {
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(value) && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length) {
      value = value[Number(key)];
    } else if (isObject(value) && Object.hasOwn(value, key)) {
      value = value[key];
    } else {
      return { pointer: '', value: data };
    }
  }
  return typeof value === 'object' && value !== null
    ? { pointer, value }
    : { pointer: '', value: data };
}

/** What the page shows for an export: the first 100 rows, as JSON5 text. */
export function exportSource(name: string, pointer: string, value: unknown): CsvSourceMessageBody {
  const rowCount = Array.isArray(value) ? value.length : isObject(value) ? 1 : 0;
  return {
    mode: 'export',
    name,
    pointer,
    preview: stringify(previewRows(value), 'json5', PREVIEW_STYLE),
    rowCount,
  };
}

/** What the page shows for an import: the CSV text up to its 100th row (csv-preview.ts). */
export function importSource(
  name: string,
  text: string,
  canReplace: boolean,
): CsvSourceMessageBody {
  const preview = csvPreviewText(text);
  return { mode: 'import', name, preview: preview.text, complete: preview.complete, canReplace };
}

/** The full export: the CSV text to save or copy, or the error the page shows. */
export function exportText(
  value: unknown,
  options: CsvExportOptionsMessage,
): { text: string } | Exclude<CsvRunOutcome, { done: true }> {
  const result = jsonToCsv(value, options);
  return 'error' in result ? { error: result.error } : { text: result.text };
}

/** The full import: the data, or the error the page shows. */
export function importData(
  text: string,
  options: CsvImportOptionsMessage,
): { data: unknown[] } | Exclude<CsvRunOutcome, { done: true }> {
  const result = csvToJson(text, options);
  return 'error' in result ? { error: result.error } : { data: result.data };
}

/** "Create JSON File"'s text, indented by `indent` (spec 019 I1: VS Code's for the new file). */
export function newJsonText(
  data: unknown,
  indent: Style['indent'] = NEW_JSON_STYLE.indent,
): string {
  return stringify(data, 'json', { ...NEW_JSON_STYLE, indent });
}

/**
 * "Replace Document Data" (criterion 4, UNK-042): the document's text with its data replaced by
 * `data`, as `diff(old, new)` applied by the format's `applyPatch` (002 R14), so every member that
 * survives keeps its comments and layout. `error` gives the offset of the parse error that keeps
 * the document from being changed. `options` lays out new text where the document has no
 * indentation to follow (spec 019 I1).
 */
export function replacedText(
  text: string,
  format: Format,
  data: unknown,
  options: WriteOptions = {},
): { text: string } | { error: { offset: number } } {
  const old = parseData(format, text);
  if ('error' in old) return { error: { offset: old.error.offset } };
  const patch = diff(old.data, data);
  if (patch.length === 0) return { text };
  return { text: getAdapter(format).applyPatch(text, patch, options) };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
