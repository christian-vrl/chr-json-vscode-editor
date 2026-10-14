// What the copy path and reveal commands (spec 018 S5, S6; pathCommands.ts) read and say, without
// VS Code: the node at a text editor's cursor, the status bar message after a copy, and the
// messages for a node they cannot find. The e2e suite (test/e2e/copyPath.cjs) runs the same
// through the commands.
import { jsonPath, jsonPointer, nodeAt, type Format, type Path } from '@chr-json-editor/core';
import type { CurrentNode } from '@chr-json-editor/app-shell/protocol';
import { FORMAT_LABELS } from './convertPlan';

/** The two notations (UNK-080 ★ both). */
export type Notation = 'jsonPath' | 'jsonPointer';

/** How long the status bar shows "Copied …" (S5). */
export const COPIED_MS = 3000;

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
