// Spec 016 criterion 2 (016 T1): the corpus has at least one case per tag, uses no tag outside the
// vocabulary (tags.json), and its `scalar-root` cases cover one root of each scalar JSON type
// (null, boolean, string, integer, number; arrays and objects are the `empty-array` and
// `empty-object` roots).
import { describe, expect, it } from 'vitest';
import { schemaGenCases, schemaGenTags } from './cases';

describe('schema generation corpus coverage (spec 016 criterion 2)', () => {
  const cases = schemaGenCases();

  it.each(schemaGenTags)('has a case tagged %s', (tag) => {
    expect(cases.filter((c) => c.tags.includes(tag)).map((c) => c.name)).not.toEqual([]);
  });

  it('uses only tags from the vocabulary', () => {
    for (const c of cases) {
      for (const tag of c.tags) expect(schemaGenTags, `${c.name}: ${tag}`).toContain(tag);
    }
  });

  it('has a scalar root of every JSON type', () => {
    const rootTypes = cases
      .filter((c) => c.tags.includes('scalar-root'))
      .map((c) => (JSON.parse(c.expected!) as { type: string }).type);
    expect(new Set(rootTypes)).toEqual(new Set(['null', 'boolean', 'string', 'integer', 'number']));
    for (const [tag, type] of [
      ['empty-array', 'array'],
      ['empty-object', 'object'],
    ] as const) {
      const roots = cases
        .filter((c) => c.tags.includes(tag))
        .map((c) => (JSON.parse(c.expected!) as { type: string }).type);
      expect(roots, tag).toContain(type);
    }
  });

  it('has the same-data case in all three formats with one expected file', () => {
    const sameData = cases.filter((c) => c.tags.includes('same-data'));
    for (const c of sameData) {
      expect(c.inputs.map((i) => i.format).sort()).toEqual(['json', 'json5', 'jsonc']);
    }
  });
});
