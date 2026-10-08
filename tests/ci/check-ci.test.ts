// scripts/check-ci.mjs (001 T10): every standard script runs in ci.yml, and placeholders are named.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const script = path.join(repo, 'scripts/check-ci.mjs');

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: repo, encoding: 'utf8' });
  return { status: result.status, output: result.stdout + result.stderr };
}

describe('check-ci on the repository', () => {
  it('passes with check:readme named as the placeholder', () => {
    const { status, output } = run('--placeholder', 'check:readme');
    expect(output).toMatch(/placeholders, green but not coverage: check:readme/);
    expect(status).toBe(0);
  });

  it('fails when a placeholder is not named', () => {
    const { status, output } = run();
    expect(output).toMatch(/`check:readme` is a placeholder/);
    expect(status).toBe(1);
  });

  it('matches the --placeholder list in ci.yml', () => {
    const workflow = readFileSync(path.join(repo, '.github/workflows/ci.yml'), 'utf8');
    expect(workflow).toMatch(/node scripts\/check-ci\.mjs --placeholder check:readme\n/);
  });

  it('rejects unknown arguments', () => {
    expect(run('--placeholders', 'x').status).toBe(2);
  });
});

describe('check-ci on a modified copy', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'check-ci-'));
    mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
    for (const file of ['AGENTS.md', 'package.json', '.github/workflows/ci.yml']) {
      cpSync(path.join(repo, file), path.join(root, file));
    }
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const edit = (file: string, change: (text: string) => string) =>
    writeFileSync(path.join(root, file), change(readFileSync(path.join(root, file), 'utf8')));
  const editScripts = (change: (scripts: Record<string, string>) => void) =>
    edit('package.json', (text) => {
      const manifest = JSON.parse(text) as { scripts: Record<string, string> };
      change(manifest.scripts);
      return JSON.stringify(manifest);
    });

  it('fails when ci.yml stops running a standard script', () => {
    edit('.github/workflows/ci.yml', (text) => text.replace(/pnpm test:golden/g, 'true'));
    const { status, output } = run('--root', root, '--placeholder', 'check:readme');
    expect(output).toMatch(/ci\.yml does not run `pnpm test:golden`/);
    expect(status).toBe(1);
  });

  it('does not count a script named only in a comment', () => {
    edit('.github/workflows/ci.yml', (text) =>
      text.replace(/- run: pnpm test:golden/g, '# - run: pnpm test:golden'),
    );
    const { status, output } = run('--root', root, '--placeholder', 'check:readme');
    expect(output).toMatch(/ci\.yml does not run `pnpm test:golden`/);
    expect(status).toBe(1);
  });

  it('does not take `pnpm test:web-x` for `pnpm test:web`', () => {
    edit('.github/workflows/ci.yml', (text) => text.replace(/pnpm test:web/g, 'pnpm test:web-x'));
    const { status, output } = run('--root', root, '--placeholder', 'check:readme');
    expect(output).toMatch(/ci\.yml does not run `pnpm test:web`/);
    expect(status).toBe(1);
  });

  it('fails when a standard script is missing from package.json', () => {
    editScripts((scripts) => delete scripts['check:offline']);
    const { status, output } = run('--root', root, '--placeholder', 'check:readme');
    expect(output).toMatch(/`check:offline` is missing from package\.json/);
    expect(status).toBe(1);
  });

  it('fails when a real script turns into a placeholder', () => {
    editScripts((scripts) => {
      scripts['test:golden'] = 'node scripts/not-yet.mjs test:golden "later"';
    });
    const { status, output } = run('--root', root, '--placeholder', 'check:readme');
    expect(output).toMatch(/`test:golden` is a placeholder/);
    expect(status).toBe(1);
  });

  it('fails when a named placeholder becomes a real check', () => {
    editScripts((scripts) => {
      scripts['check:readme'] = 'node scripts/check-readme.mjs';
    });
    const { status, output } = run('--root', root, '--placeholder', 'check:readme');
    expect(output).toMatch(/`check:readme` is listed as a placeholder but runs a real check/);
    expect(status).toBe(1);
  });
});
