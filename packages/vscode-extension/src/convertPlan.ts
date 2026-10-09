// What the "Convert to JSON / JSONC / JSON5" commands (spec 006 T3) write and say, as pure
// functions with no `vscode` import so unit tests can call them; convertCommand.ts binds them to
// VS Code. The conversion itself is core's `convert` (006 T2).
import {
  convert,
  ConvertError,
  type ConversionLoss,
  type Diagnostic,
  type Format,
} from '@chr-json-editor/core';

export const FORMAT_LABELS: Readonly<Record<Format, string>> = {
  json: 'JSON',
  jsonc: 'JSONC',
  json5: 'JSON5',
};

const BOM = '﻿';

/** What converting a document's text gives. */
export type Plan =
  | { kind: 'same' }
  | {
      kind: 'converted';
      /** The text to write: the converted text, after the source's byte order mark if it has one. */
      text: string;
      losses: ConversionLoss[];
    }
  | {
      kind: 'broken';
      diagnostic: Diagnostic;
      /** Offset of the error in the document's text. */ offset: number;
    };

/**
 * Converts `text` from `from` to `to`. A leading byte order mark is the file's encoding mark, not
 * content: it is kept in front of the result and not passed to `convert`, which would
 * reject it in JSON and JSONC and turn it into a space for JSON5 (C6). `bom` says whether the
 * source file starts with one even when the document's text does not (VS Code drops it on load).
 */
export function plan(text: string, from: Format, to: Format, bom = false): Plan {
  if (from === to) return { kind: 'same' };
  const shift = text.startsWith(BOM) ? 1 : 0;
  try {
    const result = convert(text.slice(shift), from, to);
    return {
      kind: 'converted',
      text: (bom || shift ? BOM : '') + result.text,
      losses: result.losses.map((loss) => ({ ...loss, offset: loss.offset + shift })),
    };
  } catch (error) {
    if (!(error instanceof ConvertError)) throw error;
    return {
      kind: 'broken',
      diagnostic: error.diagnostic,
      offset: error.diagnostic.offset + shift,
    };
  }
}

/** The converted file's name: `base` with its last extension replaced by the target's. */
export function convertedName(base: string, to: Format): string {
  const dot = base.lastIndexOf('.');
  return `${dot > 0 ? base.slice(0, dot) : base}.${to}`;
}

/** Criterion 7: why a broken document is not converted. `line` and `column` count from 1. */
export function brokenMessage(from: Format, to: Format, line: number, column: number): string {
  return (
    `CHR JSON Editor: can't convert to ${FORMAT_LABELS[to]}: the document is not valid ` +
    `${FORMAT_LABELS[from]} (error at line ${line}, column ${column}). ` +
    `Fix it or run "Repair JSON" first.`
  );
}

/** Criterion 6's modal: how many comments go, and which values change, by JSON Pointer. */
export function lossQuestion(
  text: string,
  to: Format,
  losses: readonly ConversionLoss[],
): { message: string; detail: string } {
  const comments = losses.filter((loss) => loss.kind === 'comment').length;
  const values = losses.filter((loss) => loss.kind === 'value');
  const parts: string[] = [];
  if (comments) parts.push(`removes ${comments === 1 ? '1 comment' : `${comments} comments`}`);
  if (values.length) {
    const n = values.length;
    parts.push(`changes ${n === 1 ? '1 value' : `${n} values`} to null`);
  }
  const detail = values
    .map((loss) => {
      const written = text.slice(loss.offset, loss.offset + loss.length);
      return `${loss.path === '' ? '(root)' : loss.path}: ${written} → null`;
    })
    .join('\n');
  return {
    message: `Converting to ${FORMAT_LABELS[to]} ${parts.join(' and ')}. Convert anyway?`,
    detail,
  };
}
