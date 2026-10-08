import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const script = path.join(repo, 'scripts/check-licenses.mjs');

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: repo, encoding: 'utf8' });
  return { status: result.status, output: result.stdout + result.stderr };
}

describe('check:licenses (spec 001 criterion 3)', () => {
  it('passes on the repository', () => {
    const { status, output } = run();
    expect(output).toMatch(/check:licenses: ok/);
    expect(status).toBe(0);
  });

  it('fails on the GPL-3.0 fixture', () => {
    const { status, output } = run('--package', 'tests/fixtures/bad-license');
    expect(output).toMatch(/gpl-fixture@1\.0\.0.*GPL-3\.0/);
    expect(status).toBe(1);
  });

  it('passes Font Awesome (CC-BY-4.0 AND MIT)', () => {
    const { status, output } = run('--package', 'tests/fixtures/fontawesome');
    expect(output).toMatch(/check:licenses: ok/);
    expect(status).toBe(0);
  });

  it('rejects unknown arguments', () => {
    expect(run('--pakage', 'x').status).toBe(2);
  });
});

describe('check:licenses dependency walk', () => {
  let root: string | undefined;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  /** Writes `<dir>/package.json` (and an optional LICENSE) under a fresh temp root. */
  function pkg(dir: string, manifest: Record<string, unknown>, licenseText?: string) {
    root ??= mkdtempSync(path.join(tmpdir(), 'chr-licenses-'));
    const full = path.join(root, dir);
    mkdirSync(full, { recursive: true });
    writeFileSync(path.join(full, 'package.json'), JSON.stringify(manifest));
    if (licenseText) writeFileSync(path.join(full, 'LICENSE'), licenseText);
    return full;
  }

  it('ignores devDependencies, so a GPL dev tool does not fail the check', () => {
    const app = pkg('app', { name: 'app', license: 'MIT', devDependencies: { tool: '1.0.0' } });
    pkg('app/node_modules/tool', { name: 'tool', version: '1.0.0', license: 'GPL-3.0' });
    expect(run('--package', app).status).toBe(0);
  });

  it('fails on a transitive production dependency and names the path to it', () => {
    const app = pkg('app', { name: 'app', license: 'MIT', dependencies: { a: '1.0.0' } });
    pkg('app/node_modules/a', {
      name: 'a',
      version: '1.0.0',
      license: 'ISC',
      dependencies: { b: '2.0.0' },
    });
    // Resolved by walking up from a's directory, as Node does.
    pkg('node_modules/b', { name: 'b', version: '2.0.0', license: 'MIT AND GPL-3.0' });
    const { status, output } = run('--package', app);
    expect(output).toMatch(/b@2\.0\.0.*GPL-3\.0/);
    expect(output).toMatch(/app > a > b/);
    expect(status).toBe(1);
  });

  it('fails when a production dependency is not installed, but skips a missing optional one', () => {
    const app = pkg('app', {
      name: 'app',
      license: 'MIT',
      optionalDependencies: { 'other-platform': '1.0.0' },
    });
    expect(run('--package', app).status).toBe(0);
    const broken = pkg('broken', {
      name: 'broken',
      license: 'MIT',
      dependencies: { gone: '1.0.0' },
    });
    const { status, output } = run('--package', broken);
    expect(output).toMatch(/gone.*not installed/);
    expect(status).toBe(1);
  });

  it('writes the notice with third-party license texts only, and only when the check passes', () => {
    const app = pkg('app', {
      name: 'app',
      license: 'MIT',
      dependencies: { lib: '1.2.3', '@scope/inner': 'workspace:*' },
    });
    pkg(
      'app/node_modules/lib',
      { name: 'lib', version: '1.2.3', license: 'BSD-3-Clause' },
      'Copyright lib authors',
    );
    // A workspace: dependency is first-party: checked, but not listed as third-party.
    pkg('app/node_modules/@scope/inner', {
      name: '@scope/inner',
      version: '0.0.0',
      license: 'MIT',
    });
    const notice = path.join(root!, 'NOTICE.md');
    expect(run('--package', app, '--notice', notice).status).toBe(0);
    const text = readFileSync(notice, 'utf8');
    expect(text).toMatch(/## lib@1\.2\.3/);
    expect(text).toMatch(/BSD-3-Clause/);
    expect(text).toMatch(/Copyright lib authors/);
    expect(text).not.toMatch(/@scope\/inner/);

    const bad = path.join(root!, 'BAD.md');
    expect(run('--package', 'tests/fixtures/bad-license', '--notice', bad).status).toBe(1);
    expect(existsSync(bad)).toBe(false);
  });
});
