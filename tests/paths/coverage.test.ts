// Spec 018 criterion 2 (018 T1): the corpus has at least one case per tag, uses no tag outside the
// vocabulary (tags.json), and the tags whose criterion names particular offsets or names hold them.
import { describe, expect, it } from 'vitest';
import { parseData } from '@chr-json-editor/core';
import { pathCases, pathTags, type PathCase } from './cases';

/** Every member name in a case's data. */
function names(c: PathCase): Set<string> {
  const parsed = parseData(c.format, c.text);
  const out = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === 'object')
      for (const [key, child] of Object.entries(value)) {
        out.add(key);
        walk(child);
      }
  };
  if ('data' in parsed) walk(parsed.data);
  return out;
}

const tagged = (tag: string) => pathCases().filter((c) => c.tags.includes(tag));

describe('copy path corpus coverage (spec 018 criterion 2)', () => {
  const cases = pathCases();

  it.each(pathTags)('has a case tagged %s', (tag) => {
    expect(tagged(tag).map((c) => c.name)).not.toEqual([]);
  });

  it('uses only tags from the vocabulary', () => {
    for (const c of cases)
      for (const tag of c.tags) expect(pathTags, `${c.name}: ${tag}`).toContain(tag);
  });

  it.each([
    ['quoted-name', ['.', ' ', '[', '9lives', '$', '@', '*']],
    ['escaped-name', ["it's", 'back\\slash', 'line\nfeed', 'tab\there', '\u0001']],
    ['unicode-name', ['é', '我', '😀']],
    ['empty-name', ['']],
    ['index-like-name', ['0']],
    ['pointer-escapes', ['a/b', 'm~n']],
    ['proto-name', ['__proto__', 'constructor']],
    ['lone-surrogate', ['\udc00']],
  ])('%s cases hold the names the criterion lists', (tag, wanted) => {
    const held = new Set(tagged(tag).flatMap((c) => [...names(c)]));
    for (const name of wanted) expect(held, JSON.stringify(name)).toContain(name);
  });

  it('covers the offsets the criterion lists for on-key, on-scalar, on-bracket and outside', () => {
    const at = (tag: string, test: (c: PathCase, offset: number) => boolean) =>
      tagged(tag).some((c) => c.nodes.some((n) => test(c, n.offset)));
    const char = (c: PathCase, offset: number) => c.text[offset];
    // A1: the key's opening quote and the colon after it.
    expect(
      at('on-key', (c, o) => char(c, o) === '"' && c.text.slice(o).match(/^"[^"]*"\s*:/) !== null),
    ).toBe(true);
    expect(at('on-key', (c, o) => char(c, o) === ':')).toBe(true);
    // A2: a scalar's first character and the offset just after its last.
    expect(
      at(
        'on-scalar',
        (c, o) => /[0-9tfn"]/.test(char(c, o) ?? '') && /[{,:\s]/.test(c.text[o - 1] ?? ''),
      ),
    ).toBe(true);
    expect(
      at(
        'on-scalar',
        (c, o) => /[0-9el"]/.test(c.text[o - 1] ?? '') && /[,}\]\s]/.test(char(c, o) ?? ''),
      ),
    ).toBe(true);
    // A3: both brackets, both sides.
    for (const b of ['[', ']', '{', '}']) {
      expect(
        at('on-bracket', (c, o) => char(c, o) === b),
        `before ${b}`,
      ).toBe(true);
      expect(
        at('on-bracket', (c, o) => c.text[o - 1] === b),
        `after ${b}`,
      ).toBe(true);
    }
    // A5: before the root, after it, and a BOM.
    expect(at('outside', (_, o) => o === 0)).toBe(true);
    expect(at('outside', (c, o) => o === c.text.length)).toBe(true);
    expect(tagged('outside').some((c) => c.text.startsWith('\ufeff'))).toBe(true);
  });

  it('covers comments, line breaks, spaces and commas for between', () => {
    const kinds = new Set<string>();
    for (const c of tagged('between'))
      for (const { offset } of c.nodes) {
        const ch = c.text[offset];
        if (ch === ' ') kinds.add('space');
        if (ch === '\n') kinds.add('line break');
        if (c.text[offset - 1] === ',') kinds.add('comma');
        if (/\/\/[^\n]*$|\/\*(?:(?!\*\/).)*$/s.test(c.text.slice(0, offset))) kinds.add('comment');
      }
    expect([...kinds].sort()).toEqual(['comma', 'comment', 'line break', 'space']);
  });

  it('covers items, blank lines and CRLF for jsonl', () => {
    const lines = tagged('jsonl');
    expect(lines.some((c) => c.text.includes('\r\n'))).toBe(true);
    expect(lines.some((c) => /\n[ \t]*\r?\n/.test(c.text))).toBe(true);
  });
});
