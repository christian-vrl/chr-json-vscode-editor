// Smart-format corpus (spec 010, 010 T1). Each case is a folder
// tests/golden/smart-format/<format>/<name>/ holding input.<ext>, expected.<ext>, case.json and, for
// a case laid out with another line length than 120 (spec 019 F1, 019 T4), options.json.
// Criterion 1 (010 T2): `smartFormat(input, format, options)` is byte-equal to expected.<ext>. case.json
// holds the tags of criterion 2; the vocabulary is `smartFormat` in tags.json. Inputs and expected
// outputs are read unchanged (a leading BOM included) so tests can compare bytes (D3).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import vocabulary from './tags.json' with { type: 'json' };
import { goldenFormats, goldenRoot, type GoldenFormat } from './load.js';

export const smartFormatRoot = path.join(goldenRoot, 'smart-format');

const tagVocabulary = vocabulary.smartFormat;
export type SmartFormatTag = keyof typeof tagVocabulary;
export const smartFormatTags: Readonly<Record<SmartFormatTag, readonly string[]>> = tagVocabulary;

/** case.json. `trailingComma` is one value; every other tag is a non-empty list. */
export interface SmartFormatTags {
  layout: string[];
  comments: string[];
  trailingComma: string;
  special: string[];
  style: string[];
}

/** options.json: core's `SmartFormatOptions` for the case; `{}` when the case has none. */
export interface SmartFormatCaseOptions {
  maxLineLength?: number;
}

export interface SmartFormatCase {
  format: GoldenFormat;
  name: string;
  /** input.<ext>, read unchanged. */
  input: string;
  /** expected.<ext>, read unchanged. */
  expected: string;
  tags: SmartFormatTags;
  options: SmartFormatCaseOptions;
}

/**
 * Loads every case under `root`, sorted by format then name. Throws on a malformed case, on an
 * entry under `root` that is not a format folder, and on a file directly inside a format folder.
 */
