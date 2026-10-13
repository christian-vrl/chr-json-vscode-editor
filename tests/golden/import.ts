// Import corpus (spec 017, 017 T1). Each case is a folder tests/golden/import/<kind>/<name>/
// holding input.<kind> (`input.yaml`, `input.toml`, `input.xml`), case.json and either
// expected.json with warnings.json, or error.json. Criterion 1 (017 T2): the output text of
// `importData(input, kind).data` is byte-equal to expected.json and `warnings` equals
// warnings.json, or the error equals error.json. case.json holds the tags of criterion 2:
// `rules` (A1–A6 and the kind's own rules) and `tags`. The vocabulary is `import` in tags.json.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import vocabulary from './tags.json' with { type: 'json' };
import { goldenRoot } from './load.js';

export const importRoot = path.join(goldenRoot, 'import');
export const importKinds = ['yaml', 'toml', 'xml'] as const;
export type ImportKind = (typeof importKinds)[number];

type ByKind = Readonly<Record<'all' | ImportKind, readonly string[]>>;
export const importRules: ByKind = vocabulary.import.rules;
export const importTags: ByKind = vocabulary.import.tags;
/** Tags criterion 2 asks for once per kind named, rather than once in the corpus. */
export const importPerKind: Readonly<Record<string, readonly string[]>> = vocabulary.import.perKind;

/** The messages the rules fix word for word (spec 017 A1, A5, Y6). */
export const ruleMessages = {
  A1: 'Only UTF-8 files can be converted',
  A5: 'The file is nested too deeply to convert (more than 1,000 levels)',
  Y6: "The YAML file's aliases expand too far",
} as const;

export interface ImportWarning {
  message: string;
  /** 1-based line of the input. */
  line: number;
}

export interface ImportError {
  /** Left out when the text is the parser's own (Y8, TM5, XM8); see the README's readings. */
  message?: string;
  line: number;
  /** 1-based; left out when no parser reports one. */
  column?: number;
}

export interface ImportTags {
  rules: string[];
  tags: string[];
}

export interface ImportCase {
  kind: ImportKind;
  name: string;
  /** input.<kind>, byte for byte. */
  bytes: Uint8Array;
  /** The text `importData` is given: `bytes` decoded as UTF-8 with the BOM kept and each invalid
   *  byte as U+FFFD (README, reading 1). */
  input: string;
  tags: ImportTags;
  /** expected.json, read unchanged; absent when the case expects an error. */
  expected?: string;
  warnings?: ImportWarning[];
  error?: ImportError;
}

/** How a case's bytes become the text `importData` reads (README, reading 1). */
export function decodeInput(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
}

/**
 * Loads every case, kind by kind (yaml, toml, xml), each kind sorted by name. Throws on a malformed
 * case, on an entry under `root` other than README.md and the kind folders, and on a file directly
 * inside a kind folder (cases are folders).
 */
export function loadImportCases(root: string = importRoot): ImportCase[] {
  const entries = readdirSync(root, { withFileTypes: true });
  const unknown = entries
    .filter((entry) =>
      entry.isDirectory()
        ? !(importKinds as readonly string[]).includes(entry.name)
        : entry.name !== 'README.md',
    )
    .map((entry) => entry.name)
    .sort();
  if (unknown.length > 0) {
    throw new Error(
      `import corpus: unknown entry ${unknown.join(', ')} (kinds: ${importKinds.join(', ')})`,
    );
  }
  return importKinds
    .filter((kind) => entries.some((entry) => entry.isDirectory() && entry.name === kind))
    .flatMap((kind) => {
      const dir = path.join(root, kind);
      const cases = readdirSync(dir, { withFileTypes: true });
      const stray = cases.filter((entry) => !entry.isDirectory()).map((entry) => entry.name);
      if (stray.length > 0) {
        throw new Error(`import corpus: ${kind}/ holds files outside a case: ${stray.join(', ')}`);
      }
      return cases
        .map((entry) => entry.name)
        .sort()
        .map((name) => loadCase(path.join(dir, name), kind, name));
    });
}

