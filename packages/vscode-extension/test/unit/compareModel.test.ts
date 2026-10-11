// The compare panel's host computation (007 T4, compareModel.ts) against the compare fixtures
// (tests/compare): each side parsed in its own format, the differences, the message the page gets,
// and the text a copy gives, byte for byte against `expected-after-copy.*` (spec 007 criterion 6).
// The e2e suite (compare.cjs) applies the same copies through the panel in VS Code.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeToComparePage, PROTOCOL_VERSION } from '@chr-json-editor/app-shell/protocol';
import { compareCases, type CompareSideFixture } from '../../../../tests/compare/cases';
import {
  buildCompare,
  compareMessage,
  compareTitle,
  copyInto,
  parseSide,
  type CompareSideInput,
} from '../../src/compareModel';

const COMPARE_DIR = path.resolve(__dirname, '../../../../tests/compare');

function input(side: CompareSideFixture, writable = true): CompareSideInput {
  return { name: side.name, format: side.format, text: side.text, writable };
}

describe('compare model', () => {
  it.each(compareCases().map((c) => [c.name, c] as const))('%s: differences', (_n, c) => {
    const model = buildCompare(1, input(c.left), input(c.right));
    expect(model.differences).toEqual(c.expected);
    const message = compareMessage(model);
    expect(decodeToComparePage(JSON.parse(JSON.stringify(message)))).toEqual({
      ok: true,
      message,
    });
    expect(message.left.content).toEqual({ kind: 'text', text: c.left.text });
  });

  it('copies match expected-after-copy.* byte for byte (criterion 6)', () => {
    const c = compareCases().find((x) => x.name === 'comments')!;
    const copies = JSON.parse(
      readFileSync(path.join(COMPARE_DIR, 'comments', 'copies.json'), 'utf8'),
    ) as { difference: number; to: 'left' | 'right'; expected: string }[];
    expect(copies.length).toBeGreaterThan(0);
    const model = buildCompare(1, input(c.left), input(c.right));
    for (const copy of copies) {
      const expected = readFileSync(path.join(COMPARE_DIR, 'comments', copy.expected), 'utf8');
      const result = copyInto(model, model.differences[copy.difference]!, copy.to);
      expect(result, copy.expected).toEqual({ kind: 'text', text: expected });
    }
  });

  it('keeps JSON5 values a JSON message would lose', () => {
    const model = buildCompare(
      1,
      { name: 'a.json5', format: 'json5', text: '[NaN, Infinity, -0]', writable: true },
      { name: 'b.json5', format: 'json5', text: '[NaN, Infinity, 0]', writable: true },
    );
    expect(model.differences).toEqual([{ kind: 'changed', leftPath: '/2', rightPath: '/2' }]);
  });

  it('shows a parse error with its position instead of comparing (criterion 8)', () => {
    expect(parseSide('{\n  "a": 1,\n  "b"\n}', 'json')).toEqual({
      kind: 'error',
      message: expect.stringMatching(/ at line 4, column 1$/) as unknown,
    });
    expect(parseSide('', 'json')).toMatchObject({ kind: 'error' });
    expect(parseSide('{a: 1, // c\n}', 'json5')).toEqual({ kind: 'data', data: { a: 1 } });
    const model = buildCompare(
      2,
      { name: 'a.json', format: 'json', text: '{"a": 1', writable: true },
      { name: 'b.json', format: 'json', text: '{"a": 2}', writable: true },
    );
    expect(model.differences).toEqual([]);
    expect(compareMessage(model)).toMatchObject({
      protocol: PROTOCOL_VERSION,
      type: 'compare',
      docVersion: 2,
      left: { content: { kind: 'error' } },
      right: { content: { kind: 'text', text: '{"a": 2}' } },
    });
    expect(copyInto(model, { kind: 'changed', leftPath: '/a', rightPath: '/a' }, 'left')).toEqual({
      kind: 'refused',
      code: 'not-compared',
      message: 'Both sides must parse to copy a difference',
    });
  });

  it('refuses a copy into the HEAD side and a difference it does not hold', () => {
    const model = buildCompare(
      1,
      { name: 'a.json (HEAD)', format: 'json', text: '{"a": 1}', writable: false },
      { name: 'a.json', format: 'json', text: '{"a": 2}', writable: true },
    );
    const d = model.differences[0]!;
    expect(copyInto(model, d, 'left')).toMatchObject({ kind: 'refused', code: 'read-only' });
    expect(copyInto(model, { kind: 'added', rightPath: '/b' }, 'right')).toMatchObject({
      kind: 'refused',
      code: 'unknown-difference',
    });
    expect(copyInto(model, d, 'right')).toEqual({ kind: 'text', text: '{"a": 1}' });
  });

  it('titles the panel with both names', () => {
    expect(compareTitle('data.jsonc (HEAD)', 'data.jsonc')).toBe('data.jsonc (HEAD) ↔ data.jsonc');
  });
});
