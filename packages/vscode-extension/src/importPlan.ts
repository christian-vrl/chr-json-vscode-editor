// The texts and names of the YAML, TOML and XML commands (spec 017 T3, criteria 5–7), kept apart
// from importCommands.ts so unit tests can check them without VS Code.
import {
  LosslessNumber,
  type ImportError,
  type ImportKind,
  type ImportWarning,
} from '@chr-json-editor/core';
import { mib, SYNC_LIMIT } from './sizeCeiling';
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

/**
 * UNK-077 (spec 017 criterion 8): the largest YAML file, in UTF-8 bytes, the commands read. YAML
 * parsing holds the extension host for its whole run; see UNK-077's row for the bench run behind it.
 */
export const YAML_LIMIT_BYTES = 5 * 1024 * 1024;

/** The largest source of `kind` the commands read: the YAML limit, else spec 008's ceiling. */
export function importLimit(kind: ImportKind): number {
  return kind === 'yaml' ? YAML_LIMIT_BYTES : SYNC_LIMIT;
}

/**
 * Criterion 8: a source above its kind's limit is not read. Its size is in MiB with one decimal
 * rounded up, so a file one byte over the limit never reads as the limit itself.
 */
export function tooLargeMessage(file: string, kind: ImportKind, bytes: number): string {
  const size = (Math.ceil((bytes * 10) / (1024 * 1024)) / 10).toFixed(1);
  return (
    `CHR JSON Editor: ${file} is too large to convert (${size} MiB; ` +
    `the limit for ${KIND_LABELS[kind]} is ${mib(importLimit(kind))} MiB).`
  );
}

/** Criterion 8: the progress notification over a conversion of a source above the threshold. */
export function progressTitle(file: string): string {
  return `Converting ${file}…`;
}
