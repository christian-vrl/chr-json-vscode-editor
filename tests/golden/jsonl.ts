// JSON Lines corpus (spec 012, 012 T1). Each case is a folder tests/golden/jsonl/<name>/ holding
// input.jsonl, case.json and the files of one kind:
// - patch: patch.json (RFC 6902) and either expected.jsonl or error.json (criterion 1, L2–L9);
// - parse: data.json and diagnostics.json (criterion 1, L1);
// - repair: expected.jsonl and unrepaired.json, the result of `repairLines` (L10).
// case.json holds the tags of criterion 2: `rules` (L1–L10), and for a patch case `op` and
// `location`. Line endings, final newline, blank lines, BOM and empty text are read from the input
// (`jsonlFacts`). The vocabulary is `jsonl` in tags.json.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import vocabulary from './tags.json' with { type: 'json' };
import { isBlank, splitLines } from './jsonl-reference.js';
import { goldenRoot, readPatch, type PatchOperation } from './load.js';

export const jsonlRoot = path.join(goldenRoot, 'jsonl');
export const jsonlRules: readonly string[] = vocabulary.jsonl.rules;
export const jsonlOps: readonly string[] = vocabulary.jsonl.op;
export const jsonlLocations: readonly string[] = vocabulary.jsonl.location;

export interface JsonlTags {
  rules: string[];
  op?: string;
  location?: string;
}

export interface JsonlDiagnostic {
  severity: 'error' | 'warning';
  message: string;
  offset: number;
  length: number;
}

interface JsonlCaseBase {
  name: string;
  /** input.jsonl, read unchanged (a leading BOM included). */
  input: string;
  tags: JsonlTags;
}

export interface JsonlPatchCase extends JsonlCaseBase {
  kind: 'patch';
  patch: PatchOperation[];
  /** expected.jsonl; absent when the case expects an error. */
  expected?: string;
  /** error.json: the `PatchError`, with its message where L8 or L9 fixes it. */
  error?: { message?: string };
}

export interface JsonlParseCase extends JsonlCaseBase {
  kind: 'parse';
  data: unknown;
  diagnostics: JsonlDiagnostic[];
}

export interface JsonlRepairCase extends JsonlCaseBase {
  kind: 'repair';
  expected: string;
  /** 1-based numbers of the lines `repairLines` leaves as they are. */
  unrepaired: number[];
}

export type JsonlCase = JsonlPatchCase | JsonlParseCase | JsonlRepairCase;

/** The files of each kind besides input.jsonl and case.json; the first one names the kind. */
const kindFiles = {
  patch: [['patch.json'], ['expected.jsonl', 'error.json']],
  parse: [['data.json'], ['diagnostics.json']],
  repair: [['unrepaired.json'], ['expected.jsonl']],
} as const;

/**
 * Loads every case under `root`, sorted by name. Throws on a malformed case (a missing file, a
 * file no kind has, files of two kinds) and on a file directly inside `root` (cases are folders).
 */
export function loadJsonlCases(root: string = jsonlRoot): JsonlCase[] {
  const entries = readdirSync(root, { withFileTypes: true });
  const stray = entries.filter((entry) => !entry.isDirectory()).map((entry) => entry.name);
  if (stray.length > 0) {
    throw new Error(`JSON Lines corpus: files outside a case: ${stray.sort().join(', ')}`);
  }
  return entries
    .map((entry) => entry.name)
    .sort()
    .map((name) => loadCase(path.join(root, name), name));
}

