// What the copy path and reveal commands (spec 018 S5, S6; pathCommands.ts) read and say, without
// VS Code: the node at a text editor's cursor, the status bar message after a copy, and the
// messages for a node they cannot find. The e2e suite (test/e2e/copyPath.cjs) runs the same
// through the commands.
import {
  jsonPath,
  jsonPointer,
  nodeAt,
  readLines,
  type Format,
  type Path,
} from '@chr-json-editor/core';
import type { CurrentNode } from '@chr-json-editor/app-shell/protocol';
import { FORMAT_LABELS } from './convertPlan';

/** The two notations (UNK-080 ★ both). */
export type Notation = 'jsonPath' | 'jsonPointer';

/** How long the status bar shows "Copied …" (S5). */
export const COPIED_MS = 3000;

/** The progress notification while a command reads a text above the threshold (criterion 11). */
export const FINDING_NODE_TITLE = 'Finding the node…';

/** S1's message for a selection of several nodes (the page shows the same, paths.ts). */
export const SEVERAL_NODES_MESSAGE = 'Select one node to copy its path.';

/** The text a copy command puts on the clipboard: the path as P1 or P2. */
export function pathText(notation: Notation, path: Path): string {
  return notation === 'jsonPath' ? jsonPath(path) : jsonPointer(path);
}

/** S5's status bar message after a copy of `text`. */
export function copiedMessage(notation: Notation, text: string): string {
  if (notation === 'jsonPointer' && text === '')
    return 'Copied the empty JSON Pointer (the whole document)';
  return `Copied ${text}`;
}

/** S6's first message: the text stops reading as its format at line `line`, column `column`. */
export function brokenMessage(format: Format, line: number, column: number): string {
  return (
    `CHR JSON Editor: can't find the node: the document is not valid ${FORMAT_LABELS[format]} ` +
    `(error at line ${line}, column ${column}). ` +
    `Fix it or run "${format === 'jsonl' ? 'Repair Lines' : 'Repair JSON'}" first.`
  );
}

/** S6's second message: the node of `path` has no place in the text (R1). */
export function notInDocumentMessage(path: Path): string {
  return `CHR JSON Editor: can't find the node: ${jsonPath(path)} is not in the document.`;
}

/** The current node of VS Code's text editor (§Terms): the node at the main cursor's offset. */
export function nodeAtCursor(format: Format, text: string, offset: number): CurrentNode {
  const found = nodeAt(format, text, Math.min(Math.max(offset, 0), text.length));
  if ('path' in found) return { kind: 'path', path: found.path };
  const { message, line, column } = found.error;
  return { kind: 'error', message, line, column };
}

/** What a command does with the current node: go on with its path, or show `message` and stop. */
export function nodeOutcome(
  format: Format,
  node: CurrentNode,
): { path: Path } | { message: string; severity: 'error' | 'info' } {
  if (node.kind === 'path') return { path: node.path };
  if (node.kind === 'several') return { message: SEVERAL_NODES_MESSAGE, severity: 'info' };
  return { message: brokenMessage(format, node.line, node.column), severity: 'error' };
}

/**
 * JSON Lines with bad lines: the item indices, as A5 counts items (every non-blank line, a bad one
 * too), of the bad lines. The CHR JSON Editor's table leaves bad lines out of its items (spec 012
 * L1), so a path's first step names a different item in each editor after a bad line (018 T4).
 */
export function badItems(text: string): number[] {
  const { bad } = readLines(text);
  if (bad.length === 0) return [];
  const items: number[] = [];
  let next = 0;
  let item = 0;
  let start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (let line = 1; next < bad.length; line++) {
    const lf = text.indexOf('\n', start);
    const end = lf < 0 ? text.length : lf;
    if (line === bad[next]) {
      items.push(item);
      next++;
    }
    if (!/^[ \t]*\r?$/.test(text.slice(start, end))) item++;
    if (lf < 0) break;
    start = lf + 1;
  }
  return items;
}

/** A text editor path in JSON Lines as the CHR JSON Editor's table names it: the item's row
 *  leaves out the bad lines before it. */
export function tablePath(path: Path, bad: readonly number[]): Path {
  const [first, ...rest] = path;
  if (typeof first !== 'number') return path;
  return [first - bad.filter((b) => b < first).length, ...rest];
}

/** A path of the CHR JSON Editor's table in JSON Lines as the text names it (A5): the row's item
 *  counts the bad lines before it. */
export function textPath(path: Path, bad: readonly number[]): Path {
  const [first, ...rest] = path;
  if (typeof first !== 'number') return path;
  let item = first;
  for (const b of bad) if (b <= item) item++;
  return [item, ...rest];
}
