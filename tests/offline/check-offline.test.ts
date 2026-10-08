import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const script = path.join(repo, 'scripts/check-offline.mjs');

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: repo, encoding: 'utf8' });
  return { status: result.status, output: result.stdout + result.stderr };
}

describe('check:offline dist scan (spec 001 criterion 3)', () => {
  it('fails on the fixture page calling fetch(https://example.com)', () => {
    const { status, output } = run('--dist', 'tests/fixtures/offline-fetch/web');
    expect(output).toMatch(/index\.html:\d+: https:\/\/example\.com/);
    expect(status).toBe(1);
  });

  it('rejects unknown arguments', () => {
    expect(run('--dsit', 'x').status).toBe(2);
  });
});

describe('check:offline allowlist and walk', () => {
  let root: string | undefined;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  /** Writes `<root>/<file>` under a fresh temp root and returns the root. */
  function file(name: string, text: string) {
    root ??= mkdtempSync(path.join(tmpdir(), 'chr-offline-'));
    const full = path.join(root, name);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, text);
    return root;
  }

  it('passes a dist with no URLs', () => {
    const dir = file('dist/a.js', 'export const a = 1;\n');
    const { status, output } = run('--dist', path.join(dir, 'dist'));
    expect(output).toMatch(/check:offline: ok/);
    expect(status).toBe(0);
  });

  it('finds URLs in nested files, in any case, with the line number', () => {
    const dir = file('dist/deep/b.js', 'const x = 1;\nload("HTTP://cdn.example.org/lib.js");\n');
    const { status, output } = run('--dist', path.join(dir, 'dist'));
    expect(output).toMatch(/deep[/\\]b\.js:2: HTTP:\/\/cdn\.example\.org\/lib\.js/);
    expect(status).toBe(1);
  });

  it('passes a URL listed exactly in the allowlist, and only that URL', () => {
    const dir = file('dist/c.js', '// see https://json5.org/\nfetch("https://example.com/x");\n');
    file('allow.txt', '# comment\n\nhttps://json5.org/\n');
    const { status, output } = run(
      '--dist',
      path.join(dir, 'dist'),
      '--allowlist',
      path.join(dir, 'allow.txt'),
    );
    expect(output).not.toMatch(/json5\.org/);
    expect(output).toMatch(/c\.js:2: https:\/\/example\.com\/x/);
    expect(status).toBe(1);
  });

  it('does not treat an allowlisted URL as a prefix', () => {
    const dir = file('dist/d.js', 'fetch("https://json5.org/evil");\n');
    file('allow.txt', 'https://json5.org/\n');
    expect(
      run('--dist', path.join(dir, 'dist'), '--allowlist', path.join(dir, 'allow.txt')).status,
    ).toBe(1);
  });

  it('exits 2 when there is nothing to scan, so an unbuilt repo never passes', () => {
    const dir = file('empty/.keep', '');
    rmSync(path.join(dir, 'empty/.keep'));
    expect(run('--dist', path.join(dir, 'empty')).status).toBe(2);
    expect(run('--dist', path.join(dir, 'missing')).status).toBe(2);
  });
});
