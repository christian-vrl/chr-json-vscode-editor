// Spec 018 criterion 3's engine check (018 T2, fast-check, seed committed, 10 000 runs): for any
// data and any path of a node in it, json-p3 2.3.2 (spec 014's RFC 9535 engine, in its default
// strict environment) run on the node's P1 text returns exactly the node's value, for every path
// whose names hold no lone surrogate and no U+0000–U+001F other than `\b` `\f` `\n` `\r` `\t`
// (json-p3 2.3.2 refuses those escapes, spec 018 §Current evidence). Same runs as criterion 3's
// path text suite: core's `dataAndPath` with core's seed.
//
// It also decides UNK-081 (delegated): P1 writes `.name` where the name allows it, so the same
// query in RFC 9535's normalized form (§2.7, every name as `['…']`) must select the same node.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { jsonPath, type PathStep } from '@chr-json-editor/core';
import { SEED } from '../../core/test/arbitraries.js';
import { dataAndPath, hasLoneSurrogate } from '../../core/test/path-arbitraries.js';
import { executeJsonpathRfc9535 } from '../src/query/jsonpath-rfc9535.js';

const RUNS = Number(process.env.PATHS_RUNS ?? 10_000);

/** U+0000–U+001F but `\b` `\f` `\n` `\r` `\t`, which P1 writes as `\u00xx`. */
// eslint-disable-next-line no-control-regex
const HEX_ESCAPED = /[\u0000-\u0007\u000b\u000e-\u001f]/;
/** Names json-p3 2.3.2 refuses once P1 has escaped them. */
const refused = (name: string) => hasLoneSurrogate(name) || HEX_ESCAPED.test(name);
const checked = ([, path]: [unknown, PathStep[]]) =>
  path.every((step) => typeof step === 'number' || !refused(step));

/** The node's value: the data's own, by reference. */
function valueAt(data: unknown, path: readonly PathStep[]): unknown {
  let value = data;
  for (const step of path) value = (value as Record<PathStep, unknown>)[step];
  return value;
}

/** RFC 9535 §2.7's normalized path: P1 with every shorthand `.name` written `['name']` (a
 *  shorthand name holds nothing `['…']` escapes). */
function normalizedPath(path: readonly PathStep[]): string {
  return path.reduce<string>((out, step) => {
    const part = jsonPath([step]).slice(1);
    return out + (part.startsWith('.') ? `['${part.slice(1)}']` : part);
  }, '$');
}

/** The nodelist's values: spec 014's json-p3 environment (strict RFC 9535). */
const only = (data: unknown, query: string) => executeJsonpathRfc9535(data, query);

describe('path text engine check (spec 018 criterion 3)', () => {
  it(`json-p3 selects exactly the node with P1 and with the normalized form: ${RUNS} runs, seed ${SEED}`, () => {
    fc.assert(
      fc.property(dataAndPath.filter(checked), ([data, path]) => {
        const value = valueAt(data, path);
        const p1 = only(data, jsonPath(path));
        expect(p1).toHaveLength(1);
        expect(Object.is(p1[0], value)).toBe(true);
        const normalized = only(data, normalizedPath(path));
        expect(normalized).toHaveLength(1);
        expect(Object.is(normalized[0], value)).toBe(true);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  }, 300_000);

  it('runs shorthand names, quoted names and indices, and excludes few paths', () => {
    const sample = fc.sample(dataAndPath, { seed: SEED, numRuns: RUNS });
    const kept = sample.filter(checked);
    const texts = kept.map(([, path]) => jsonPath(path));
    expect(texts.some((t) => /\.[A-Za-z_]/.test(t))).toBe(true);
    expect(texts.some((t) => t.includes("['"))).toBe(true);
    expect(texts.some((t) => /\[[0-9]+\]/.test(t))).toBe(true);
    expect(Math.max(...kept.map(([, path]) => path.length))).toBe(64);
    expect(kept.length / sample.length).toBeGreaterThan(0.5);
  });

  it('writes the normalized form of a shorthand name', () => {
    expect(normalizedPath(['people', 1, 'a.b', 'é'])).toBe("$['people'][1]['a.b']['é']");
  });
});
