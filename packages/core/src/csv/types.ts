// Shared CSV types (spec 009 §Options and §Acceptance criterion).

/** The delimiters of spec 009 §Options. */
export type CsvDelimiter = ',' | ';' | '\t' | '|';

/** An export error. */
export interface CsvExportMessage {
  message: string;
}

/** An import warning or error, with the 1-based line of the input it is about. */
export interface CsvImportMessage {
  message: string;
  line: number;
}
