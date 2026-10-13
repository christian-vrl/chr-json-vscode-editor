// Spec 013 criterion 8 (013 T2, UNK-053 ★): the desktop-only commands are hidden in the web host by
// `!isWeb && !chrJsonEditor.webHost` on every menu entry, the command palette's included, and say
// "<title> is available in VS Code desktop." if run there by id (the web e2e runs it). Every other
// command's entries are the same in both hosts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DESKTOP_ONLY_COMMANDS, desktopOnlyMessage } from '../../src/platform';

interface MenuEntry {
  command: string;
  when?: string;
}
const manifest = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as {
  contributes: {
    commands: { command: string; title: string }[];
    menus: Record<string, MenuEntry[]>;
  };
};
const desktopOnly = Object.keys(DESKTOP_ONLY_COMMANDS);
const HIDE_ON_WEB = '!isWeb && !chrJsonEditor.webHost && ';
const entries = Object.entries(manifest.contributes.menus).flatMap(([menu, list]) =>
  list.map((entry) => ({ menu, ...entry })),
);

/** True when `when` has an `||` outside parentheses, which would bind looser than the prefix. */
function hasTopLevelOr(when: string): boolean {
  let depth = 0;
  for (let i = 0; i < when.length; i++) {
    const c = when[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && when.startsWith('||', i)) return true;
  }
  return false;
}

describe('desktop-only commands (spec 013 criterion 8, UNK-053)', () => {
  it('are exactly UNK-053’s list, with their package.json titles', () => {
    expect(desktopOnly).toEqual(['chrJsonEditor.compareWithHead']);
    for (const [command, title] of Object.entries(DESKTOP_ONLY_COMMANDS)) {
      expect(manifest.contributes.commands.find((c) => c.command === command)?.title).toBe(title);
    }
  });

  it('say they are available in VS Code desktop', () => {
    expect(desktopOnlyMessage('chrJsonEditor.compareWithHead')).toBe(
      'Compare with HEAD is available in VS Code desktop.',
    );
  });

  for (const command of desktopOnly) {
    it(`${command} has a command palette entry (a command without one shows everywhere)`, () => {
      expect(entries.some((e) => e.menu === 'commandPalette' && e.command === command)).toBe(true);
    });

    it(`${command} is hidden in the web host by every menu entry`, () => {
      const own = entries.filter((e) => e.command === command);
      expect(own.length).toBeGreaterThan(0);
      for (const entry of own) {
        expect(entry.when?.startsWith(HIDE_ON_WEB), `${entry.menu}: ${entry.when}`).toBe(true);
        expect(hasTopLevelOr(entry.when!.slice(HIDE_ON_WEB.length)), entry.menu).toBe(false);
      }
    });
  }

  it('leave every other command’s entries alike in both hosts', () => {
    for (const entry of entries.filter((e) => !desktopOnly.includes(e.command))) {
      expect(entry.when ?? '', `${entry.menu}: ${entry.command}`).not.toMatch(
        /isWeb|chrJsonEditor\.webHost/,
      );
    }
  });

  it('checks for a top-level || correctly', () => {
    expect(hasTopLevelOr('a || b')).toBe(true);
    expect(hasTopLevelOr('a && (b || c)')).toBe(false);
  });
});
