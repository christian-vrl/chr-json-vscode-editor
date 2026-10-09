// scripts/check-release-workflow.mjs (005 T2): release.yml meets spec 005 criterion 3.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const script = path.join(repo, 'scripts/check-release-workflow.mjs');
const release = readFileSync(path.join(repo, '.github/workflows/release.yml'), 'utf8');

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: repo, encoding: 'utf8' });
  return { status: result.status, output: result.stdout + result.stderr };
}

describe('check-release-workflow on the repository', () => {
  it('passes release.yml', () => {
    const { status, output } = run();
    expect(output).toMatch(/ok, runs only on v\* tags/);
    expect(status).toBe(0);
  });

  it('rejects unknown arguments and missing files', () => {
    expect(run('--workflows', 'x').status).toBe(2);
    expect(run('--workflow', path.join(repo, 'no-such.yml')).status).toBe(2);
  });
});

describe('check-release-workflow on a modified copy', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'check-release-workflow-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function check(change: (text: string) => string) {
    const file = path.join(dir, 'release.yml');
    const changed = change(release);
    expect(changed).not.toBe(release);
    writeFileSync(file, changed);
    return run('--workflow', file);
  }

  it.each([
    [
      'a branch push trigger',
      (t: string) => t.replace("tags: ['v*']", "tags: ['v*']\n    branches: [main]"),
    ],
    [
      'workflow_dispatch',
      (t: string) => t.replace('\npermissions:', '  workflow_dispatch:\n\npermissions:'),
    ],
    ['pull_request', (t: string) => t.replace('\npermissions:', '  pull_request:\n\npermissions:')],
    [
      'a tag pattern not starting with v',
      (t: string) => t.replace("tags: ['v*']", "tags: ['v*', '*']"),
    ],
  ])('fails with %s', (_name, change) => {
    const { status, output } = check(change);
    expect(output).toMatch(/`on`|`on\.push`|on\.push\.tags/);
    expect(status).toBe(1);
  });

  it('fails when the publish job leaves the release environment', () => {
    const { status, output } = check((t) => t.replace('    environment: release\n', ''));
    expect(output).toMatch(/job `publish` reads VSCE_PAT, OVSX_PAT without `environment: release`/);
    expect(status).toBe(1);
  });

  it('accepts the environment in its object form', () => {
    const { status } = check((t) =>
      t.replace('    environment: release\n', '    environment:\n      name: release\n'),
    );
    expect(status).toBe(0);
  });

  it('fails when a token is read in the package job', () => {
    const { status, output } = check((t) =>
      t.replace(
        '        run: node scripts/release.mjs --tag "$GITHUB_REF_NAME" --dry-run\n',
        '        run: node scripts/release.mjs --tag "$GITHUB_REF_NAME" --dry-run\n' +
          "        env:\n          VSCE_PAT: ${{ secrets['VSCE_PAT'] }}\n",
      ),
    );
    expect(output).toMatch(/job `package` reads VSCE_PAT without `environment: release`/);
    expect(status).toBe(1);
  });

  it('fails when a token is read at workflow level', () => {
    const { status, output } = check((t) =>
      t.replace('\njobs:', '\nenv:\n  OVSX_PAT: ${{ secrets.OVSX_PAT }}\n\njobs:'),
    );
    expect(output).toMatch(/secrets\.OVSX_PAT is read outside a job/);
    expect(status).toBe(1);
  });

  it('fails on another secret, and when a token is not read', () => {
    const { status, output } = check((t) => t.replace('secrets.OVSX_PAT', 'secrets.NPM_TOKEN'));
    expect(output).toMatch(/unexpected secret NPM_TOKEN/);
    expect(output).toMatch(/no job in the `release` environment reads secrets\.OVSX_PAT/);
    expect(status).toBe(1);
  });

  it('fails when a job passes secrets on', () => {
    const { status, output } = check((t) =>
      t.replace('    needs: package\n', '    needs: package\n    secrets: inherit\n'),
    );
    expect(output).toMatch(/job `publish` passes secrets to a called workflow/);
    expect(status).toBe(1);
  });
});
