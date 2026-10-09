// Comment-keeping repair (003 T8; UNK-018, UNK-028). The 20 broken fixtures of spike 002 T11 are
// copied unchanged into fixtures/repair/ with their hand-written anchors; fixtures/repair-json5/
// holds JSON5-only values the spike's data check could not see (it compared with jsonrepair).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import JSON5 from 'json5';
import { jsonrepair } from 'jsonrepair';
import { describe, expect, it } from 'vitest';
import { getAdapter, PatchError, repair, type Format, type FormatNode } from '../src/index.js';
import { scan } from '../src/repair/scan.js';

const fixtures = path.join(import.meta.dirname, 'fixtures');

interface Anchor {
  container: string | null;
  outside?: 'before' | 'after';
  before?: number;
  trailing?: boolean;
  inside?: string;
}
interface SpikeCase {
  format: 'jsonc' | 'json5';
  comments: (Anchor & { text: string })[];
}

const pointer = (segments: (string | number)[]) =>
  segments.map((s) => '/' + String(s).replace(/~/g, '~0').replace(/\//g, '~1')).join('');
const lineOf = (text: string, offset: number) => text.slice(0, offset).split('\n').length - 1;

/** The anchor of the comment at [start, end), in the spike's `case.json` terms (its measure.ts on
 *  core's tree instead of jsonc-parser's, since a JSON5 output keeps hex values). */
function anchorOf(text: string, root: FormatNode, start: number, end: number): Anchor {
  if (end <= root.offset) return { container: null, outside: 'before' };
  if (start >= root.offset + root.length) return { container: null, outside: 'after' };
  let container = root;
  const at: (string | number)[] = [];
  for (;;) {
    const members = container.children ?? [];
    const index = members.findIndex((m) => m.offset <= start && end <= m.offset + m.length);
    const holder = members[index];
    const value = holder?.type === 'property' ? holder.children?.[1] : holder;
    if (
      value &&
      (value.type === 'object' || value.type === 'array') &&
      value.offset <= start &&
      end <= value.offset + value.length
    ) {
      at.push(holder!.type === 'property' ? (holder!.children![0]!.value as string) : index);
      container = value;
      continue;
    }
    break;
  }
  const members = container.children ?? [];
  const before = members.filter((m) => m.offset + m.length <= start).length;
  const index = members.findIndex((m) => m.offset < start && end <= m.offset + m.length);
  const anchor: Anchor = { container: pointer(at), before };
  if (index >= 0) {
    const holder = members[index]!;
    const key = holder.type === 'property' ? (holder.children![0]!.value as string) : index;
    anchor.inside = pointer([...at, key]);
    anchor.trailing = false;
  } else {
    const prev = members[before - 1];
    anchor.trailing = prev
      ? lineOf(text, prev.offset + prev.length) === lineOf(text, start)
      : false;
  }
  return anchor;
}

/** Comments of a parsed output, from core's own token streams. */
function commentsIn(text: string, format: Format): { start: number; end: number; text: string }[] {
  return scan(text, format === 'json5').comments;
}

describe('spike 002 T11 fixtures: every comment kept at its anchor (UNK-018)', () => {
  const dir = path.join(fixtures, 'repair');
  const names = readdirSync(dir).filter((n) => /^\d\d-/.test(n));
  it('has the 20 fixtures', () => expect(names).toHaveLength(20));

  describe.each(names)('%s', (name) => {
    const spec = JSON.parse(readFileSync(path.join(dir, name, 'case.json'), 'utf8')) as SpikeCase;
    const input = readFileSync(path.join(dir, name, `input.${spec.format}`), 'utf8');
    const result = repair(input, spec.format);
    const parsed = getAdapter(spec.format).parse(result.text);

    it('loses no comment and parses in its format', () => {
      expect(result.lostComments).toEqual([]);
      expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    });

    it('keeps the data of the repair', () => {
      const literals = scan(input, spec.format === 'json5').literals;
      if (literals.length === 0) {
        // Same data as plain jsonrepair, compared through JSON as the spike does.
        expect(JSON.parse(JSON.stringify(parsed.data))).toEqual(JSON.parse(jsonrepair(input)));
      } else {
        // UNK-028: JSON5-only values stay as written (fixture 18: hex colours).
        for (const literal of literals) expect(result.text).toContain(literal.text);
        expect(isDeepStrictEqual(JSON5.parse(result.text), parsed.data)).toBe(true);
      }
    });

    it('keeps every comment, in order, at its hand-written anchor', () => {
      const found = commentsIn(result.text, spec.format);
      expect(found.map((c) => c.text)).toEqual(spec.comments.map((c) => c.text));
      found.forEach((c, n) => {
        const expected: Anchor = { ...spec.comments[n]! };
        delete (expected as { text?: string }).text;
        const anchor = anchorOf(result.text, parsed.tree!, c.start, c.end);
        expect({ ...anchor, trailing: anchor.trailing ?? false }).toEqual({
          ...expected,
          trailing: expected.trailing ?? false,
        });
      });
    });
  });
});

describe('JSON5-only values are kept (UNK-028)', () => {
  const dir = path.join(fixtures, 'repair-json5');
  const names = readdirSync(dir).filter((n) => !n.includes('.'));
  describe.each(names)('%s', (name) => {
    const input = readFileSync(path.join(dir, name, 'input.json5'), 'utf8');
    const expected = readFileSync(path.join(dir, name, 'expected.json5'), 'utf8');
    const result = repair(input, 'json5');

    it('is byte-equal to expected.json5 and loses no comment', () => {
      expect(result.text).toBe(expected);
      expect(result.lostComments).toEqual([]);
    });

    it('writes every JSON5-only value of the input as it was', () => {
      const literals = scan(input, true).literals;
      expect(literals.length).toBeGreaterThan(0);
      for (const literal of literals) expect(result.text).toContain(literal.text);
    });

    it('reads as the same data with the json5 package as with core', () => {
      const ours = getAdapter('json5').parse(result.text);
      expect(ours.diagnostics).toEqual([]);
      expect(isDeepStrictEqual(JSON5.parse(result.text), ours.data)).toBe(true);
    });
  });

  it('is what plain jsonrepair gets wrong', () => {
    expect(() =>
      jsonrepair(readFileSync(path.join(dir, 'plus-sign', 'input.json5'), 'utf8')),
    ).toThrow();
    expect(jsonrepair('{"a": 0x1F}')).toBe('{"a": "0x1F"}');
  });
});

describe('repair', () => {
  it('returns a text that already parses unchanged', () => {
    const text = '{\n  // c\n  "a": [1, 2,],\n}\n';
    expect(repair(text, 'jsonc')).toEqual({ text, lostComments: [] });
    expect(repair("{a: 0x1F, b: 'x',}", 'json5').text).toBe("{a: 0x1F, b: 'x',}");
  });

  it('repairs JSON and keeps its comments, which JSON shows as warnings', () => {
    const result = repair('{"a": 1 // one\n "b": 2}', 'json');
    expect(result).toEqual({ text: '{"a": 1, // one\n "b": 2}', lostComments: [] });
  });

  it('reports a comment it cannot keep (a comment between the parts of a concatenation)', () => {
    const input = '{\n  "a": "x" + // between\n    "y",\n  "b": 1 // kept\n}\n';
    const result = repair(input, 'jsonc');
    expect(result.lostComments).toEqual(['// between']);
    expect(result.text).toContain('// kept');
    expect(JSON.parse(jsonrepair(input))).toEqual({ a: 'xy', b: 1 });
    expect(getAdapter('jsonc').parse(result.text).data).toEqual({ a: 'xy', b: 1 });
  });

  it('reads JSON5-only values only in JSON5', () => {
    expect(scan('{"a": 0x1F, "b": "\\x41"}', false).literals).toEqual([]);
    expect(repair('{"a": 0x1F "b": 1}', 'jsonc').text).toBe('{"a": "0x1F", "b": 1}');
  });

  it('does not take an identifier key for a value', () => {
    expect(scan('{Infinity: 1, NaN : 2, x: NaN}', true).literals.map((l) => l.text)).toEqual([
      'NaN',
    ]);
  });

  it('throws a PatchError when jsonrepair cannot repair', () => {
    expect(() => repair('{"a": +Infinity}', 'jsonc')).toThrow(PatchError);
  });
});
