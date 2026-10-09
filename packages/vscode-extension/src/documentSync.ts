// Document sync for one editor tab (003 T5, spec 003 criteria 1, 2): the host's side of app-shell's
// message protocol. No `vscode` import, so unit tests and the HostAdapter contract suite drive it
// directly; editorProvider.ts binds it to a TextDocument and a webview.
//
// Webview → document: an `edit` made on the document's current version becomes new text, through
// core's style-preserving `applyPatch` for tree and table edits (plan 003 §Constraints: it runs only
// here), and the text reaches the document as a WorkspaceEdit. Edits apply one at a time, in order,
// and each gets exactly one answer: an `update` with origin `edit`, or an edit error.
// Document → webview: every other change is an `update` with origin `external`. A change is the
// answer to an edit only when the document holds exactly the text that edit produced, so the
// webview never takes another editor's change for its own, and never gets its own edit back as an
// external change to re-apply.
//
// Undo and redo (003 T7) run in the document's own history (VS Code's undo stack), after every edit
// the webview sent before them; what they change reaches the webview as an external `update`.
import {
  PROTOCOL_VERSION,
  type EditErrorCode,
  type EditMessage,
  type ToWebviewMessage,
} from '@chr-json-editor/app-shell/protocol';
import { getAdapter, PatchError, type Format } from '@chr-json-editor/core';

/** What the sync needs from the document and the webview. */
export interface SyncTarget {
  /** The document's text and version now (VS Code: `getText()` and `version`). */
  text(): string;
  version(): number;
  /** The format edits are applied in: the badge's, detected or chosen (003 T10). */
  format(): Format;
  /** Replaces the document's text with `text` (a WorkspaceEdit); false when the editor refused. */
  replace(text: string): Promise<boolean>;
  /** Undoes or redoes the document's last change in its own history (VS Code's `undo` command);
   *  never rejects. */
  history(action: 'undo' | 'redo'): Promise<void>;
  post(message: ToWebviewMessage): void;
}

export class DocumentSync {
  /** The text the edit being applied produces; the next change with exactly this text answers it. */
  private expected: string | undefined;
  /** Edits wait here while one is applied, so each starts from the text the previous one left. */
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly target: SyncTarget) {}

  /** Handles an `edit` from the webview; resolves once it is answered. */
  edit(message: EditMessage): Promise<void> {
    this.queue = this.queue.then(() => this.apply(message));
    return this.queue;
  }

  /** Handles an `undo` or `redo` from the webview, after the edits before it; resolves once run. */
  history(action: 'undo' | 'redo'): Promise<void> {
    this.queue = this.queue.then(() => this.target.history(action));
    return this.queue;
  }

  /** Call on every change of the document's text (VS Code: `onDidChangeTextDocument`). */
  changed(): void {
    const text = this.target.text();
    const origin = this.expected !== undefined && text === this.expected ? 'edit' : 'external';
    if (origin === 'edit') this.expected = undefined;
    this.target.post({
      protocol: PROTOCOL_VERSION,
      type: 'update',
      docVersion: this.target.version(),
      text,
      origin,
    });
  }

  private async apply({ docVersion, change }: EditMessage): Promise<void> {
    const version = this.target.version();
    if (docVersion !== version) {
      this.error(
        'stale-edit',
        `The edit was made on version ${docVersion}; the document is at ${version}.`,
      );
      return;
    }
    const text = this.target.text();
    let next: string;
    try {
      next =
        change.kind === 'text'
          ? change.text
          : getAdapter(this.target.format()).applyPatch(text, change.patch);
    } catch (error) {
      if (!(error instanceof PatchError)) throw error;
      this.error('patch-failed', error.message);
      return;
    }
    if (next === text) {
      // Nothing to write, so no change event will answer the edit: answer it here.
      this.target.post({
        protocol: PROTOCOL_VERSION,
        type: 'update',
        docVersion: version,
        text,
        origin: 'edit',
      });
      return;
    }
    this.expected = next;
    const applied = await this.target.replace(next);
    if (this.expected === next) {
      // No change event carried the edit's text: refused, or another change landed first.
      this.expected = undefined;
      this.error(
        'edit-failed',
        applied
          ? 'The document changed while the edit was applied.'
          : 'The editor refused the edit.',
      );
    }
  }

  private error(code: EditErrorCode, message: string): void {
    this.target.post({
      protocol: PROTOCOL_VERSION,
      type: 'error',
      docVersion: this.target.version(),
      code,
      message,
    });
  }
}

/**
 * The smallest single replacement that turns `before` into `after`: the common prefix and suffix
 * stay, so a WorkspaceEdit touches only the changed span (undo, decorations and Git diff follow it).
 */
export function minimalReplacement(
  before: string,
  after: string,
): { start: number; end: number; text: string } {
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let tail = 0;
  while (
    tail < max - start &&
    before.charCodeAt(before.length - 1 - tail) === after.charCodeAt(after.length - 1 - tail)
  ) {
    tail++;
  }
  // Never split a surrogate pair or a CRLF line ending across the edit's edges.
  while (start > 0 && splits(before, start)) start--;
  while (tail > 0 && splits(before, before.length - tail)) tail--;
  return {
    start,
    end: before.length - tail,
    text: after.slice(start, after.length - tail),
  };
}

function splits(text: string, at: number): boolean {
  const prev = text.charCodeAt(at - 1);
  const next = text.charCodeAt(at);
  const surrogate = prev >= 0xd800 && prev <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
  return surrogate || (prev === 13 && next === 10);
}
