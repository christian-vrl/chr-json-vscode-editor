// Spec 013 criterion 1 (013 T1): the browser entry is one bundle whose only `require` is VS Code's,
// and the manifest names it beside the Node entry. The bundle is built here from source with the
// options esbuild.mjs uses, so the check runs before `pnpm build`, as CI's unit step does.
import { readFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { browserEntryOptions } from '../../esbuild.web.mjs';

const packageDir = fileURLToPath(new URL('../..', import.meta.url));

/** The string argument of every `require(...)` call in `code` (`<dynamic>` for any other). */
function requireCalls(code: string): string[] {
  const source = ts.createSourceFile('bundle.js', code, ts.ScriptTarget.Latest, false);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require'
    ) {
      const [arg] = node.arguments;
      found.push(arg && ts.isStringLiteral(arg) ? arg.text : '<dynamic>');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

async function bundle(testHooks: boolean): Promise<string> {
  const options = browserEntryOptions({ testHooks, outfile: 'out/extension.js' });
  const result = await build({
    ...options,
    write: false,
    sourcemap: false,
    logLevel: 'silent',
    // Workspace packages from source, as vitest.config.mts does, so no package build is needed.
    alias: {
      '@chr-json-editor/core': nodePath.join(packageDir, '../core/src/index.ts'),
      '@chr-json-editor/app-shell/protocol': nodePath.join(
        packageDir,
        '../app-shell/src/protocol.ts',
      ),
    },
  });
  const js = result.outputFiles.find((file) => file.path.endsWith('.js'));
  if (!js) throw new Error('esbuild wrote no JavaScript');
  return js.text;
}

describe('browser entry (spec 013 criterion 1)', () => {
  for (const testHooks of [false, true]) {
    it(`requires nothing but vscode${testHooks ? ' (e2e build)' : ''}`, async () => {
      const calls = requireCalls(await bundle(testHooks));
      expect(calls.length).toBeGreaterThan(0);
      expect(new Set(calls)).toEqual(new Set(['vscode']));
    }, 30_000);
  }

  it('leaves out the Node-only code (spec 013 criterion 2: only the Node entry imports src/node/)', async () => {
    // node/gitHeadVscode.ts is the only file that names VS Code's Git extension.
    expect(await bundle(true)).not.toContain('vscode.git');
  }, 30_000);

  it('counts require calls, not the word in strings (Ajv names its runtime in generated code)', () => {
    expect(
      requireCalls('const a = require("vscode"); const b = \'require("fs")\'; require(x);'),
    ).toEqual(['vscode', '<dynamic>']);
  });

  it('is named by the manifest beside the Node entry, with virtual workspaces declared', () => {
    const manifest = JSON.parse(
      readFileSync(nodePath.join(packageDir, 'package.json'), 'utf8'),
    ) as {
      main: string;
      browser: string;
      capabilities: unknown;
      engines: { vscode: string };
    };
    expect(manifest.main).toBe('./dist/extension.js');
    expect(manifest.browser).toBe('./dist/web/extension.js');
    expect(manifest.capabilities).toEqual({ virtualWorkspaces: true });
    expect(manifest.engines.vscode).toBe('^1.136.2');
    const ignore = readFileSync(nodePath.join(packageDir, '.vscodeignore'), 'utf8').split('\n');
    expect(ignore).toContain('!dist/web/extension.js');
  });
});