function loadCase(dir: string, kind: ImportKind, name: string): ImportCase {
  const where = `import case ${kind}/${name}`;
  const input = `input.${kind}`;
  const ok = ['expected.json', 'warnings.json'];
  const files = readdirSync(dir);
  const extra = files
    .filter((file) => ![input, 'case.json', 'error.json', ...ok].includes(file))
    .sort();
  if (extra.length > 0) throw new Error(`${where}: unexpected file ${extra.join(', ')}`);
  const hasError = files.includes('error.json');
  const missing = ok.filter((file) => !files.includes(file));
  if (hasError ? missing.length < ok.length : missing.length > 0) {
    throw new Error(`${where}: needs expected.json and warnings.json, or error.json, but not both`);
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(readFileSync(path.join(dir, input)));
  } catch (error) {
    throw new Error(`${where}: cannot read ${input}`, { cause: error });
  }
  const tags = readJson(dir, 'case.json', where);
  if (!isObject(tags)) throw new Error(`${where}: case.json must be an object`);
  const base = {
    kind,
    name,
    bytes,
    input: decodeInput(bytes),
    tags: tags as unknown as ImportTags,
  };

  if (hasError) {
    const error = readJson(dir, 'error.json', where);
    if (!isError(error)) {
      throw new Error(
        `${where}: error.json must be {"message"?, "line", "column"?} with a 1-based line and column`,
      );
    }
    return { ...base, error };
  }
  const warnings = readJson(dir, 'warnings.json', where);
  if (!Array.isArray(warnings) || !warnings.every(isWarning)) {
    throw new Error(`${where}: warnings.json must be an array of {"message", "line"}`);
  }
  const expected = readText(dir, 'expected.json', where);
  try {
    JSON.parse(expected);
  } catch (error) {
    throw new Error(`${where}: expected.json is not valid JSON`, { cause: error });
  }
  return { ...base, expected, warnings };
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

const isPositive = (value: unknown): boolean => Number.isInteger(value) && (value as number) >= 1;

function isWarning(value: unknown): value is ImportWarning {
  return (
    isObject(value) &&
    Object.keys(value).sort().join() === 'line,message' &&
    typeof value.message === 'string' &&
    value.message !== '' &&
    isPositive(value.line)
  );
}

function isError(value: unknown): value is ImportError {
  if (!isObject(value) || !isPositive(value.line)) return false;
  if (!Object.keys(value).every((key) => ['message', 'line', 'column'].includes(key))) return false;
  if ('message' in value && (typeof value.message !== 'string' || value.message === '')) {
    return false;
  }
  return !('column' in value) || isPositive(value.column);
}

/** The rules or tags a case of `kind` may carry: the shared ones, then the kind's own. */
function allowed(byKind: ByKind, kind: ImportKind): readonly string[] {
  return [...byKind.all, ...byKind[kind]];
}

/** Tags of `c` that are missing, unknown or belong to another kind, as readable messages. */
export function importTagErrors(c: Pick<ImportCase, 'kind' | 'tags'>): string[] {
  const errors: string[] = [];
  const tags = c.tags as unknown as Record<string, unknown>;
  for (const key of Object.keys(tags)) {
    if (key !== 'rules' && key !== 'tags') errors.push(`unknown tag "${key}"`);
  }
  for (const [name, byKind, required] of [
    ['rules', importRules, true],
    ['tags', importTags, false],
  ] as const) {
    const list = tags[name];
    if (list === undefined) {
      errors.push(`missing tag "${name}"`);
      continue;
    }
    if (!Array.isArray(list) || (required && list.length === 0)) {
      errors.push(`tag "${name}" must be a${required ? ' non-empty' : ''} list`);
      continue;
    }
    for (const value of list) {
      if (typeof value !== 'string' || !allowed(byKind, c.kind).includes(value)) {
        errors.push(`tag "${name}" has value ${JSON.stringify(value)}, unknown for ${c.kind}`);
      }
    }
    if (new Set(list).size !== list.length) errors.push(`tag "${name}" repeats a value`);
  }
  return errors;
}

/**
 * Every cell of criterion 2 that no case covers, as readable labels: each rule, each tag, and the
 * tags asked for once per kind (`too-deep`, `malformed`, `big-decimal`) for each of their kinds.
 */
export function importMissingCells(cases: Pick<ImportCase, 'kind' | 'tags'>[]): string[] {
  const has = (c: Pick<ImportCase, 'tags'>, name: 'rules' | 'tags', value: string) =>
    Array.isArray(c.tags[name]) && c.tags[name].includes(value);
  const missing: string[] = [];
  const rules = [...importRules.all, ...importKinds.flatMap((kind) => importRules[kind])];
  for (const rule of rules) if (!cases.some((c) => has(c, 'rules', rule))) missing.push(rule);
  const tags = [...importTags.all, ...importKinds.flatMap((kind) => importTags[kind])];
  for (const tag of tags) {
    const kinds = importPerKind[tag];
    if (kinds === undefined) {
      if (!cases.some((c) => has(c, 'tags', tag))) missing.push(tag);
      continue;
    }
    for (const kind of kinds) {
      if (!cases.some((c) => c.kind === kind && has(c, 'tags', tag))) {
        missing.push(`${tag} (${kind})`);
      }
    }
  }
  return missing;
}

/** The four TOML date and time kinds of TM4, as `TomlDate.toISOString()` writes each. */
export const tomlDateForms: Readonly<Record<string, RegExp>> = {
  'offset date-time': /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}(?:Z|[+-]\d\d:\d\d)$/,
  'local date-time': /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}$/,
  'local date': /^\d{4}-\d\d-\d\d$/,
  'local time': /^\d\d:\d\d:\d\d\.\d{3}$/,
};

