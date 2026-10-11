// Query corpus (spec 011, 011 T2). Each case is a folder tests/query/<name>/ holding input.json5,
// case.json, query.js and either expected.json5 or error.json. Criterion 1: `runQuery(language,
// data, query)` gives data equal to expected.json5 (key order checked) or a QueryError whose message
// contains error.json's text; for every case without error.json and without a Q2 tag, the reference
// (the library's own `executeQuery`, run here in Node) gives the same data. case.json holds the
// language and the tags of criterion 2; the vocabulary is tags.json.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import JSON5 from 'json5';
import {
  javascriptQueryLanguage,
  lodashQueryLanguage,
  type QueryLanguage,
  type QueryLanguageOptions,
} from 'vanilla-jsoneditor';
import vocabulary from './tags.json' with { type: 'json' };

export const queryRoot = import.meta.dirname;
export const queryLanguages: readonly string[] = vocabulary.languages;
export const queryTags: readonly string[] = vocabulary.tags;
export const q2Tags: readonly string[] = vocabulary.q2;
export const errorTags: readonly string[] = vocabulary.errors;
export const requiredTags: readonly string[] = vocabulary.required;

/** Wizard field of `QueryLanguageOptions` → the tag of criterion 2 it produces. */
export const wizardTags = { filter: 'filter', sort: 'sort', projection: 'pick' } as const;

/** Folders under tests/query/ that are not cases: `sealed/` holds 011 T4's criterion 4 queries. */
export const reservedFolders: readonly string[] = ['sealed'];

const caseFiles = ['case.json', 'input.json5', 'query.js'];
const resultFiles = ['expected.json5', 'error.json'];

export type QueryLanguageId = 'javascript' | 'lodash';

export interface QueryCaseMeta {
  language: QueryLanguageId;
  tags: string[];
  /** JSON Pointer of the selected node the query runs on (`nested-root`); absent: the whole input. */
  path?: string;
  /** The wizard fields; query.js is the library's `createQuery` for them, plus a final newline. */
  wizard?: QueryLanguageOptions;
  /** error.json holds the engine's own wording (QuickJS), which the reference words differently. */
  engineMessage?: boolean;
}

export interface QueryCase {
  name: string;
  meta: QueryCaseMeta;
  /** input.json5, read unchanged. */
  inputText: string;
  /** query.js, read unchanged. */
  query: string;
  /** expected.json5, read unchanged; absent when the case expects an error. */
  expectedText?: string;
  /** error.json's `message`; absent when the case expects data. */
  error?: string;
}

const read = (dir: string, file: string) => readFileSync(path.join(dir, file), 'utf8');

