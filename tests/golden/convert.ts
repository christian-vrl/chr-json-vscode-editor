// Conversion corpus (spec 006, 006 T1). Each case is a folder
// tests/golden/convert/<from>-to-<to>/<name>/ holding input.<from>, expected.<to>, losses.json and
// case.json. A case passes when `convert(input, from, to)` returns `expected` byte for byte and
// `losses` equal to losses.json (criterion 1). case.json holds the tags of criterion 2: `rules`,
// the C rules that rewrite bytes in the case (`["C7"]` for a superset pair, which rewrites none),
// and `location`, the container those bytes are in. The vocabulary is `convert` in tags.json.
// Spec 012 (012 T1) adds the JSON Lines pairs (J1, J2) and cases that hold error.json, the
// `ConvertError` message, instead of expected.<to> and losses.json.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import vocabulary from './tags.json' with { type: 'json' };
import { goldenRoot, type GoldenFormat } from './load.js';

/** A conversion's source or target: the three formats of spec 002, and JSON Lines (spec 012). */
export type ConvertFormat = GoldenFormat | 'jsonl';

export const convertRoot = path.join(goldenRoot, 'convert');
export const convertPairs: readonly string[] = vocabulary.convert.pairs;
export const convertRules: readonly string[] = vocabulary.convert.rules;
export const convertLocations: readonly string[] = vocabulary.convert.location;

export interface Loss {
  kind: 'comment' | 'value';
  /** UTF-16 offset of the lost token in the input. */
  offset: number;
  length: number;
  /** JSON Pointer of a value loss. */
  path?: string;
}

export interface ConvertTags {
  rules: string[];
  location: string;
}

export interface ConvertCase {
  pair: string;
  from: ConvertFormat;
  to: ConvertFormat;
  name: string;
  input: string;
  /** expected.<to>, read unchanged; absent when the case expects an error. */
  expected?: string;
  /** losses.json; absent when the case expects an error. */
  losses?: Loss[];
  /** error.json: `convert` throws a `ConvertError` with this message (spec 012 criterion 9). */
  error?: { message: string };
  tags: ConvertTags;
}

/** Pairs whose target holds everything the source can: `convert` returns the input (criterion 3). */
export const supersetPairs: readonly string[] = [
  'json-to-jsonc',
  'json-to-json5',
  'jsonc-to-json5',
];

/** Pairs with JSON Lines on one side (spec 012 J1, J2). */
export const jsonlPairs: readonly string[] = [
  'jsonl-to-json',
  'jsonl-to-jsonc',
  'jsonl-to-json5',
  'json-to-jsonl',
  'jsonc-to-jsonl',
  'json5-to-jsonl',
];

/** Criterion 2: the rules that rewrite bytes in each pair. Each must have a case in that pair, and
 *  no case may tag a rule its pair does not have. A superset pair has only C7. J2 converts to `json`
 *  first (spec 012 J2), so a pair to JSON Lines has the rules of its source's pair to `json`. */
