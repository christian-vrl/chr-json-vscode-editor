// scripts/release.mjs (005 T2): the publish step's checks, and its dry run against the pinned CLIs.
// No test here publishes or touches the network: every real-mode run stops before step 1.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const script = path.join(repo, 'scripts/release.mjs');

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'release-'));
  const extension = path.join(root, 'packages/vscode-extension');
  mkdirSync(extension, { recursive: true });
  writeFileSync(
    path.join(extension, 'package.json'),
    JSON.stringify({ name: 'chr-json-editor', publisher: 'christian-vrl', version: '1.2.3' }),
  );
  writeFileSync(path.join(extension, 'chr-json-editor-1.2.3.vsix'), 'not a real vsix');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function run(env: Record<string, string>, ...args: string[]) {
  const clean = { ...process.env };
  delete clean.VSCE_PAT;
  delete clean.OVSX_PAT;
  const result = spawnSync(process.execPath, [script, '--root', root, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...clean, ...env },
  });
  return { status: result.status, output: result.stdout + result.stderr };
}

describe('release.mjs', () => {
  it('dry run checks every publish command line against the pinned CLIs', () => {
    const { status, output } = run({}, '--tag', 'v1.2.3', '--dry-run');
    expect(output).toMatch(
      /would run vsce publish --packagePath chr-json-editor-1\.2\.3\.vsix --skip-duplicate \(vsce [\d.]+, flags ok\)/,
    );
    expect(output).toMatch(/would run ovsx create-namespace christian-vrl/);
    expect(output).toMatch(/https:\/\/open-vsx\.org\/api\/christian-vrl is 404/);
    expect(output).toMatch(/would run ovsx publish chr-json-editor-1\.2\.3\.vsix --skip-duplicate/);
    expect(output).toMatch(/dry run ok/);
    expect(status).toBe(0);
  });

  it('fails when the tag does not name the version', () => {
    const { status, output } = run({}, '--tag', 'v1.2.4', '--dry-run');
    expect(output).toMatch(/tag v1\.2\.4 does not match the extension's version 1\.2\.3/);
    expect(status).toBe(1);
    expect(run({}, '--tag', '1.2.3', '--dry-run').status).toBe(1);
  });

  it('fails when the .vsix was not built', () => {
    rmSync(path.join(root, 'packages/vscode-extension/chr-json-editor-1.2.3.vsix'));
    const { status, output } = run({}, '--tag', 'v1.2.3', '--dry-run');
    expect(output).toMatch(/chr-json-editor-1\.2\.3\.vsix not found/);
    expect(status).toBe(1);
  });

  it('refuses a dry run that holds a token', () => {
    const { status, output } = run({ OVSX_PAT: 'x' }, '--tag', 'v1.2.3', '--dry-run');
    expect(output).toMatch(/--dry-run refuses to run with OVSX_PAT set/);
    expect(status).toBe(1);
  });

  it('refuses to publish unless both tokens are set', () => {
    const { status, output } = run({ VSCE_PAT: 'x', OVSX_PAT: '' }, '--tag', 'v1.2.3');
    expect(output).toMatch(
      /OVSX_PAT not set; the release job reads them from the `release` environment/,
    );
    expect(output).not.toMatch(/Marketplace publish/);
    expect(status).toBe(1);
  });

  it('rejects bad arguments', () => {
    expect(run({}, '--dry-run').status).toBe(2);
    expect(run({}, '--tag', 'v1.2.3', '--publish').status).toBe(2);
  });
});
