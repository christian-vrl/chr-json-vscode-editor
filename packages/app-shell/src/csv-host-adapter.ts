// The seam between the CSV panel page (Csv.svelte, spec 009 criterion 6, 009 T3) and the host it
// runs in (ADR-002, plan 009 §Approach). The single-document HostAdapter has no notion of a panel
// without a document, so the CSV page gets its own, as the compare page does. The host reads the
// row source or the CSV file and sends the page only what the preview needs (the first 100 rows,
// csv-preview.ts); the page runs core's `jsonToCsv` or `csvToJson` on that for the live preview, and
// asks the host to save, copy, create a file or replace document data with the options shown. The
// host runs the full conversion and does the write (ADR-003). Implemented by DevCsvHostAdapter for
// the standalone page and `pnpm test:web`, and by the extension's CSV panel (009 T4).
import type { CsvDelimiter } from '@chr-json-editor/core';

export type { CsvDelimiter };

/** Spec 009 §Options for export, every key given. */
export interface CsvExportOptions {
  delimiter: CsvDelimiter;
  /** "Header row". */
  header: boolean;
  /** "Flatten nested objects". */
  flattenObjects: boolean;
  /** "Flatten nested arrays". */
  flattenArrays: boolean;
  /** "UTF-8 BOM (for Excel)". */
  bom: boolean;
}

/** Spec 009 §Options for import, every key given. */
export interface CsvImportOptions {
  /** A delimiter, or `'detect'` (I3). */
  delimiter: CsvDelimiter | 'detect';
  /** "Header row". */
  header: boolean;
  /** "Nested objects from field names" (I5). */
  nestedObjects: boolean;
}

/** The defaults of spec 009 §Options: what the panel shows when it opens. */
export const CSV_EXPORT_DEFAULTS: Readonly<CsvExportOptions> = Object.freeze({
  delimiter: ',',
  header: true,
  flattenObjects: true,
  flattenArrays: false,
  bom: false,
});

export const CSV_IMPORT_DEFAULTS: Readonly<CsvImportOptions> = Object.freeze({
  delimiter: 'detect',
  header: true,
  nestedObjects: true,
});

/** What "Export to CSV…" shows: the row source (spec 009 criterion 7). */
export interface CsvExportSource {
  mode: 'export';
  /** The source document's file name. */
  name: string;
  /** The row source's JSON Pointer in the document; `''` for the root. */
  pointer: string;
  /** What the preview converts: the first 100 items of an array row source, or the value itself
   *  (`previewRows`, csv-preview.ts). */
  preview: unknown;
  /** Rows the full export writes: the array's length, 1 for an object, 0 for anything else (X1). */
  rowCount: number;
}

/** What "Import CSV…" and "Convert CSV to JSON" show: a CSV file. */
export interface CsvImportSource {
  mode: 'import';
  /** The CSV file's name. */
  name: string;
  /** The file's text up to the record that gives the 100th row whatever the options
   *  (`csvPreviewText`, csv-preview.ts); the whole text when `complete`. */
  preview: string;
  /** Whether `preview` is the whole file. */
  complete: boolean;
  /** Whether the panel offers "Replace Document Data" (UNK-042): only for "Import CSV…" from an
   *  editor whose document may change (not a `.csv` file alone, not a locked tab, criterion 10). */
  canReplace: boolean;
}

export type CsvSource = CsvExportSource | CsvImportSource;

/** An export or import message: `line` is 1-based and given for import only (spec 009). */
export interface CsvPanelMessage {
  message: string;
  line?: number;
}

/** A write the page asks for, with the options it shows. */
export type CsvRequest =
  | { action: 'save' | 'copy'; options: CsvExportOptions }
  | { action: 'createFile' | 'replaceData'; options: CsvImportOptions };

/**
 * How a request ended. `done`: written (or the user cancelled a dialog, which writes nothing).
 * `error`: the full conversion failed past what the preview covers (for example a quote left open
 * after the 100th row); the page shows it as it shows a preview error.
 */
export type CsvOutcome = { done: true } | { error: CsvPanelMessage };

export interface CsvHostAdapter {
  /** Resolves once with what the panel converts. */
  open(): Promise<CsvSource>;
  /** Runs the full conversion with `request.options` and writes the result; the page sends only
   *  the requests its mode offers. */
  run(request: CsvRequest): Promise<CsvOutcome>;
}
