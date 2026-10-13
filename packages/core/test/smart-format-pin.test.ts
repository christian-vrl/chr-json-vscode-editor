// smart-format.ts overrides private FracturedJson members (its header names them), so the package
// must stay at exactly 5.1.0 (spec 010 criterion 12). A version bump fails here first: re-check
// every override, regenerate and re-review the golden corpus, then change this test with it.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const PINNED = '5.1.0';

describe('fracturedjsonjs pin', () => {
  it('core depends on exactly 5.1.0, with no range', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(manifest.dependencies.fracturedjsonjs).toBe(PINNED);
  });

  it('the installed package is 5.1.0', () => {
    const require = createRequire(import.meta.url);
    const installed = require('fracturedjsonjs/package.json') as { version: string };
    expect(installed.version).toBe(PINNED);
  });
});