/** Every case folder, sorted by name. Throws on a stray file or a folder missing a file. */
export function loadQueryCases(root: string = queryRoot): QueryCase[] {
  const cases: QueryCase[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (reservedFolders.includes(entry.name)) continue;
    const dir = path.join(root, entry.name);
    const files = readdirSync(dir).sort();
    const results = files.filter((file) => resultFiles.includes(file));
    const missing = caseFiles.filter((file) => !files.includes(file));
    const unknown = files.filter(
      (file) => !caseFiles.includes(file) && !resultFiles.includes(file),
    );
    if (missing.length > 0 || unknown.length > 0 || results.length !== 1) {
      throw new Error(
        `tests/query/${entry.name}: needs ${caseFiles.join(', ')} and one of ` +
          `${resultFiles.join(' or ')}; has ${files.join(', ') || 'nothing'}`,
      );
    }
    const error =
      results[0] === 'error.json'
        ? (JSON.parse(read(dir, 'error.json')) as { message: string }).message
        : undefined;
    cases.push({
      name: entry.name,
      meta: JSON.parse(read(dir, 'case.json')) as QueryCaseMeta,
      inputText: read(dir, 'input.json5'),
      query: read(dir, 'query.js'),
      expectedText: results[0] === 'expected.json5' ? read(dir, 'expected.json5') : undefined,
      error,
    });
  }
  return cases.sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** The value at a JSON Pointer (RFC 6901); throws when it is not there. */
export function pointerGet(data: unknown, pointer: string): unknown {
  if (pointer === '') return data;
  if (!pointer.startsWith('/')) throw new Error(`"${pointer}" is not a JSON Pointer`);
  let value = data;
  for (const raw of pointer.slice(1).split('/')) {
    const key = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) {
      throw new Error(`"${pointer}" is not in the input`);
    }
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** A fresh copy of the data the query gets: input.json5, or the node at `path` (Q1). */
export function caseData(c: QueryCase): unknown {
  return pointerGet(JSON5.parse(c.inputText), c.meta.path ?? '');
}

/** expected.json5's data. JSON5 keeps `-0`, `NaN`, `±Infinity` and `__proto__` as an own key. */
export function caseExpected(c: QueryCase): unknown {
  if (c.expectedText === undefined) throw new Error(`${c.name} expects an error`);
  return JSON5.parse(c.expectedText);
}

/** `isDeepStrictEqual` (which tells `-0` from `0`) plus the same key order in every object. */
export function orderedEqual(a: unknown, b: unknown): boolean {
  if (!isDeepStrictEqual(a, b)) return false;
  if (a === null || typeof a !== 'object') return true;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b as object);
  return (
    keysA.every((key, i) => key === keysB[i]) &&
    keysA.every((key) =>
      orderedEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  );
}

export const libraryLanguages: Readonly<Record<QueryLanguageId, QueryLanguage>> = {
  javascript: javascriptQueryLanguage,
  lodash: lodashQueryLanguage,
};

/** The reference: the library's own `executeQuery` (`new Function`, allowed in Node). */
export function referenceQuery(language: QueryLanguageId, data: unknown, query: string): unknown {
  return libraryLanguages[language].executeQuery(data, query, JSON);
}

/** query.js of a wizard case: the library's `createQuery` text and a final newline. */
export function wizardQuery(c: QueryCase): string {
  if (c.meta.wizard === undefined) throw new Error(`${c.name} has no wizard fields`);
  return libraryLanguages[c.meta.language].createQuery(caseData(c), c.meta.wizard) + '\n';
}

/** What is wrong with a case's name, case.json and result file, as messages; empty when nothing. */
export function caseErrors(c: QueryCase): string[] {
  const errors: string[] = [];
  const { language, tags, path: pointer, wizard, engineMessage } = c.meta;
  const known = ['language', 'tags', 'path', 'wizard', 'engineMessage'];
  for (const key of Object.keys(c.meta)) {
    if (!known.includes(key)) errors.push(`unknown key "${key}"`);
  }
  if (!queryLanguages.includes(language)) {
    errors.push(`unknown language "${String(language)}"`);
  } else if (!c.name.startsWith(`${language}-`)) {
    errors.push(`name must start with "${language}-"`);
  }
  if (!Array.isArray(tags) || tags.length === 0) {
    errors.push('"tags" must be a non-empty list');
    return errors;
  }
  for (const tag of tags) {
    if (!queryTags.includes(tag)) errors.push(`unknown tag "${tag}"`);
  }
  if (new Set(tags).size !== tags.length) errors.push('"tags" repeats a tag');
  if (tags.includes('chain-without-value') && language !== 'lodash') {
    errors.push('"chain-without-value" is a Lodash tag');
  }

  const errorTagsHere = tags.filter((tag) => errorTags.includes(tag));
  if (c.error !== undefined && errorTagsHere.length !== 1) {
    errors.push(`error.json needs exactly one of the tags ${errorTags.join(', ')}`);
  }
  if (c.error === undefined && errorTagsHere.length > 0) {
    errors.push(`tag "${errorTagsHere[0]}" needs error.json`);
  }
  if (c.error !== undefined && (typeof c.error !== 'string' || c.error === '')) {
    errors.push('error.json needs a non-empty "message"');
  }
  if (engineMessage !== undefined && (engineMessage !== true || !tags.includes('syntax-error'))) {
    errors.push('"engineMessage": true is only for syntax-error cases');
  }

  if ((pointer !== undefined) !== tags.includes('nested-root')) {
    errors.push('"path" and the tag "nested-root" go together');
  }

  const wizardFields = Object.keys(wizard ?? {});
  for (const field of wizardFields) {
    if (!(field in wizardTags)) errors.push(`unknown wizard field "${field}"`);
  }
  for (const [field, tag] of Object.entries(wizardTags)) {
    if (wizardFields.includes(field) !== tags.includes(tag)) {
      errors.push(`tag "${tag}" goes with the wizard field "${field}"`);
    }
  }
  return errors;
}

/** Criterion 2's cells no case covers, as "<tag> in <language>". */
export function missingCells(cases: readonly QueryCase[]): string[] {
  const missing: string[] = [];
  for (const language of queryLanguages) {
    for (const tag of requiredTags) {
      if (vocabulary.lodashOnly.includes(tag) && language !== 'lodash') continue;
      const covered = cases.some((c) => c.meta.language === language && c.meta.tags.includes(tag));
      if (!covered) missing.push(`${tag} in ${language}`);
    }
  }
  return missing;
}

/** Whether the case has a Q2 tag, which takes it out of the reference comparison (criterion 1). */
export const hasQ2Tag = (c: QueryCase): boolean => c.meta.tags.some((tag) => q2Tags.includes(tag));
