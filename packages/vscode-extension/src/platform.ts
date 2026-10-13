// What one host has and the other lacks (spec 013 T2, ADR-013). Both entries call activateShared
// (activate.ts) with a HostPlatform: the Node entry (extension.ts) with the Node-only services from
// src/node/, the browser entry (web/extension.ts) with none. A command whose service is missing is
// desktop-only (UNK-053): hidden by its `when` clauses, and showing desktopOnlyMessage if run by id.
import type * as vscode from 'vscode';
import type { HeadResult } from './gitHead';

export interface HostPlatform {
  /** Reads `uri`'s committed bytes from Git HEAD through VS Code's Git extension (007 T2, UNK-038). */
  readonly readHead?: (uri: vscode.Uri) => Promise<HeadResult>;
}

/** The desktop-only commands (UNK-053 ★) and their titles in package.json. */
export const DESKTOP_ONLY_COMMANDS = {
  'chrJsonEditor.compareWithHead': 'Compare with HEAD',
} as const;

/** Spec 013 criterion 8: what a desktop-only command shows when run in the web host. */
export function desktopOnlyMessage(command: keyof typeof DESKTOP_ONLY_COMMANDS): string {
  return `${DESKTOP_ONLY_COMMANDS[command]} is available in VS Code desktop.`;
}
