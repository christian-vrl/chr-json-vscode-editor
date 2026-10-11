// The status-bar item of paused validation (spec 008 criterion 10, UNK-041). Above UNK-041's size
// a large-file tab's schema validation does not run on open or on change; while such a tab is
// active and a schema applies to it, this item reads "Schema validation paused: large file", and
// clicking it validates once with core's data-only parse and shows the result as spec 004 does.
import * as vscode from 'vscode';

export const VALIDATE_ONCE_COMMAND = 'chrJsonEditor.validateOnce';
export const PAUSED_TEXT = 'Schema validation paused: large file';

/** What the item needs from the active tab: whether its validation waits for a click, and the
 *  click itself. */
export interface PausedTab {
  paused(): boolean;
  validateOnce(): void;
}

export class PausedValidationItem implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly command: vscode.Disposable;
  private visible = false;

  constructor(private readonly activeTab: () => PausedTab | undefined) {
    this.item = vscode.window.createStatusBarItem(
      'chrJsonEditor.validationPaused',
      vscode.StatusBarAlignment.Right,
      99,
    );
    this.item.name = 'CHR JSON Editor Schema Validation';
    this.item.text = PAUSED_TEXT;
    this.item.tooltip = 'Large file: click to validate it against its schema once';
    this.item.command = VALIDATE_ONCE_COMMAND;
    this.command = vscode.commands.registerCommand(VALIDATE_ONCE_COMMAND, () => {
      this.activeTab()?.validateOnce();
    });
  }

  /** Shows or hides the item for the active tab; call after the active tab or its schema changed. */
  refresh(): void {
    this.visible = this.activeTab()?.paused() === true;
    if (this.visible) this.item.show();
    else this.item.hide();
  }

  /** Test hooks: the item's text and command when shown, else null. */
  snapshot(): { text: string; command: string } | null {
    return this.visible ? { text: this.item.text, command: VALIDATE_ONCE_COMMAND } : null;
  }

  dispose(): void {
    this.item.dispose();
    this.command.dispose();
  }
}