const token =
  /\s*("(?:[^"\\]|\\.)*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?|true|false|null|[{}[\]:,])/y;

/** The tokens of a JSON text, numbers as written. Throws on anything else. */
export function jsonTokens(text: string): string[] {
  const tokens: string[] = [];
  token.lastIndex = 0;
  while (text.slice(token.lastIndex).trim() !== '') {
    const at = token.lastIndex;
    const match = token.exec(text);
    if (match === null) {
      throw new Error(`not a JSON token at ${JSON.stringify(text.slice(at, at + 20))}`);
    }
    tokens.push(match[1]!);
  }
  return tokens;
}

/**
 * `text` laid out as the output text (spec 017 §Terms: `stringify` with 2-space indent, `\n`, a
 * final newline), keeping every number token as written and writing strings as `JSON.stringify`.
 * A hand-written expected.json is in the output style when this returns it unchanged.
 */
export function outputLayout(text: string): string {
  JSON.parse(text);
  const tokens = jsonTokens(text);
  let i = 0;
  const value = (indent: string): string => {
    const t = tokens[i++]!;
    if (t === '{' || t === '[') {
      const close = t === '{' ? '}' : ']';
      if (tokens[i] === close) {
        i++;
        return t + close;
      }
      const members: string[] = [];
      for (let sep = ','; sep === ','; sep = tokens[i++]!) {
        const key = t === '{' ? `${JSON.stringify(JSON.parse(tokens[i]!))}: ` : '';
        if (t === '{') i += 2;
        members.push(`${indent}  ${key}${value(indent + '  ')}`);
      }
      return `${t}\n${members.join(',\n')}\n${indent}${close}`;
    }
    return t.startsWith('"') ? JSON.stringify(JSON.parse(t)) : t;
  };
  return value('') + '\n';
}

/** Significant digits of a decimal number text: no sign, point, exponent or outer zeros. */
function significantDigits(text: string): string {
  return text
    .replace(/^[-+]/, '')
    .replace(/[eE].*$/, '')
    .replace('.', '')
    .replace(/^0+/, '')
    .replace(/0+$/, '');
}

/**
 * Whether a number token is a big number (spec 015 §Terms): lossless-json 4.3.1's
 * `isSafeNumber(text)` is false. Restated from its source (`lib/esm/utils.js`): an integer is safe
 * when `Number.isSafeInteger`; any other number when its significant digits equal those of
 * `String(Number(text))`, so overflow to Infinity and underflow to 0 are big. The root workspace
 * does not depend on lossless-json (core gains it in 015 T2), hence the restatement.
 */
export function isBigNumber(text: string): boolean {
  if (/^-?\d+$/.test(text)) return !Number.isSafeInteger(Number.parseInt(text, 10));
  return significantDigits(text) !== significantDigits(String(Number(text)));
}

/** Whether `stringify` writes a number token this way (002 R8 and spec 015 B2): as
 *  `JSON.stringify` does, `-0` as `-0`, and a big number as its decimal text. */
export function isOutputNumber(text: string): boolean {
  return text === '-0' || JSON.stringify(Number(text)) === text || isBigNumber(text);
}
