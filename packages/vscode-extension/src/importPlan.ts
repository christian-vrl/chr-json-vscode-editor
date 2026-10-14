// The texts and names of the YAML, TOML and XML commands (spec 017 T3, criteria 5–7), kept apart
// from importCommands.ts so unit tests can check them without VS Code.
import {
  LosslessNumber,
  type ImportError,
  type ImportKind,
  type ImportWarning,
} from '@chr-json-editor/core';
import { basename, extname } from './uriPath';

export const IMPORT_KINDS: readonly ImportKind[] = ['yaml', 'toml', 'xml'];

export const KIND_LABELS: Readonly<Record<ImportKind, string>> = {
  yaml: 'YAML',
  toml: 'TOML',
  xml: 'XML',
};

/** The file extensions of each kind (spec 017 §Terms), without the dot. */
export const KIND_EXTENSIONS: Readonly<Record<ImportKind, readonly string[]>> = {
  yaml: ['yaml', 'yml'],
  toml: ['toml'],
  xml: ['xml'],
};

/** The kind a path's extension names (any case), else undefined. Never from the content. */
export function kindOf(path: string): ImportKind | undefined {
  const extension = extname(path).slice(1).toLowerCase();
  return IMPORT_KINDS.find((kind) => KIND_EXTENSIONS[kind].includes(extension));
}

/** The new file's name: `config.yaml` → `config.json`, `Cargo.toml` → `Cargo.json`. */
export function jsonName(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}.json`;
}

/**
 * Criterion 7's error message. Errors that belong to the whole file (A1, A5, Y6) have no column
 * (corpus README, reading 3), so their place is the line alone.
 */
export function errorMessage(file: string, error: ImportError): string {
  const place =
    error.column === undefined
      ? `line ${error.line}`
      : `line ${error.line}, column ${error.column}`;
  return `CHR JSON Editor: can't convert ${file}: ${error.message} (${place}).`;
}

/** Criterion 7's notification for a conversion with warnings (`1 warning` for one). */
export function warningsMessage(file: string, count: number): string {
  return `Converted ${file} with ${count} ${count === 1 ? 'warning' : 'warnings'}.`;
}

/** Criterion 7's output channel lines, one per warning. */
export function warningLines(file: string, warnings: readonly ImportWarning[]): string[] {
  return warnings.map(({ line, message }) => `${file}:${line}: ${message}`);
}

/** Criterion 6's question before "Import YAML, TOML or XML…" replaces a document's data. */
export function replaceQuestion(document: string, file: string): string {
  return (
    `Replace the data of ${document} with the data of ${file}? ` +
    'Comments on members that stay are kept.'
  );
}

/** Criterion 6: the data a JSON Lines tab can take is an array of its lines. */
export function jsonLinesMessage(file: string, data: unknown): string {
  const type =
    data === null
      ? 'null'
      : data instanceof LosslessNumber
        ? 'a number'
        : Array.isArray(data)
          ? 'an array'
          : typeof data === 'object'
            ? 'an object'
            : typeof data === 'string'
              ? 'a string'
              : typeof data === 'boolean'
                ? 'a boolean'
                : 'a number';
  return `CHR JSON Editor: JSON Lines needs an array; ${file} holds ${type}.`;
}
