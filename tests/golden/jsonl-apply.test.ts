// Criterion 1 of spec 012 (012 T2): for every patch case of the JSON Lines corpus,
// `applyPatch(input, patch)` of the `jsonl` adapter is byte-equal to `expected.jsonl`, or throws the
// `PatchError` of `error.json`; `parse(expected).data` deep-equals `immutable-json-patch`'s result on
// `parse(input).data` (as 002 criteria 1–2); parse cases give their data and diagnostics (L1).
// Repair cases are 012 T3's (`repairLines`).
import { immutableJSONPatch, type JSONPatchDocument } from 'immutable-json-patch';
import { describe, expect, it } from 'vitest';
import { getAdapter, PatchError, type PatchOperation } from '../../packages/core/src/index.js';
import { loadJsonlCases, type JsonlParseCase, type JsonlPatchCase } from './jsonl.js';

const adapter = getAdapter('jsonl');
const cases = loadJsonlCases();
const patchCases = cases.filter((c): c is JsonlPatchCase => c.kind === 'patch');
const parseCases = cases.filter((c): c is JsonlParseCase => c.kind === 'parse');

/** Data with key order, so a reordered object differs (`toEqual` ignores key order). */
const ordered = (data: unknown) => JSON.stringify(data);

describe.each(patchCases.map((c) => [c.name, c] as const))('patch %s', (_, c) => {
  const patch = c.patch as unknown as PatchOperation[];
  if (c.error) {
    it('applyPatch throws the PatchError of error.json (R9, L8, L9)', () => {
      expect(() => adapter.applyPatch(c.input, patch)).toThrow(PatchError);
      if (c.error!.message !== undefined) {
        expect(() => adapter.applyPatch(c.input, patch)).toThrow(c.error!.message);
      }
    });
    return;
  }
  it('applyPatch is byte-equal to expected', () => {
    expect(adapter.applyPatch(c.input, patch)).toBe(c.expected);
  });
  it("parse(expected).data is immutable-json-patch's result on parse(input).data", () => {
    const want = immutableJSONPatch(
      adapter.parse(c.input).data,
      c.patch as unknown as JSONPatchDocument,
    );
    expect(adapter.parse(c.expected!).data).toEqual(want);
    expect(ordered(adapter.parse(c.expected!).data)).toBe(ordered(want));
  });
});

describe.each(parseCases.map((c) => [c.name, c] as const))('parse %s', (_, c) => {
  it('gives the data and diagnostics of the case (L1)', () => {
    const result = adapter.parse(c.input);
    expect(ordered(result.data)).toBe(ordered(c.data));
    expect(result.data).toEqual(c.data);
    expect(result.diagnostics).toEqual(c.diagnostics);
  });
});
