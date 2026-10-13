// Spec 013 criterion 2 (013 T2): ESLint fails on any import of a Node built-in in the extension's
// host code outside src/node/, and on any import of src/node/ outside the Node entry. The fixture
// tests/fixtures/node-import/fixture.ts is linted as if it were a file at each place, with the
// repository's own blocks for that code (eslint.config.mjs `sharedHostCode`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { sharedHostCode } from '../../../../eslint.config.mjs';

const repo = fileURLToPath(new URL('../../../..', import.meta.url));
const fixture = readFileSync(
  new URL('../../../../tests/fixtures/node-import/fixture.ts', import.meta.url),
  'utf8',
);

const eslint = new ESLint({
  cwd: repo,
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ['**/*.ts'],
      languageOptions: { parser: tseslint.parser },
      plugins: { '@typescript-eslint': tseslint.plugin },
    },
    ...sharedHostCode,
  ],
});

/** The lines of `text` ESLint reports when it is the file at `filePath` (repository-relative). */
async function errorLines(text: string, filePath: string): Promise<number[]> {
  const [result] = await eslint.lintText(text, { filePath });
  if (!result) throw new Error('ESLint returned no result');
  return result.messages.map((m) => {
    expect(m.severity).toBe(2);
    return m.line;
  });
}

const markedLines = fixture
  .split('\n')
  .flatMap((line, i) => (line.endsWith('// error') ? [i + 1] : []));
const nodeFolderImport = "import { readHeadOf } from './node/gitHeadVscode';\nvoid readHeadOf;\n";

describe('no Node built-ins in shared host code (spec 013 criterion 2)', () => {
  it('fails on every marked import in shared host code', async () => {
    expect(markedLines).toHaveLength(8);
    expect(await errorLines(fixture, 'packages/vscode-extension/src/fixture.ts')).toEqual(
      markedLines,
    );
    // The webview script is browser code too.
    expect(await errorLines(fixture, 'packages/vscode-extension/src/webview/fixture.ts')).toEqual(
      markedLines,
    );
  });

  it('fails on the Node entry too: it imports src/node/, not Node itself', async () => {
    expect(await errorLines(fixture, 'packages/vscode-extension/src/extension.ts')).toEqual(
      markedLines,
    );
  });

  it('lets src/node/ import Node built-ins', async () => {
    expect(await errorLines(fixture, 'packages/vscode-extension/src/node/fixture.ts')).toEqual([]);
  });

  it('lets only the Node entry import src/node/, by import(), require() or import', async () => {
    const calls =
      "export const a = import('./node/gitHeadVscode');\nexport const b: unknown = require('../node/x');\n";
    expect(await errorLines(calls, 'packages/vscode-extension/src/activate.ts')).toEqual([1, 2]);
    expect(await errorLines(calls, 'packages/vscode-extension/src/extension.ts')).toEqual([]);
  });

  it('lets only the Node entry import src/node/', async () => {
    expect(await errorLines(nodeFolderImport, 'packages/vscode-extension/src/activate.ts')).toEqual(
      [1],
    );
    expect(
      await errorLines(
        nodeFolderImport.replace('./node/', '../node/'),
        'packages/vscode-extension/src/web/extension.ts',
      ),
    ).toEqual([1]);
    expect(
      await errorLines(nodeFolderImport, 'packages/vscode-extension/src/extension.ts'),
    ).toEqual([]);
  });

  it('does not reach code outside the extension’s src/', async () => {
    expect(await errorLines(fixture, 'packages/vscode-extension/test/unit/fixture.ts')).toEqual([]);
    expect(await errorLines(fixture, 'packages/core/src/fixture.ts')).toEqual([]);
  });
});
