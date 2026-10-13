// CSV corpus (spec 009, 009 T1). Export cases are folders tests/golden/csv/export/<name>/ holding
// input.json, options.json, case.json and either expected.csv or error.json; import cases are
// folders tests/golden/csv/import/<name>/ holding input.csv, options.json, case.json and either
// expected.json with warnings.json, or error.json. Criterion 1: `jsonToCsv(input, options)` gives
// expected.csv byte for byte (or error.json), and `csvToJson(input, options)` gives expected.json
// (deep-equal, key order checked) and warnings.json (or error.json). case.json holds the tags of
// criterion 2; the vocabulary is `csv` in tags.json.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import vocabulary from './tags.json' with { type: 'json' };
import { parseData } from '../../packages/core/src/index.js';
import { goldenRoot } from './load.js';

export const csvRoot = path.join(goldenRoot, 'csv');
export const csvDirections = ['export', 'import'] as const;
export type CsvDirection = (typeof csvDirections)[number];

export const csvRules: Readonly<Record<CsvDirection, readonly string[]>> = vocabulary.csv.rules;
export const csvValues: readonly string[] = vocabulary.csv.values;
export const csvFeatures: readonly string[] = vocabulary.csv.features;
export const csvDelimiters: Readonly<Record<CsvDirection, readonly string[]>> =
  vocabulary.csv.delimiters;

/** §Options of spec 009, as options.json spells them. A key left out takes its default. */
export interface CsvExportOptions {
  delimiter?: ',' | ';' | '\t' | '|';
  header?: boolean;
  flattenObjects?: boolean;
  flattenArrays?: boolean;
  bom?: boolean;
}

export interface CsvImportOptions {
  /** Left out: "Detect" (I3). */
  delimiter?: ',' | ';' | '\t' | '|';
  header?: boolean;
  nestedObjects?: boolean;
}

/** The options of each direction with their defaults (spec 009 §Options). */
export const csvOptionDefaults = {
  export: { delimiter: ',', header: true, flattenObjects: true, flattenArrays: false, bom: false },
  import: { delimiter: 'detect', header: true, nestedObjects: true },
} as const;

export interface CsvMessage {
  message: string;
  /** 1-based line of the input where the record (or the open quote) starts; import only. */
  line?: number;
}

export interface CsvTags {
  rules: string[];
  values?: string[];
  features?: string[];
}

interface CsvCaseBase {
  name: string;
  tags: CsvTags;
  error?: CsvMessage;
}

export interface CsvExportCase extends CsvCaseBase {
  direction: 'export';
  input: unknown;
  options: CsvExportOptions;
  /** expected.csv, read unchanged; absent when the case expects an error. */
  expected?: string;
}

export interface CsvImportCase extends CsvCaseBase {
  direction: 'import';
  /** input.csv, read unchanged (a leading BOM included). */
  input: string;
  options: CsvImportOptions;
  expected?: unknown;
  warnings?: CsvMessage[];
}

export type CsvCase = CsvExportCase | CsvImportCase;

/** The delimiter a case runs with: its option, or the direction's default. */
export function effectiveDelimiter(c: CsvCase): string {
  return c.options.delimiter ?? csvOptionDefaults[c.direction].delimiter;
}

/**
 * Loads every case under `root`, export first, each direction sorted by name. Throws on a malformed
 * case, on an entry under `root` that is not a direction folder, and on a file directly inside a
 * direction folder (cases are folders).
 */
