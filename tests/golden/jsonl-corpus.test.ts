// Checks the hand-written JSON Lines corpus (012 T1) against readings that do not use the `jsonl`
// adapter (jsonl-reference.ts, `JSON.parse`, `immutable-json-patch`), so a typo in a case fails
// before 012 T2 runs criterion 1 on the same cases:
// - patch cases: the tags match the patch (the tagged op is in it, the location is where its path
//   points); expected's items are what `immutable-json-patch` makes of the input's items (criterion
//   1); expected has no bad line, keeps the input's line ending, final newline (L2's reading) and
//   BOM (L9, R10); the lines of items no operation names stay, in order (L3–L7); a nested patch on
//   one item gives the line spec 002's `json` adapter writes for that item's text (L7); an error
//   case is a failing `test` (R9), a root value that is not an array or a root `remove` (L8), or an
//   input with a bad line, whose message names the first one (L9);
// - parse cases: data.json and diagnostics.json are L1's reading of the input;
// - repair cases: the lines that are not bad stay in order, every line `repairLines` wrote is
//   compact JSON (002 R12), a run of bad lines that is one value becomes that value's compact line,
//   the unrepaired lines are bad and kept, and they are the only bad lines left (L10).
import { immutableJSONPatch, type JSONPatchDocument } from 'immutable-json-patch';
import { describe, expect, it } from 'vitest';
import { getAdapter, type PatchOperation } from '../../packages/core/src/index.js';
import {
  badLineDiagnostics,
  compactJson,
  isBlank,
  isGoodLine,
  jsonlStyle,
  readJsonl,
  splitLines,
  type Line,
} from './jsonl-reference.js';
import {
  loadJsonlCases,
  type JsonlParseCase,
  type JsonlPatchCase,
  type JsonlRepairCase,
} from './jsonl.js';

const cases = loadJsonlCases();
const patchCases = cases.filter((c): c is JsonlPatchCase => c.kind === 'patch');
const parseCases = cases.filter((c): c is JsonlParseCase => c.kind === 'parse');
const repairCases = cases.filter((c): c is JsonlRepairCase => c.kind === 'repair');

/** Data with key order, so a reordered object differs (`toEqual` ignores key order). */
const ordered = (data: unknown) => JSON.stringify(data);

const tokens = (pointer: string) => (pointer === '' ? [] : pointer.slice(1).split('/'));

function locationOf(pointer: string): string {
  const depth = tokens(pointer).length;
  return depth === 0 ? 'root' : depth === 1 ? 'item' : 'nested';
}

/** The item indices the patch names in `path` or `from` (`-` and the root name none). */
function namedItems(patch: readonly { path: string; from?: unknown }[]): Set<number> {
  const named = new Set<number>();
  for (const op of patch) {
    for (const pointer of [op.path, op.from]) {
      const first = typeof pointer === 'string' ? tokens(pointer)[0] : undefined;
      if (first !== undefined && /^\d+$/.test(first)) named.add(Number(first));
    }
  }
  return named;
}

/** Whether `part` appears in `whole` in order (not necessarily side by side). */
function isSubsequence(part: string[], whole: string[]): boolean {
  let i = 0;
  for (const item of whole) if (i < part.length && item === part[i]) i++;
  return i === part.length;
}

const endings = (lines: Line[]) => new Set(lines.map((l) => l.ending).filter((e) => e !== ''));

