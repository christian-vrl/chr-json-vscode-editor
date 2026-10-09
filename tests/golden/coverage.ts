// Coverage tags (spec 002 criterion 4, 002 T1). Every case's case.json holds the seven tags below;
// `tagErrors` rejects unknown keys and values so a misspelled tag cannot silently cover nothing,
// and `missingCells` lists the grid cells a format has no case for.
import vocabulary from './tags.json' with { type: 'json' };
import type { GoldenCase, GoldenFormat } from './load.js';

export type TagName = keyof typeof vocabulary.tags;
export const tagNames = Object.keys(vocabulary.tags) as TagName[];
export const tagValues: Record<TagName, readonly string[]> = vocabulary.tags;
export const vocabularyFormats: readonly string[] = vocabulary.formats;

/** Tags a format cannot vary: strict JSON has no comments or trailing commas, and JSON and JSONC
 *  always use double-quoted keys and strings with no JSON5-only literals (spec 002 R4, R6, R8). */
const fixedTags: Record<GoldenFormat, Partial<Record<TagName, string>>> = {
  json: {
    comments: 'none',
    trailingComma: 'no',
    quote: 'double',
    keyStyle: 'quoted',
    special: 'none',
  },
  jsonc: { quote: 'double', keyStyle: 'quoted', special: 'none' },
  json5: {},
};

/** Criterion 4's grids, by tag, then the formats that must cover each value. */
const gridOps = ['add', 'replace', 'remove', 'move', 'copy', 'test', 'test-fail'];
const commentFormats: GoldenFormat[] = ['jsonc', 'json5'];

export function tagErrors(c: Pick<GoldenCase, 'format' | 'tags'>): string[] {
  const errors: string[] = [];
  const tags: Record<string, unknown> = c.tags;
  for (const key of Object.keys(tags)) {
    if (!(tagNames as string[]).includes(key)) errors.push(`unknown tag "${key}"`);
  }
  for (const name of tagNames) {
    const value = tags[name];
    if (value === undefined) {
      errors.push(`missing tag "${name}"`);
    } else if (typeof value !== 'string' || !tagValues[name].includes(value)) {
      errors.push(`tag "${name}" has unknown value ${JSON.stringify(value)}`);
    } else {
      const fixed = fixedTags[c.format][name];
      if (fixed !== undefined && value !== fixed) {
        errors.push(`tag "${name}" must be "${fixed}" in ${c.format} (got "${value}")`);
      }
    }
  }
  return errors;
}

/** Every cell of criterion 4 that no case of `format` covers, as readable labels. */
export function missingCells(
  cases: Pick<GoldenCase, 'format' | 'tags'>[],
  format: GoldenFormat,
): string[] {
  const own = cases
    .filter((c) => c.format === format)
    .map((c) => c.tags as Record<string, unknown>);
  const has = (cell: Partial<Record<TagName, string>>) =>
    own.some((tags) => Object.entries(cell).every(([name, value]) => tags[name] === value));
  const cells: Partial<Record<TagName, string>>[] = [];

  for (const op of gridOps) {
    // `document` (R15) is outside criterion 4's location grid.
    for (const location of tagValues.location.filter((l) => l !== 'document'))
      cells.push({ op, location });
  }
  if (commentFormats.includes(format)) {
    for (const op of gridOps) {
      // `leading` (UNK-021) is outside criterion 4's comments grid.
      for (const comments of tagValues.comments.filter((c) => c !== 'leading'))
        cells.push({ op, comments });
    }
    for (const trailingComma of tagValues.trailingComma) cells.push({ trailingComma });
  }
  if (format === 'json5') {
    for (const quote of tagValues.quote) cells.push({ quote });
    for (const keyStyle of tagValues.keyStyle) cells.push({ keyStyle });
    for (const special of tagValues.special.filter((s) => s !== 'none')) cells.push({ special });
  }

  return cells
    .filter((cell) => !has(cell))
    .map((cell) =>
      Object.entries(cell)
        .map(([name, value]) => `${name}=${value}`)
        .join(' × '),
    );
}