export function loadSmartFormatCases(root: string = smartFormatRoot): SmartFormatCase[] {
  const entries = readdirSync(root, { withFileTypes: true });
  const unknown = entries
    .filter(
      (entry) => !entry.isDirectory() || !(goldenFormats as readonly string[]).includes(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
  if (unknown.length > 0) {
    throw new Error(
      `smart-format corpus: unknown entry ${unknown.join(', ')} (formats: ${goldenFormats.join(', ')})`,
    );
  }
  return goldenFormats
    .filter((format) => entries.some((entry) => entry.name === format))
    .flatMap((format) => {
      const dir = path.join(root, format);
      const cases = readdirSync(dir, { withFileTypes: true });
      const stray = cases.filter((entry) => !entry.isDirectory()).map((entry) => entry.name);
      if (stray.length > 0) {
        throw new Error(
          `smart-format corpus: ${format}/ holds files outside a case: ${stray.join(', ')}`,
        );
      }
      return cases
        .map((entry) => entry.name)
        .sort()
        .map((name) => loadCase(path.join(dir, name), format, name));
    });
}

function loadCase(dir: string, format: GoldenFormat, name: string): SmartFormatCase {
  const where = `smart-format case ${format}/${name}`;
  const required = [`input.${format}`, `expected.${format}`, 'case.json'];
  const files = readdirSync(dir);
  const extra = files.filter((file) => !required.includes(file) && file !== 'options.json').sort();
  if (extra.length > 0) throw new Error(`${where}: unexpected file ${extra.join(', ')}`);
  const missing = required.filter((file) => !files.includes(file));
  if (missing.length > 0) throw new Error(`${where}: missing ${missing.join(', ')}`);
  const tagsText = readText(dir, 'case.json', where);
  let tags: unknown;
  try {
    tags = JSON.parse(tagsText);
  } catch (error) {
    throw new Error(`${where}: case.json is not valid JSON`, { cause: error });
  }
  if (typeof tags !== 'object' || tags === null || Array.isArray(tags)) {
    throw new Error(`${where}: case.json must be an object`);
  }
  return {
    format,
    name,
    input: readText(dir, `input.${format}`, where),
    expected: readText(dir, `expected.${format}`, where),
    tags: tags as SmartFormatTags,
    options: files.includes('options.json') ? readOptions(dir, where) : {},
  };
}

/** options.json: an object whose only member is `maxLineLength`, an integer from 20 to 1000 (the
 *  range of `chrJsonEditor.smartFormat.maxLineLength`, spec 019 §Settings). */
function readOptions(dir: string, where: string): SmartFormatCaseOptions {
  let options: unknown;
  try {
    options = JSON.parse(readText(dir, 'options.json', where));
  } catch (error) {
    throw new Error(`${where}: options.json is not valid JSON`, { cause: error });
  }
  const length = (options as { maxLineLength?: unknown } | null)?.maxLineLength;
  if (
    typeof options !== 'object' ||
    options === null ||
    Array.isArray(options) ||
    Object.keys(options).join() !== 'maxLineLength' ||
    !Number.isInteger(length) ||
    (length as number) < 20 ||
    (length as number) > 1000
  ) {
    throw new Error(`${where}: options.json must be {"maxLineLength": <integer 20-1000>}`);
  }
  return { maxLineLength: length as number };
}

function readText(dir: string, file: string, where: string): string {
  try {
    return readFileSync(path.join(dir, file), 'utf8');
  } catch (error) {
    throw new Error(`${where}: cannot read ${file}`, { cause: error });
  }
}

/** Values of each list tag that only some formats may use (spec 010 criterion 2). */
const formatOnly: Readonly<Record<string, readonly GoldenFormat[]>> = {
  'comments=with-warning': ['json'],
  'comments=before': ['jsonc', 'json5'],
  'comments=after': ['jsonc', 'json5'],
  'comments=inline': ['jsonc', 'json5'],
  'comments=standalone': ['jsonc', 'json5'],
  'comments=multi-line-block': ['jsonc', 'json5'],
  'comments=between-key-and-value': ['jsonc', 'json5'],
  'comments=header': ['jsonc', 'json5'],
  'comments=footer': ['jsonc', 'json5'],
  'trailingComma=yes': ['jsonc', 'json5'],
  'special=unquoted-key': ['json5'],
  'special=single-quote': ['json5'],
  'special=hex': ['json5'],
  'special=infinity-nan': ['json5'],
  'special=plus-sign': ['json5'],
  'special=leading-dot': ['json5'],
  'special=line-continuation': ['json5'],
};

/** The style tags that name the input's indent; a case has exactly one of them. */
export const indentStyles: readonly string[] = [
  'indent-tab',
  'indent-2',
  'indent-4',
  'one-line-input',
];

/** Tags of `c` that are missing, unknown, repeated or not allowed in its format, as messages. */
export function smartFormatTagErrors(c: Pick<SmartFormatCase, 'format' | 'tags'>): string[] {
  const errors: string[] = [];
  const tags = c.tags as unknown as Record<string, unknown>;
  const names = Object.keys(smartFormatTags) as SmartFormatTag[];
  for (const key of Object.keys(tags)) {
    if (!(names as string[]).includes(key)) errors.push(`unknown tag "${key}"`);
  }
  const allowed = (name: string, value: string) => {
    const only = formatOnly[`${name}=${value}`];
    if (only && !only.includes(c.format)) {
      errors.push(`tag "${name}" value "${value}" is not allowed in ${c.format}`);
    }
  };
  for (const name of names) {
    const value = tags[name];
    if (value === undefined) {
      errors.push(`missing tag "${name}"`);
      continue;
    }
    if (name === 'trailingComma') {
      if (typeof value !== 'string' || !smartFormatTags[name].includes(value)) {
        errors.push(`tag "${name}" has unknown value ${JSON.stringify(value)}`);
      } else allowed(name, value);
      continue;
    }
    if (!Array.isArray(value) || value.length === 0) {
      errors.push(`tag "${name}" must be a non-empty list`);
      continue;
    }
    for (const v of value) {
      if (typeof v !== 'string' || !smartFormatTags[name].includes(v)) {
        errors.push(`tag "${name}" has unknown value ${JSON.stringify(v)}`);
      } else allowed(name, v);
    }
    if (new Set(value).size !== value.length) errors.push(`tag "${name}" repeats a value`);
    if (value.includes('none') && value.length > 1) {
      errors.push(`tag "${name}" holds "none" with other values`);
    }
  }
  const style = tags.style;
  if (
    Array.isArray(style) &&
    style.filter((s: unknown) => indentStyles.includes(s as string)).length !== 1
  ) {
    errors.push(`tag "style" needs exactly one of ${indentStyles.join(', ')}`);
  }
  return errors;
}

/** The cells of criterion 2 for `format`, as `<tag>=<value>` labels. */
export function smartFormatCells(format: GoldenFormat): string[] {
  const cells = [
    ...smartFormatTags.layout.map((v) => `layout=${v}`),
    ...smartFormatTags.style.map((v) => `style=${v}`),
    'special=key-order',
  ];
  if (format === 'json') cells.push('comments=with-warning');
  else {
    cells.push(
      ...smartFormatTags.comments
        .filter((v) => v !== 'none' && v !== 'with-warning')
        .map((v) => `comments=${v}`),
      ...smartFormatTags.trailingComma.map((v) => `trailingComma=${v}`),
    );
  }
  if (format === 'json5') {
    cells.push(
      ...smartFormatTags.special
        .filter((v) => v !== 'none' && v !== 'key-order' && v !== 'big-number')
        .map((v) => `special=${v}`),
    );
  }
  return cells;
}

/** Every cell of criterion 2 that no case of `format` covers. */
export function smartFormatMissingCells(
  cases: Pick<SmartFormatCase, 'format' | 'tags'>[],
  format: GoldenFormat,
): string[] {
  const own = cases.filter((c) => c.format === format);
  const covers = (c: Pick<SmartFormatCase, 'tags'>, cell: string) => {
    const [name, value] = cell.split('=') as [SmartFormatTag, string];
    const tag: unknown = c.tags[name];
    return Array.isArray(tag) ? tag.includes(value) : tag === value;
  };
  return smartFormatCells(format).filter((cell) => !own.some((c) => covers(c, cell)));
}
