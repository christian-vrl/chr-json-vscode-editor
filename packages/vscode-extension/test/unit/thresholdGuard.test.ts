// Spec 019 plan R6: every gate on spec 008's threshold takes it from the setting, through
// `thresholdBytes` in largeFile.ts. A 5 MiB constant in any package's source is either one of the
// defaults listed here, with the reason it may stay, or a gate that misses the setting.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PACKAGES = resolve(__dirname, '../../..');

/** 5 MiB written as a product of 1024s, or as its byte count with or without separators. */
const FIVE_MIB = /\b5\s*\*\s*1024\s*\*\s*1024\b|\b5_?242_?880\b|\b5\s*\*\s*MIB\b/;

/** Where a 5 MiB constant may stay, by path under packages/ and the line it is on. */
const ALLOWED: Record<string, { line: RegExp; why: string }[]> = {
  'vscode-extension/src/largeFile.ts': [
    { line: /^export const LARGE_FILE_THRESHOLD = /, why: "the setting's default" },
  ],
  'vscode-extension/src/compareModel.ts': [
    { line: /^export const COMPARE_LIMIT_BYTES = /, why: "compare's own limit (UNK-037)" },
  ],
  'app-shell/src/protocol.ts': [
    { line: /^\s*thresholdBytes: /, why: "the page's default before the host's settings arrive" },
  ],
  'app-shell/src/query/size-gate.ts': [
    { line: /^export const QUERY_SIZE_LIMIT_BYTES = /, why: "the page's default `limit` argument" },
  ],
};

/** Every source file under `dir`, skipping what is not source. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|svelte|mjs|cjs|js)$/.test(name) ? [path] : [];
  });
}

describe('threshold guard (spec 019 plan R6)', () => {
  it('finds 5 MiB in packages/*/src only where a default or a fixed limit stays', () => {
    const found: string[] = [];
    for (const pkg of readdirSync(PACKAGES)) {
      const src = join(PACKAGES, pkg, 'src');
      if (!statSync(join(PACKAGES, pkg)).isDirectory()) continue;
      let files: string[];
      try {
        files = sources(src);
      } catch {
        continue;
      }
      for (const file of files) {
        const path = relative(PACKAGES, file).split('\\').join('/');
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (!FIVE_MIB.test(line) || /^\s*(\/\/|\*|\/\*)/.test(line)) return;
            if (ALLOWED[path]?.some((allowed) => allowed.line.test(line))) return;
            found.push(`${path}:${i + 1}: ${line.trim()}`);
          });
      }
    }
    expect(found).toEqual([]);
  });

  it('still sees every allowed constant, so the list does not go stale', () => {
    for (const [path, lines] of Object.entries(ALLOWED)) {
      const text = readFileSync(join(PACKAGES, path), 'utf8').split('\n');
      for (const { line } of lines) {
        expect(
          text.some((t) => line.test(t) && FIVE_MIB.test(t)),
          path,
        ).toBe(true);
      }
    }
  });
});
