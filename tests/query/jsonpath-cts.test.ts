// Spec 014 (014 T1): the vendored JSONPath Compliance Test Suite is the pinned one. cts.json's bytes
// match the SHA-256 in SOURCE, SOURCE names the commit spec 014 pins, and the file holds 706 tests,
// each either a valid selector with a document and its result(s) or an invalid selector. Running
// the engine against every test (criterion 1) is jsonpath-rfc9535.test.ts (014 T2).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ctsRoot, ctsSha256, ctsSource, loadCtsTests } from './query.js';

const PINNED_COMMIT = '9d1a415a53f5dfb291bc874823892e49174e38eb';
const PINNED_TESTS = 706;

describe('vendored JSONPath compliance test suite (spec 014)', () => {
  const source = ctsSource();
  const tests = loadCtsTests();

  it('is the pinned commit, with its URL and licence recorded', () => {
    expect(source).toMatchObject({
      url: 'https://github.com/jsonpath-standard/jsonpath-compliance-test-suite',
      commit: PINNED_COMMIT,
      file: 'cts.json',
      tests: String(PINNED_TESTS),
    });
    expect(source.license).toMatch(/^BSD-2-Clause\b/);
    expect(existsSync(path.join(ctsRoot, 'LICENSE'))).toBe(true);
    expect(readFileSync(path.join(ctsRoot, 'LICENSE'), 'utf8')).toContain('BSD-2 License');
  });

  it("matches SOURCE's SHA-256 byte for byte", () => {
    expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ctsSha256()).toBe(source.sha256);
  });

  it(`holds ${PINNED_TESTS} tests`, () => {
    expect(tests).toHaveLength(PINNED_TESTS);
  });

  it('has a selector and either a result or invalid_selector in every test', () => {
    const malformed = tests
      .filter((t) =>
        t.invalid_selector === true
          ? 'document' in t || 'result' in t || 'results' in t
          : !('document' in t) ||
            Array.isArray(t.result) === Array.isArray(t.results) ||
            !(t.results ?? []).every(Array.isArray),
      )
      .map((t) => t.name);
    expect(tests.every((t) => typeof t.name === 'string' && typeof t.selector === 'string')).toBe(
      true,
    );
    expect(malformed).toEqual([]);
  });
});