export function loadCsvCases(root: string = csvRoot): CsvCase[] {
  const entries = readdirSync(root, { withFileTypes: true });
  const unknown = entries
    .filter(
      (entry) => !entry.isDirectory() || !(csvDirections as readonly string[]).includes(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
  if (unknown.length > 0) {
    throw new Error(
      `CSV corpus: unknown entry ${unknown.join(', ')} (directions: ${csvDirections.join(', ')})`,
    );
  }
  return csvDirections
    .filter((direction) => entries.some((entry) => entry.name === direction))
    .flatMap((direction) => {
      const dir = path.join(root, direction);
      const cases = readdirSync(dir, { withFileTypes: true });
      const stray = cases.filter((entry) => !entry.isDirectory()).map((entry) => entry.name);
      if (stray.length > 0) {
        throw new Error(
          `CSV corpus: ${direction}/ holds files outside a case: ${stray.join(', ')}`,
        );
      }
      return cases
        .map((entry) => entry.name)
        .sort()
        .map((name) => loadCase(path.join(dir, name), direction, name));
    });
}

const caseFiles: Record<CsvDirection, { input: string; ok: string[] }> = {
  export: { input: 'input.json', ok: ['expected.csv'] },
  import: { input: 'input.csv', ok: ['expected.json', 'warnings.json'] },
};

function loadCase(dir: string, direction: CsvDirection, name: string): CsvCase {
  const where = `CSV case ${direction}/${name}`;
  const { input, ok } = caseFiles[direction];
  const allowed = [input, 'options.json', 'case.json', 'error.json', ...ok];
  const files = readdirSync(dir);
  const extra = files.filter((file) => !allowed.includes(file)).sort();
  if (extra.length > 0) throw new Error(`${where}: unexpected file ${extra.join(', ')}`);
  const hasError = files.includes('error.json');
  const missing = ok.filter((file) => !files.includes(file));
  if (hasError ? missing.length < ok.length : missing.length > 0) {
    throw new Error(`${where}: needs ${ok.join(' and ')}, or error.json, but not both`);
  }

  const options = readJson(dir, 'options.json', where);
  const optionErrors = csvOptionErrors(direction, options);
  if (optionErrors.length > 0) throw new Error(`${where}: options.json ${optionErrors.join('; ')}`);
  const tags = readJson(dir, 'case.json', where);
  if (!isObject(tags)) throw new Error(`${where}: case.json must be an object`);
  let error: CsvMessage | undefined;
  if (hasError) {
    error = readJson(dir, 'error.json', where) as CsvMessage;
    if (!isMessage(error, direction))
      throw new Error(`${where}: error.json ${messageShape(direction)}`);
  }

  if (direction === 'export') {
    return {
      direction,
      name,
      input: readData(dir, input, where),
      options: options as CsvExportOptions,
      tags: tags as unknown as CsvTags,
      ...(hasError ? { error } : { expected: readText(dir, 'expected.csv', where) }),
    };
  }
  let result: Pick<CsvImportCase, 'expected' | 'warnings' | 'error'> = { error };
  if (!hasError) {
    const warnings = readJson(dir, 'warnings.json', where);
    if (!Array.isArray(warnings) || !warnings.every((w) => isMessage(w, direction))) {
      throw new Error(
        `${where}: warnings.json must be an array; each warning ${messageShape(direction)}`,
      );
    }
    result = { expected: readData(dir, 'expected.json', where), warnings };
  }
  return {
    direction,
    name,
    input: readText(dir, input, where),
    options: options as CsvImportOptions,
    tags: tags as unknown as CsvTags,
    ...result,
  };
}

/** What is wrong with an options.json for `direction`, as readable messages. */
export function csvOptionErrors(direction: CsvDirection, options: unknown): string[] {
  if (!isObject(options)) return ['must be an object'];
  const defaults: Record<string, unknown> = csvOptionDefaults[direction];
  const errors: string[] = [];
  for (const [key, value] of Object.entries(options)) {
    if (!(key in defaults)) {
      errors.push(`has unknown option "${key}"`);
    } else if (key === 'delimiter') {
      // "detect" is the import default, written by leaving the option out.
      if (value === 'detect' || !csvDelimiters[direction].includes(value as string)) {
        errors.push(`has unknown delimiter ${JSON.stringify(value)}`);
      }
    } else if (typeof value !== 'boolean') {
      errors.push(`option "${key}" must be true or false`);
    }
  }
  return errors;
}

function messageShape(direction: CsvDirection): string {
  return direction === 'import'
    ? 'must be {"message", "line"} with a 1-based line'
    : 'must be {"message"}';
}

/** Spec 009: a message, and for import a 1-based line number. */
function isMessage(value: unknown, direction: CsvDirection): value is CsvMessage {
  if (!isObject(value) || typeof value.message !== 'string' || value.message === '') return false;
  const keys = Object.keys(value).sort().join();
  if (direction === 'export') return keys === 'message';
  return keys === 'line,message' && Number.isInteger(value.line) && (value.line as number) >= 1;
}

function readText(dir: string, file: string, where: string): string {
  try {
    return readFileSync(path.join(dir, file), 'utf8');
  } catch (error) {
    throw new Error(`${where}: cannot read ${file}`, { cause: error });
  }
}

/** input.json or expected.json, with big numbers as big numbers (spec 015 B1): core's reading of
 *  strict JSON, as the golden loader reads patch.json. */
function readData(dir: string, file: string, where: string): unknown {
  const read = parseData('json', readText(dir, file, where));
  if ('error' in read) throw new Error(`${where}: ${file} is not valid JSON`);
  return read.data;
}

function readJson(dir: string, file: string, where: string): unknown {
  const text = readText(dir, file, where);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${where}: ${file} is not valid JSON`, { cause: error });
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Tags of `c` that are missing, unknown or belong to the other direction, as readable messages. */
export function csvTagErrors(c: Pick<CsvCase, 'direction' | 'tags'>): string[] {
  const errors: string[] = [];
  const tags = c.tags as unknown as Record<string, unknown>;
  const lists: [string, readonly string[], boolean][] = [
    ['rules', csvRules[c.direction], true],
    ['values', csvValues, false],
    ['features', csvFeatures, false],
  ];
  for (const key of Object.keys(tags)) {
    if (!lists.some(([name]) => name === key)) errors.push(`unknown tag "${key}"`);
  }
  for (const [name, known, required] of lists) {
    const list = tags[name];
    if (list === undefined) {
      if (required) errors.push(`missing tag "${name}"`);
      continue;
    }
    if (!Array.isArray(list) || list.length === 0) {
      errors.push(`tag "${name}" must be a non-empty list`);
      continue;
    }
    for (const value of list) {
      if (typeof value !== 'string' || !known.includes(value)) {
        errors.push(`tag "${name}" has unknown value ${JSON.stringify(value)}`);
      }
    }
    if (new Set(list).size !== list.length) errors.push(`tag "${name}" repeats a value`);
  }
  return errors;
}

/**
 * Every cell of criterion 2 that no case of `direction` covers, as readable labels: each rule, each
 * I7 value type, a one-column table with a `null` row, each delimiter (the effective one, so an
 * import case with no delimiter option covers "detect") and the header off.
 */
export function csvMissingCells(cases: CsvCase[], direction: CsvDirection): string[] {
  const own = cases.filter((c) => c.direction === direction);
  const has = (list: string[] | undefined, value: string) =>
    Array.isArray(list) && list.includes(value);
  const cells: [string, (c: CsvCase) => boolean][] = [
    ...csvRules[direction].map((rule): [string, (c: CsvCase) => boolean] => [
      rule,
      (c) => has(c.tags.rules, rule),
    ]),
    ...csvValues.map((value): [string, (c: CsvCase) => boolean] => [
      `value=${value}`,
      (c) => has(c.tags.values, value),
    ]),
    ...csvFeatures.map((feature): [string, (c: CsvCase) => boolean] => [
      feature,
      (c) => has(c.tags.features, feature),
    ]),
    ...csvDelimiters[direction].map((delimiter): [string, (c: CsvCase) => boolean] => [
      `delimiter=${JSON.stringify(delimiter)}`,
      (c) => effectiveDelimiter(c) === delimiter,
    ]),
    ['header=off', (c) => c.options.header === false],
  ];
  return cells.filter(([, covers]) => !own.some(covers)).map(([label]) => label);
}
