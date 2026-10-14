// Spec 013 criterion 7 (013 T4): test/web/coverage.json maps every command in package.json's
// `contributes.commands` either to a web e2e test that runs it or to "desktop-only" with a reason.
// Fails when a command is missing from the map (or the map names one that does not exist), when a
// named test is not in the web suite (an `it` title in a file suite/index.ts loads) or its file does
// not run the command, or when the desktop-only list is not exactly UNK-053's (★ Compare with HEAD).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DESKTOP_ONLY_COMMANDS } from '../../src/platform';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const manifest = JSON.parse(read('../../package.json')) as {
  contributes: { commands: { command: string }[] };
};
const coverage = JSON.parse(read('../web/coverage.json')) as {
  commands: Record<string, { test?: string; 'desktop-only'?: string }>;
};

/** UNK-053 ★ (spec 013 criteria 7 and 8). */
const UNK_053_DESKTOP_ONLY = ['chrJsonEditor.compareWithHead'];

/** The `it` titles written as string literals in a suite file. */
function itTitles(source: string): string[] {
  return [...source.matchAll(/\bit\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g)].map(([, , title]) =>
    (title ?? '').replace(/\\(.)/g, '$1'),
  );
}

/** The suite files index.ts loads, with their sources. */
const suite = [...read('../web/suite/index.ts').matchAll(/import\('\.\/([\w-]+)'\)/g)].map(
  ([, name]) => ({ name: `${name}.ts`, source: read(`../web/suite/${name}.ts`) }),
);

describe('web e2e command coverage (spec 013 criterion 7)', () => {
  it('maps exactly the commands package.json contributes', () => {
    const commands = manifest.contributes.commands.map((c) => c.command).sort();
    expect(Object.keys(coverage.commands).sort()).toEqual(commands);
  });

  it('gives each command either a web test or "desktop-only" with a reason', () => {
    for (const [command, entry] of Object.entries(coverage.commands)) {
      const kinds = Object.keys(entry);
      expect(kinds, command).toHaveLength(1);
      const value = entry.test ?? entry['desktop-only'];
      expect(typeof value === 'string' && value.trim().length > 0, command).toBe(true);
    }
  });

  it('lists as desktop-only exactly UNK-053’s commands', () => {
    const desktopOnly = Object.entries(coverage.commands)
      .filter(([, entry]) => entry['desktop-only'] !== undefined)
      .map(([command]) => command)
      .sort();
    expect(desktopOnly).toEqual(UNK_053_DESKTOP_ONLY);
    expect(Object.keys(DESKTOP_ONLY_COMMANDS).sort()).toEqual(UNK_053_DESKTOP_ONLY);
  });

  it('names tests that the web suite has, in a file that runs the command', () => {
    expect(suite.length).toBeGreaterThan(0);
    for (const [command, { test }] of Object.entries(coverage.commands)) {
      if (test === undefined) continue;
      const files = suite.filter(({ source }) => itTitles(source).includes(test));
      expect(
        files.map((f) => f.name),
        `${command}: "${test}"`,
      ).toHaveLength(1);
      expect(files[0]!.source.includes(`'${command}'`), `${files[0]!.name} runs ${command}`).toBe(
        true,
      );
    }
  });

  it('reads `it` titles as the suite writes them', () => {
    expect(
      itTitles(`it('a ’b', x); it("Import CSV… replaces the document's data", y); it(\`t\`, z);`),
    ).toEqual(['a ’b', "Import CSV… replaces the document's data"]);
    expect(itTitles("it('it\\'s', x)")).toEqual(["it's"]);
  });
});
