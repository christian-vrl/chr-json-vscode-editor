// Asking before a destructive step (003 T8: a repair that cannot keep every comment, UNK-018). In
// the e2e build the suite sets the answer through the test hooks, since a modal dialog would wait
// for a click no test can give; the questions asked are recorded for it to check.
import * as vscode from 'vscode';

declare const __CHR_TEST_HOOKS__: boolean;

/** A test's answer: fixed, or computed when asked (so a test can act while the question is open). */
export type TestAnswer = boolean | (() => boolean | Promise<boolean>);

/** Test hooks only: the answer to give instead of showing the dialog, and the questions asked. */
export const testConfirm: { answer: TestAnswer | undefined; asked: string[] } = {
  answer: undefined,
  asked: [],
};

/** Shows `message` as a modal warning with an `action` button; true when the user picks it. */
export async function confirm(message: string, action: string): Promise<boolean> {
  if (__CHR_TEST_HOOKS__ && testConfirm.answer !== undefined) {
    testConfirm.asked.push(message);
    const { answer } = testConfirm;
    return typeof answer === 'function' ? answer() : answer;
  }
  return (await vscode.window.showWarningMessage(message, { modal: true }, action)) === action;
}

/** UNK-018's fallback: asks before writing a repair that removes the comments it could not keep. */
export function confirmRepair(lostComments: readonly string[]): Promise<boolean> {
  const n = lostComments.length;
  return confirm(
    `Repair can't keep ${n === 1 ? 'one comment' : `${n} comments`}: ${lostComments.join(', ')}. ` +
      `Repair anyway and remove ${n === 1 ? 'it' : 'them'}?`,
    'Repair',
  );
}
