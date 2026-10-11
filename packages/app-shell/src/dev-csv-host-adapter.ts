// CsvHostAdapter for the standalone CSV page (009 T3): holds the row source or the CSV text in
// memory and does what the extension host does with it (plan 009 §Approach), with core: sends the
// preview's first 100 rows (csv-preview.ts), and on a request runs the full `jsonToCsv` or
// `csvToJson` and records the write instead of touching a file, the clipboard or a document. A
// test reads `writes` to see what the panel asked for and what the host would have written.
import { csvToJson, jsonToCsv, stringify } from '@chr-json-editor/core';
import type {
  CsvExportOptions,
  CsvHostAdapter,
  CsvImportOptions,
  CsvOutcome,
  CsvRequest,
  CsvSource,
} from './csv-host-adapter.js';
import { csvPreviewText, previewRows } from './csv-preview.js';

/** What the dev host converts: a document's row source to export, or a CSV file to import. */
export type DevCsvInput =
  | { mode: 'export'; name: string; data: unknown; pointer?: string }
  | { mode: 'import'; name: string; text: string; canReplace?: boolean };

/** One write the host made, in place of the file, clipboard or document change. */
export type DevCsvWrite =
  | { action: 'save'; options: CsvExportOptions; name: string; text: string }
  | { action: 'copy'; options: CsvExportOptions; text: string }
  | { action: 'createFile'; options: CsvImportOptions; name: string; text: string }
  | { action: 'replaceData'; options: CsvImportOptions; data: unknown };

/** A new JSON file's layout, as a new document gets it (core `stringify`). */
const NEW_FILE_STYLE = {
  indent: 2,
  eol: '\n',
  finalNewline: true,
  quote: '"',
  unquotedKeys: false,
  trailingCommas: false,
} as const;

export class DevCsvHostAdapter implements CsvHostAdapter {
  readonly #input: DevCsvInput;
  /** Every write made, oldest first. */
  readonly writes: DevCsvWrite[] = [];
  /** Every request received, written or refused, oldest first. */
  readonly requests: CsvRequest[] = [];

  constructor(input: DevCsvInput) {
    this.#input = structuredClone(input);
  }

  open(): Promise<CsvSource> {
    const input = this.#input;
    if (input.mode === 'export') {
      const { data } = input;
      const rowCount = Array.isArray(data) ? data.length : isObject(data) ? 1 : 0;
      return Promise.resolve({
        mode: 'export',
        name: input.name,
        pointer: input.pointer ?? '',
        preview: structuredClone(previewRows(data)),
        rowCount,
      });
    }
    const preview = csvPreviewText(input.text);
    return Promise.resolve({
      mode: 'import',
      name: input.name,
      preview: preview.text,
      complete: preview.complete,
      canReplace: input.canReplace ?? false,
    });
  }

  run(request: CsvRequest): Promise<CsvOutcome> {
    this.requests.push(structuredClone(request));
    return Promise.resolve(this.#run(request));
  }

  #run(request: CsvRequest): CsvOutcome {
    const input = this.#input;
    const base = input.name.replace(/\.[^./\\]*$/, '');
    switch (request.action) {
      case 'save':
      case 'copy': {
        if (input.mode !== 'export') return { error: { message: 'Not an export' } };
        const options = structuredClone(request.options);
        const result = jsonToCsv(input.data, options);
        if ('error' in result) return { error: result.error };
        this.writes.push(
          request.action === 'save'
            ? { action: 'save', options, name: `${base}.csv`, text: result.text }
            : { action: 'copy', options, text: result.text },
        );
        return { done: true };
      }
      case 'createFile':
      case 'replaceData': {
        if (input.mode !== 'import') return { error: { message: 'Not an import' } };
        if (request.action === 'replaceData' && !input.canReplace) {
          return { error: { message: 'There is no document to replace' } };
        }
        const options = structuredClone(request.options);
        const result = csvToJson(input.text, options);
        if ('error' in result) return { error: result.error };
        this.writes.push(
          request.action === 'createFile'
            ? {
                action: 'createFile',
                options,
                name: `${base}.json`,
                text: stringify(result.data, 'json', NEW_FILE_STYLE),
              }
            : { action: 'replaceData', options, data: result.data },
        );
        return { done: true };
      }
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