function loadCase(dir: string, name: string): JsonlCase {
  const where = `JSON Lines case ${name}`;
  const files = readdirSync(dir).sort();
  const kinds = (Object.keys(kindFiles) as (keyof typeof kindFiles)[]).filter((kind) =>
    files.includes(kindFiles[kind][0][0]),
  );
  if (kinds.length !== 1) {
    throw new Error(`${where}: must hold exactly one of patch.json, data.json, unrepaired.json`);
  }
  const kind = kinds[0]!;
  const allowed = ['input.jsonl', 'case.json', ...kindFiles[kind].flat()];
  const unknown = files.filter((file) => !allowed.includes(file));
  if (unknown.length > 0) throw new Error(`${where}: unexpected ${unknown.join(', ')}`);

  const input = readText(dir, 'input.jsonl', where);
  const tags = readJson(dir, 'case.json', where);
  if (!isObject(tags)) throw new Error(`${where}: case.json must be an object`);
  const base = { name, input, tags: tags as unknown as JsonlTags };

  if (kind === 'patch') {
    const patch = readPatch(dir, where);
    if (!Array.isArray(patch) || !patch.every(isPatchOperation)) {
      throw new Error(`${where}: patch.json must be an array of {op, path} operations`);
    }
    if (files.includes('expected.jsonl') === files.includes('error.json')) {
      throw new Error(`${where}: must hold one of expected.jsonl and error.json`);
    }
    if (files.includes('expected.jsonl')) {
      return { kind, ...base, patch, expected: readText(dir, 'expected.jsonl', where) };
    }
    const error = readJson(dir, 'error.json', where);
    const keys = isObject(error) ? Object.keys(error) : [];
    if (
      !isObject(error) ||
      !keys.every((key) => key === 'message') ||
      (keys.length === 1 && typeof error.message !== 'string')
    ) {
      throw new Error(`${where}: error.json must be {} or {"message": "..."}`);
    }
    return { kind, ...base, patch, error: error };
  }
  if (kind === 'parse') {
    const diagnostics = readJson(dir, 'diagnostics.json', where);
    if (!Array.isArray(diagnostics) || !diagnostics.every(isDiagnostic)) {
      throw new Error(
        `${where}: diagnostics.json must be an array of {severity, message, offset, length}`,
      );
    }
    return { kind, ...base, data: readJson(dir, 'data.json', where), diagnostics };
  }
  const unrepaired = readJson(dir, 'unrepaired.json', where);
  if (
    !Array.isArray(unrepaired) ||
    !unrepaired.every((n) => Number.isInteger(n) && (n as number) >= 1)
  ) {
    throw new Error(`${where}: unrepaired.json must be an array of 1-based line numbers`);
  }
  return {
    kind,
    ...base,
    expected: readText(dir, 'expected.jsonl', where),
    unrepaired: unrepaired as number[],
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

function isPatchOperation(value: unknown): value is PatchOperation {
  return isObject(value) && typeof value.op === 'string' && typeof value.path === 'string';
}

function isDiagnostic(value: unknown): value is JsonlDiagnostic {
  return (
    isObject(value) &&
    Object.keys(value).sort().join() === 'length,message,offset,severity' &&
    (value.severity === 'error' || value.severity === 'warning') &&
    typeof value.message === 'string' &&
    Number.isInteger(value.offset) &&
    Number.isInteger(value.length)
  );
}

/** Tags of `c` that are missing, unknown or not allowed for its kind, as readable messages. */
export function jsonlTagErrors(c: Pick<JsonlCase, 'kind' | 'tags'>): string[] {
  const errors: string[] = [];
  const tags = c.tags as unknown as Record<string, unknown>;
  const names = c.kind === 'patch' ? ['rules', 'op', 'location'] : ['rules'];
  for (const key of Object.keys(tags)) {
    if (!names.includes(key)) errors.push(`unknown tag "${key}" for a ${c.kind} case`);
  }
  const { rules } = tags;
  if (rules === undefined) {
    errors.push('missing tag "rules"');
  } else if (!Array.isArray(rules) || rules.length === 0) {
    errors.push('tag "rules" must be a non-empty list');
  } else {
    for (const rule of rules) {
      if (typeof rule !== 'string' || !jsonlRules.includes(rule)) {
        errors.push(`tag "rules" has unknown value ${JSON.stringify(rule)}`);
      }
    }
    if (new Set(rules).size !== rules.length) errors.push('tag "rules" repeats a rule');
    if (c.kind === 'parse' && !rules.includes('L1')) errors.push('a parse case must tag L1');
    if (c.kind === 'repair' && !rules.includes('L10')) errors.push('a repair case must tag L10');
  }
  if (c.kind === 'patch') {
    for (const [name, values] of [
      ['op', jsonlOps],
      ['location', jsonlLocations],
    ] as const) {
      const value = tags[name];
      if (value === undefined) errors.push(`missing tag "${name}"`);
      else if (typeof value !== 'string' || !values.includes(value)) {
        errors.push(`tag "${name}" has unknown value ${JSON.stringify(value)}`);
      }
    }
  }
  return errors;
}

export interface JsonlFacts {
  eol: 'lf' | 'crlf' | 'none';
  finalNewline: boolean;
  /** Where blank lines are relative to the non-blank lines. */
  blank: ('before' | 'between' | 'after')[];
  bom: boolean;
  empty: boolean;
}

/** The text facts criterion 2 counts, read from a case's input. */
export function jsonlFacts(input: string): JsonlFacts {
  const lines = splitLines(input);
  const filled = lines.flatMap((line, index) => (isBlank(line) ? [] : [index]));
  const blank = new Set<JsonlFacts['blank'][number]>();
  lines.forEach((line, index) => {
    if (!isBlank(line) || filled.length === 0) return;
    if (index < filled[0]!) blank.add('before');
    else if (index > filled.at(-1)!) blank.add('after');
    else blank.add('between');
  });
  const first = /\r?\n/.exec(input)?.[0];
  return {
    eol: first === '\r\n' ? 'crlf' : first === '\n' ? 'lf' : 'none',
    finalNewline: input.endsWith('\n'),
    blank: (['before', 'between', 'after'] as const).filter((where) => blank.has(where)),
    bom: input.startsWith('﻿'),
    empty: input === '',
  };
}

/** Every cell of criterion 2 that no case covers, as readable labels. */
export function jsonlMissingCells(cases: Pick<JsonlCase, 'kind' | 'tags' | 'input'>[]): string[] {
  const missing: string[] = [];
  const tagged = (rule: string) =>
    cases.some((c) => Array.isArray(c.tags.rules) && c.tags.rules.includes(rule));
  for (const rule of jsonlRules) if (!tagged(rule)) missing.push(`rule ${rule}`);
  const patches = cases.filter((c) => c.kind === 'patch');
  for (const op of jsonlOps) {
    for (const location of ['item', 'nested']) {
      if (!patches.some((c) => c.tags.op === op && c.tags.location === location)) {
        missing.push(`op ${op} × location ${location}`);
      }
    }
  }
  const facts = cases.map((c) => jsonlFacts(c.input));
  const cells: [string, (f: JsonlFacts) => boolean][] = [
    ['line ending LF', (f) => f.eol === 'lf'],
    ['line ending CRLF', (f) => f.eol === 'crlf'],
    ['final newline', (f) => !f.empty && f.finalNewline],
    ['no final newline', (f) => !f.empty && !f.finalNewline],
    ['blank lines before items', (f) => f.blank.includes('before')],
    ['blank lines between items', (f) => f.blank.includes('between')],
    ['blank lines after items', (f) => f.blank.includes('after')],
    ['BOM', (f) => f.bom],
    ['empty text', (f) => f.empty],
  ];
  for (const [label, holds] of cells) if (!facts.some(holds)) missing.push(label);
  return missing;
}