describe.each(patchCases.map((c) => [c.name, c] as const))('patch %s', (_, c) => {
  const input = readJsonl(c.input);
  const tagged = c.tags.op === 'test-fail' ? 'test' : c.tags.op;
  const op = c.patch.find((o) => o.op === tagged);

  it('the tagged op is in the patch and the location is where its path points', () => {
    expect(op).toBeDefined();
    expect(locationOf(op!.path)).toBe(c.tags.location);
  });

  if (c.error) {
    it('is a failing test, a root that is not an array, or a text with a bad line (R9, L8, L9)', () => {
      const run = () =>
        immutableJSONPatch<unknown>(input.items, c.patch as unknown as JSONPatchDocument);
      if (input.bad.length > 0) {
        expect(c.tags.rules).toContain('L9');
        expect(c.error!.message).toBe(`Line ${input.bad[0]} is not valid JSON.`);
      } else if (c.tags.op === 'test-fail') {
        expect(run).toThrow();
        expect(c.error!.message).toBeUndefined();
      } else {
        expect(c.tags.rules).toContain('L8');
        expect(c.error!.message).toBe('A JSON Lines document holds an array of items.');
        const root = c.patch.find((o) => o.path === '');
        expect(root).toBeDefined();
        expect(root!.op === 'remove' || !Array.isArray(root!.value)).toBe(true);
      }
    });
    return;
  }

  const expected = readJsonl(c.expected!);

  it('input and expected have no bad line', () => {
    expect(input.bad).toEqual([]);
    expect(expected.bad).toEqual([]);
  });

  it("expected's items are the patch applied to the input's items (criterion 1)", () => {
    const want = immutableJSONPatch(input.items, c.patch as unknown as JSONPatchDocument);
    expect(expected.items).toEqual(want);
    expect(ordered(expected.items)).toBe(ordered(want));
  });

  it('keeps the line ending, final newline and BOM (L2, L9)', () => {
    const before = jsonlStyle(c.input);
    const after = jsonlStyle(c.expected!);
    expect(after.finalNewline).toBe(before.finalNewline);
    for (const ending of endings(expected.lines)) expect(ending).toBe(before.eol);
    expect(c.expected!.startsWith('﻿')).toBe(c.input.startsWith('﻿'));
  });

  if (c.tags.location !== 'root') {
    it('keeps the lines of every item the patch does not name, in order', () => {
      const named = namedItems(c.patch);
      const kept = input.lines
        .filter((line) => !input.itemLines.some((l, i) => l === line && named.has(i)))
        .map((line) => line.content);
      expect(
        isSubsequence(
          kept,
          expected.lines.map((l) => l.content),
        ),
      ).toBe(true);
    });
  }

  const named = namedItems(c.patch);
  if (c.tags.location === 'nested' && named.size === 1) {
    it("writes the item's line as spec 002's json adapter does for its text (L7)", () => {
      const index = [...named][0]!;
      const line = input.itemLines[index]!;
      const inner = c.patch.map((o) => ({
        ...o,
        path: o.path.replace(/^\/\d+/, ''),
        ...(typeof o.from === 'string' ? { from: o.from.replace(/^\/\d+/, '') } : {}),
      })) as unknown as PatchOperation[];
      const lineIndex = input.lines.indexOf(line);
      expect(expected.lines[lineIndex]!.content).toBe(
        getAdapter('json').applyPatch(line.content, inner),
      );
    });
  }
});

describe.each(parseCases.map((c) => [c.name, c] as const))('parse %s', (_, c) => {
  it('data.json is the items of the lines that are not bad (L1)', () => {
    const { items } = readJsonl(c.input);
    expect(c.data).toEqual(items);
    expect(ordered(c.data)).toBe(ordered(items));
  });

  it('diagnostics.json has one error per bad line, spanning it without its ending (L1)', () => {
    expect(c.diagnostics).toEqual(badLineDiagnostics(c.input));
  });
});

describe.each(repairCases.map((c) => [c.name, c] as const))('repair %s', (_, c) => {
  const inputLines = splitLines(c.input);
  const outputLines = splitLines(c.expected);
  const isBad = (line: Line) => !isBlank(line) && !isGoodLine(line);

  it('keeps every line that is not bad, in order, and the line endings', () => {
    const kept = inputLines.filter((l) => !isBad(l)).map((l) => l.content);
    expect(
      isSubsequence(
        kept,
        outputLines.map((l) => l.content),
      ),
    ).toBe(true);
    const inputEndings = endings(inputLines);
    for (const ending of endings(outputLines)) expect(inputEndings.has(ending)).toBe(true);
    expect(jsonlStyle(c.expected).finalNewline).toBe(jsonlStyle(c.input).finalNewline);
  });

  it('keeps each unrepaired line, which was bad, and leaves no other bad line', () => {
    for (const n of c.unrepaired) {
      expect(isBad(inputLines[n - 1]!)).toBe(true);
      expect(outputLines[n - 1]!.content).toBe(inputLines[n - 1]!.content);
    }
    expect(readJsonl(c.expected).bad).toEqual(c.unrepaired);
  });

  it('writes each repaired line as compact JSON (002 R12)', () => {
    const inputContents = new Set(inputLines.map((l) => l.content));
    for (const line of outputLines.filter((l) => !inputContents.has(l.content))) {
      expect(isGoodLine(line)).toBe(true);
      expect(compactJson(line.content)).toBe(line.content);
    }
  });

  it('writes a run of bad lines that is one value as that value on one line', () => {
    const runs: Line[][] = [];
    for (const line of inputLines) {
      const last = runs.at(-1);
      if (!isBad(line)) runs.push([]);
      else if (last) last.push(line);
      else runs.push([line]);
    }
    for (const run of runs.filter((r) => r.length > 1)) {
      const text = run.map((l, i) => l.content + (i < run.length - 1 ? l.ending : '')).join('');
      let one = true;
      try {
        JSON.parse(text);
      } catch {
        one = false;
      }
      if (one) expect(outputLines.map((l) => l.content)).toContain(compactJson(text));
    }
  });
});
