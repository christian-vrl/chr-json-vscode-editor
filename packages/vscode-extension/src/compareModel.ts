// What the compare panel (comparePanel.ts, spec 007 T4) computes in the extension host, free of
// `vscode` so unit tests can call it: each side parsed with core in its own format (criterion 8),
// `compare(left, right)` when both parse, the `compare` message for the page, and the text a copy
// produces, `copyDifference` applied with the target format's style-preserving `applyPatch`
// (criterion 6, spec 002 R14), so comments and formatting outside the copied value stay.
import {
  PROTOCOL_VERSION,
  type CompareDifference,
  type CompareMessage,
  type CompareSide,
  type CompareSideMessage,
} from '@chr-json-editor/app-shell/protocol';
import {
  compare,
  copyDifference,
  getAdapter,
  type Difference,
  type Format,
} from '@chr-json-editor/core';

/** One side as the panel read it. */
export interface CompareSideInput {
  /** The title above the side: the file name, or `<name> (HEAD)`. */
  name: string;
  format: Format;
  text: string;
  /** Whether a copy may go into this side; the HEAD side takes none (criterion 6). */
  writable: boolean;
}

export type ParsedSide = { kind: 'data'; data: unknown } | { kind: 'error'; message: string };

export interface CompareModel {
  /** Grows with every change to either side; a copy names the version it was made on. */
  version: number;
  left: CompareSideInput & { parsed: ParsedSide };
  right: CompareSideInput & { parsed: ParsedSide };
  /** `compare(left, right)`; empty when either side does not parse (nothing is compared). */
  differences: Difference[];
}

/** Parses `text` as `format` the way the editor's parser does (app-shell parser.ts): strict JSON
 *  with `JSON.parse`, anything else with core; an error diagnostic fails it (criterion 8). */
export function parseSide(text: string, format: Format): ParsedSide {
  try {
    return { kind: 'data', data: JSON.parse(text) as unknown };
  } catch {
    // Not strict JSON: comments, JSON5 syntax, or an error core reports with its position.
  }
  const result = getAdapter(format).parse(text);
  const error = result.diagnostics.find((d) => d.severity === 'error');
  if (error)
    return { kind: 'error', message: `${error.message} at ${position(text, error.offset)}` };
  if (result.tree === undefined) return { kind: 'error', message: 'The document holds no value' };
  return { kind: 'data', data: result.data };
}

/** "line L, column C" of `offset` in `text`, both from 1. */
function position(text: string, offset: number): string {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  const column = offset - (before.lastIndexOf('\n') + 1) + 1;
  return `line ${line}, column ${column}`;
}

export function buildCompare(
  version: number,
  left: CompareSideInput,
  right: CompareSideInput,
): CompareModel {
  const leftParsed = parseSide(left.text, left.format);
  const rightParsed = parseSide(right.text, right.format);
  const differences =
    leftParsed.kind === 'data' && rightParsed.kind === 'data'
      ? compare(leftParsed.data, rightParsed.data)
      : [];
  return {
    version,
    left: { ...left, parsed: leftParsed },
    right: { ...right, parsed: rightParsed },
    differences,
  };
}

/** The `compare` message for the page: each side's text (the page parses it the same way) or its
 *  parse error, and the differences. */
export function compareMessage(model: CompareModel): CompareMessage {
  const side = (s: CompareModel['left']): CompareSideMessage => ({
    name: s.name,
    format: s.format,
    content:
      s.parsed.kind === 'data'
        ? { kind: 'text', text: s.text }
        : { kind: 'error', message: s.parsed.message },
    writable: s.writable,
  });
  return {
    protocol: PROTOCOL_VERSION,
    type: 'compare',
    docVersion: model.version,
    left: side(model.left),
    right: side(model.right),
    differences: model.differences as CompareDifference[],
  };
}

export type CopyResult =
  | { kind: 'text'; text: string }
  | { kind: 'refused'; code: 'read-only' | 'not-compared' | 'unknown-difference'; message: string }
  | { kind: 'failed'; message: string };

/**
 * The text side `to` gets when `difference` is copied into it from the other side: core's
 * `copyDifference` applied with `applyPatch`, so only the copied value's text changes. Refused for
 * a side that is not writable, when a side does not parse, and for a difference that is not one of
 * the model's (the page's copy names the model's version, which the panel checks first).
 */
export function copyInto(model: CompareModel, difference: Difference, to: CompareSide): CopyResult {
  const target = model[to];
  const from: CompareSide = to === 'left' ? 'right' : 'left';
  const source = model[from];
  if (!target.writable) {
    return { kind: 'refused', code: 'read-only', message: `${target.name} cannot be changed here` };
  }
  if (source.parsed.kind !== 'data' || target.parsed.kind !== 'data') {
    return {
      kind: 'refused',
      code: 'not-compared',
      message: 'Both sides must parse to copy a difference',
    };
  }
  if (!model.differences.some((d) => sameDifference(d, difference))) {
    return {
      kind: 'refused',
      code: 'unknown-difference',
      message: 'The difference is no longer in the compare',
    };
  }
  try {
    const patch = copyDifference(source.parsed.data, target.parsed.data, difference, from);
    return { kind: 'text', text: getAdapter(target.format).applyPatch(target.text, patch) };
  } catch (e) {
    return { kind: 'failed', message: e instanceof Error ? e.message : String(e) };
  }
}

function sameDifference(a: Difference, b: Difference): boolean {
  return a.kind === b.kind && a.leftPath === b.leftPath && a.rightPath === b.rightPath;
}

/** The panel's title (criterion 4). */
export function compareTitle(left: string, right: string): string {
  return `${left} ↔ ${right}`;
}