export const pairRules: Record<string, readonly string[]> = {
  'json5-to-json': ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'],
  'json5-to-jsonc': ['C1', 'C2', 'C3', 'C4', 'C6'],
  'jsonc-to-json': ['C5', 'C6'],
  'json-to-jsonc': ['C7'],
  'json-to-json5': ['C7'],
  'jsonc-to-json5': ['C7'],
  'jsonl-to-json': ['J1'],
  'jsonl-to-jsonc': ['J1'],
  'jsonl-to-json5': ['J1'],
  'json-to-jsonl': ['J2'],
  'jsonc-to-jsonl': ['J2', 'C5', 'C6'],
  'json5-to-jsonl': ['J2', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6'],
};

/** Criterion 2: rules that need one case per `location` in each pair that has them. Spec 006's six
 *  pairs only: J2 reuses 006's conversion, whose locations those pairs cover. */
export const locationRules: readonly string[] = ['C1', 'C3', 'C4', 'C5'];

export function pairFormats(pair: string): { from: ConvertFormat; to: ConvertFormat } {
  const [from, to] = pair.split('-to-') as [ConvertFormat, ConvertFormat];
  return { from, to };
}

/**
 * Loads every case under `root`, sorted by pair then name. Throws on a malformed case, on a folder
 * that is not a pair (a misspelled pair would otherwise be skipped), and on a file directly inside
 * `root` or a pair folder (cases are folders).
 */
export function loadConvertCases(root: string = convertRoot): ConvertCase[] {
  const entries = readdirSync(root, { withFileTypes: true });
  const unknown = entries
    .filter((entry) => !entry.isDirectory() || !convertPairs.includes(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (unknown.length > 0) {
    throw new Error(
      `conversion corpus: unknown entry ${unknown.join(', ')} (pairs: ${convertPairs.join(', ')})`,
    );
  }
  return convertPairs
    .filter((pair) => entries.some((entry) => entry.name === pair))
    .flatMap((pair) => {
      const pairDir = path.join(root, pair);
      const cases = readdirSync(pairDir, { withFileTypes: true });
      const stray = cases.filter((entry) => !entry.isDirectory()).map((entry) => entry.name);
      if (stray.length > 0) {
        throw new Error(
          `conversion corpus: ${pair}/ holds files outside a case: ${stray.join(', ')}`,
        );
      }
      return cases
        .map((entry) => entry.name)
        .sort()
        .map((name) => loadCase(path.join(pairDir, name), pair, name));
    });
}

function loadCase(dir: string, pair: string, name: string): ConvertCase {
  const where = `conversion case ${pair}/${name}`;
  const { from, to } = pairFormats(pair);
  const tags = readJson(dir, 'case.json', where);
  if (!isObject(tags)) throw new Error(`${where}: case.json must be an object`);
  const input = readText(dir, `input.${from}`, where);
  if (existsSync(path.join(dir, 'error.json'))) {
    if (existsSync(path.join(dir, `expected.${to}`)) || existsSync(path.join(dir, 'losses.json'))) {
      throw new Error(`${where}: holds error.json and expected.${to} or losses.json`);
    }
    const error = readJson(dir, 'error.json', where);
    if (!isObject(error) || typeof error.message !== 'string' || Object.keys(error).length !== 1) {
      throw new Error(`${where}: error.json must be {"message": "..."}`);
    }
    return { pair, from, to, name, input, error: { message: error.message }, tags: tags as never };
  }
  const losses = readJson(dir, 'losses.json', where);
  if (!Array.isArray(losses) || !losses.every(isLoss)) {
    throw new Error(
      `${where}: losses.json must be an array of {kind, offset, length, path?}, with a path on value losses only`,
    );
  }
  return {
    pair,
    from,
    to,
    name,
    input,
    expected: readText(dir, `expected.${to}`, where),
    losses,
    tags: tags as unknown as ConvertTags,
  };
}

function readText(dir: string, file: string, where: string): string {
  try {
    return readFileSync(path.join(dir, file), 'utf8');
  } catch (error) {
    throw new Error(`${where}: cannot read ${file}`, { cause: error });
  }
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

function isLoss(value: unknown): value is Loss {
  if (!isObject(value)) return false;
  const keys = Object.keys(value).sort().join();
  const offsetOk = Number.isInteger(value.offset) && (value.offset as number) >= 0;
  const lengthOk = Number.isInteger(value.length) && (value.length as number) > 0;
  if (!offsetOk || !lengthOk) return false;
  if (value.kind === 'comment') return keys === 'kind,length,offset';
  return (
    value.kind === 'value' && typeof value.path === 'string' && keys === 'kind,length,offset,path'
  );
}

/** Tags of `c` that are missing, unknown or not allowed in its pair, as readable messages. */
export function convertTagErrors(c: Pick<ConvertCase, 'pair' | 'tags'>): string[] {
  const errors: string[] = [];
  const tags = c.tags as unknown as Record<string, unknown>;
  for (const key of Object.keys(tags)) {
    if (key !== 'rules' && key !== 'location') errors.push(`unknown tag "${key}"`);
  }
  const { rules, location } = tags;
  if (rules === undefined) {
    errors.push('missing tag "rules"');
  } else if (!Array.isArray(rules) || rules.length === 0) {
    errors.push('tag "rules" must be a non-empty list');
  } else {
    for (const rule of rules) {
      if (typeof rule !== 'string' || !convertRules.includes(rule)) {
        errors.push(`tag "rules" has unknown value ${JSON.stringify(rule)}`);
      } else if (!pairRules[c.pair]!.includes(rule)) {
        errors.push(`rule ${rule} does not apply to ${c.pair}`);
      }
    }
    if (new Set(rules).size !== rules.length) errors.push('tag "rules" repeats a rule');
  }
  if (location === undefined) {
    errors.push('missing tag "location"');
  } else if (typeof location !== 'string' || !convertLocations.includes(location)) {
    errors.push(`tag "location" has unknown value ${JSON.stringify(location)}`);
  }
  return errors;
}

/** Every cell of criterion 2 that no case of `pair` covers, as readable labels. */
export function convertMissingCells(
  cases: Pick<ConvertCase, 'pair' | 'tags'>[],
  pair: string,
): string[] {
  const own = cases.filter((c) => c.pair === pair).map((c) => c.tags);
  const cells: { rule: string; location?: string }[] = [];
  for (const rule of pairRules[pair]!) {
    cells.push({ rule });
    if (locationRules.includes(rule) && !jsonlPairs.includes(pair)) {
      for (const location of convertLocations) cells.push({ rule, location });
    }
  }
  return cells
    .filter(
      ({ rule, location }) =>
        !own.some(
          (tags) =>
            Array.isArray(tags.rules) &&
            tags.rules.includes(rule) &&
            (location === undefined || tags.location === location),
        ),
    )
    .map(({ rule, location }) => (location ? `${rule} × location=${location}` : rule));
}
