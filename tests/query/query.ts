// Query corpus (spec 011, 011 T2; spec 014, 014 T1). Each case is a folder tests/query/<name>/
// holding input.json5, case.json, the query (query.js, or query.jsonpath for JSONPath (RFC 9535)) and
// either expected.json5 or error.json. Criterion 1: `runQuery(language,
// data, query)` gives data equal to expected.json5 (key order checked) or a QueryError whose message
// contains error.json's text; for every case without error.json and without a Q2 tag, the reference
// (the library's own `executeQuery`, run here in Node) gives the same data. case.json holds the
// language and the tags of criterion 2 (014: criterion 3); the vocabulary is tags.json. The vendored
// JSONPath compliance test suite sits in jsonpath-cts/ (014 criterion 1).
//
// Spec 015 (015 T5) adds big-number cases, tagged `big-*`, in every language: criterion 8's for the
// library languages (JSONQuery, JMESPath, JSONPath (Goessner) and RFC 9535, each with its own query
// file) and criterion 9's for JavaScript and Lodash. Their input.json5 and expected.json5 are read
// with core's JSON5 reader, so big numbers are `LosslessNumber`s (spec 015 B1).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import JSON5 from 'json5';
import {
  javascriptQueryLanguage,
  jmespathQueryLanguage,
  jsonpathQueryLanguage,
  jsonQueryLanguage,
  lodashQueryLanguage,
  type QueryLanguage,
  type QueryLanguageOptions,
} from 'vanilla-jsoneditor';
import { getAdapter } from '../../packages/core/src/index.js';
import vocabulary from './tags.json' with { type: 'json' };

export const queryRoot = import.meta.dirname;
export const queryLanguages: readonly string[] = vocabulary.languages;
/** The tags of the JavaScript and Lodash cases (011 criterion 2). */
export const queryTags: readonly string[] = vocabulary.tags;
/** The tags of the JSONPath (RFC 9535) cases, each one required (014 criterion 3). */
export const rfc9535Tags: readonly string[] = vocabulary.rfc9535;
export const q2Tags: readonly string[] = vocabulary.q2;
export const errorTags: readonly string[] = vocabulary.errors;
export const requiredTags: readonly string[] = vocabulary.required;
/** The tags of the JSONQuery and JMESPath cases, each one required (spec 015 criterion 8). */
export const libraryTags: readonly string[] = vocabulary.library;
/** The tags of the JSONPath (Goessner) cases, each one required (spec 015 criterion 8): its results
 *  are always nodes of the input, so it has no aggregate or computed number. */
export const goessnerTags: readonly string[] = vocabulary.goessner;
/** The big-number tags (spec 015 criteria 8 and 9). */
export const bigTags: readonly string[] = vocabulary.big;

/** Wizard field of `QueryLanguageOptions` → the tag of criterion 2 it produces. */
export const wizardTags = { filter: 'filter', sort: 'sort', projection: 'pick' } as const;

/**
 * Folders under tests/query/ that are not cases: `sealed/` holds 011 T4's criterion 4 queries and
 * `jsonpath-cts/` the vendored compliance test suite (014 T1).
 */
export const reservedFolders: readonly string[] = ['sealed', 'jsonpath-cts'];

const resultFiles = ['expected.json5', 'error.json'];

/** The wizard tags of a JSONPath (RFC 9535) case whose `createQuery` refuses its fields (P7). */
export const refusedTags: readonly string[] = ['sort-refused', 'multi-pick-refused'];

export type QuickJsLanguageId = 'javascript' | 'lodash';
/** The languages the library itself runs (spec 015 B7), by their QueryLanguage ids. */
export type LibraryLanguageId = 'jsonquery' | 'jmespath' | 'jsonpath' | 'jsonpath-rfc9535';
export type QueryLanguageId = QuickJsLanguageId | LibraryLanguageId;

const queryFiles: Readonly<Record<QueryLanguageId, string>> = {
  javascript: 'query.js',
  lodash: 'query.js',
  'jsonpath-rfc9535': 'query.jsonpath',
  jsonpath: 'query.jsonpath',
  jsonquery: 'query.jsonquery',
  jmespath: 'query.jmespath',
};

/** The query file of a case in this language. */
export const queryFile = (language: QueryLanguageId): string => queryFiles[language] ?? 'query.js';

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
  /**
   * query.js, read unchanged; or another language's query file without its one final newline (RFC
   * 9535 allows no whitespace after a query); empty in a refused wizard case, which has no query file.
   */
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
    const meta = files.includes('case.json')
      ? (JSON.parse(read(dir, 'case.json')) as QueryCaseMeta)
      : undefined;
    // A refused wizard case (014 P7) has no query: the library's createQuery throws instead.
    const refused =
      meta?.language === 'jsonpath-rfc9535' &&
      Array.isArray(meta.tags) &&
      meta.tags.some((tag) => refusedTags.includes(tag));
    const caseFiles = ['case.json', 'input.json5'];
    if (!refused) caseFiles.push(queryFile(meta?.language ?? 'javascript'));
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
    let query = refused ? '' : read(dir, caseFiles[2]!);
    if (caseFiles[2] !== undefined && caseFiles[2] !== 'query.js') {
      if (!query.endsWith('\n') || /\s$/.test(query.slice(0, -1))) {
        throw new Error(
          `tests/query/${entry.name}: ${caseFiles[2]} must end with exactly one newline and no ` +
            'other whitespace',
        );
      }
      query = query.slice(0, -1);
    }
    const error =
      results[0] === 'error.json'
        ? (JSON.parse(read(dir, 'error.json')) as { message: string }).message
        : undefined;
    cases.push({
      name: entry.name,
      meta: meta!,
      inputText: read(dir, 'input.json5'),
      query,
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

/** Whether the case is a big-number case (spec 015). */
export const hasBigTag = (c: QueryCase): boolean =>
  c.meta.tags.some((tag) => bigTags.includes(tag));

/** A JSON5 text's data: the json5 package's, or core's for a big-number case (big numbers as
 *  `LosslessNumber`s, spec 015 B1). */
function readJson5(c: QueryCase, text: string): unknown {
  if (!hasBigTag(c)) return JSON5.parse(text);
  const { data, diagnostics } = getAdapter('json5').parse(text);
  const error = diagnostics.find((d) => d.severity === 'error');
  if (error) throw new Error(`${c.name}: ${error.message} at ${error.offset}`);
  return data;
}

/** A fresh copy of the data the query gets: input.json5, or the node at `path` (Q1). */
export function caseData(c: QueryCase): unknown {
  return pointerGet(readJson5(c, c.inputText), c.meta.path ?? '');
}

/** expected.json5's data. JSON5 keeps `-0`, `NaN`, `±Infinity` and `__proto__` as an own key. */
export function caseExpected(c: QueryCase): unknown {
  if (c.expectedText === undefined) throw new Error(`${c.name} expects an error`);
  return readJson5(c, c.expectedText);
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

/**
 * The library language whose `createQuery` writes each language's wizard text, and which runs the
 * JSONQuery, JMESPath and JSONPath (Goessner) cases. JSONPath (RFC 9535) reuses the library's
 * JSONPath (Goessner) `createQuery` (014 P7).
 */
export const libraryLanguages: Readonly<Record<QueryLanguageId, QueryLanguage>> = {
  javascript: javascriptQueryLanguage,
  lodash: lodashQueryLanguage,
  'jsonpath-rfc9535': jsonpathQueryLanguage,
  jsonquery: jsonQueryLanguage,
  jmespath: jmespathQueryLanguage,
  jsonpath: jsonpathQueryLanguage,
};

/** Whether the case runs in the sealed engine (JavaScript or Lodash, spec 011). */
export const isQuickJsCase = (c: QueryCase): boolean =>
  c.meta.language === 'javascript' || c.meta.language === 'lodash';

/** Whether the case is a JSONPath (RFC 9535) case (spec 014). */
export const isRfc9535Case = (c: QueryCase): boolean => c.meta.language === 'jsonpath-rfc9535';

/** The JavaScript and Lodash cases (spec 011), typed as such. */
export function quickJsCases(cases: readonly QueryCase[]): (QueryCase & {
  meta: { language: QuickJsLanguageId };
})[] {
  return cases.filter(isQuickJsCase) as (QueryCase & {
    meta: { language: QuickJsLanguageId };
  })[];
}

/** The reference: the library's own `executeQuery` (`new Function`, allowed in Node). */
export function referenceQuery(language: QuickJsLanguageId, data: unknown, query: string): unknown {
  return libraryLanguages[language].executeQuery(data, query, JSON);
}

/** The library's JSONPath (Goessner), jsonpath-plus: what the wizard and `goessner-only` compare with. */
export function goessnerQuery(data: unknown, query: string): unknown {
  return jsonpathQueryLanguage.executeQuery(data, query, JSON);
}

/**
 * The query of a wizard case: the library's `createQuery` text, plus a final newline in query.js
 * (the loader already took query.jsonpath's off).
 */
export function wizardQuery(c: QueryCase): string {
  if (c.meta.wizard === undefined) throw new Error(`${c.name} has no wizard fields`);
  const text = libraryLanguages[c.meta.language].createQuery(caseData(c), c.meta.wizard);
  return isRfc9535Case(c) ? text : text + '\n';
}

/** The message the library's `createQuery` throws for a refused wizard case (014 P7). */
export function wizardRefusal(c: QueryCase): string {
  if (c.meta.wizard === undefined) throw new Error(`${c.name} has no wizard fields`);
  try {
    libraryLanguages[c.meta.language].createQuery(caseData(c), c.meta.wizard);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`${c.name}: createQuery did not refuse the wizard fields`);
}

/** The tags a language's cases may carry. */
export function languageTags(language: QueryLanguageId): readonly string[] {
  if (language === 'jsonpath-rfc9535') return rfc9535Tags;
  if (language === 'jsonquery' || language === 'jmespath') return libraryTags;
  if (language === 'jsonpath') return goessnerTags;
  return queryTags;
}

/** The tags a language needs a case for (011 criterion 2, 014 criterion 3, 015 criteria 8 and 9). */
const languageRequiredTags = (language: QueryLanguageId): readonly string[] =>
  language === 'javascript' || language === 'lodash' ? requiredTags : languageTags(language);

/** What a wizard field gives in a JSONPath (RFC 9535) case (014 P7, criterion 3). */
function rfc9535WizardErrors(wizard: QueryLanguageOptions | undefined, tags: string[]): string[] {
  const errors: string[] = [];
  const paths = wizard?.projection?.paths;
  const expected: [string, boolean, string][] = [
    ['filter', wizard?.filter !== undefined, 'the wizard field "filter"'],
    ['sort-refused', wizard?.sort !== undefined, 'the wizard field "sort"'],
    ['pick', paths?.length === 1, 'a wizard "projection" of one path'],
    ['multi-pick-refused', (paths?.length ?? 0) > 1, 'a wizard "projection" of two or more paths'],
  ];
  for (const [tag, given, field] of expected) {
    if (given !== tags.includes(tag)) errors.push(`tag "${tag}" goes with ${field}`);
  }
  return errors;
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
  const rfc9535 = language === 'jsonpath-rfc9535';
  const quickJs = language === 'javascript' || language === 'lodash';
  const allowed = queryLanguages.includes(language) ? languageTags(language) : queryTags;
  for (const tag of tags) {
    if (!allowed.includes(tag)) {
      errors.push(
        queryLanguages.some((other) => languageTags(other as QueryLanguageId).includes(tag))
          ? `tag "${tag}" is not a ${language} tag`
          : `unknown tag "${tag}"`,
      );
    }
  }
  if (new Set(tags).size !== tags.length) errors.push('"tags" repeats a tag');
  if (tags.includes('chain-without-value') && language !== 'lodash') {
    errors.push('"chain-without-value" is a Lodash tag');
  }

  const languageErrorTags = errorTags.filter((tag) => allowed.includes(tag));
  const errorTagsHere = tags.filter((tag) => errorTags.includes(tag));
  if (c.error !== undefined && errorTagsHere.length !== 1) {
    errors.push(`error.json needs exactly one of the tags ${languageErrorTags.join(', ')}`);
  }
  if (c.error === undefined && errorTagsHere.length > 0) {
    errors.push(`tag "${errorTagsHere[0]}" needs error.json`);
  }
  if (c.error !== undefined && (typeof c.error !== 'string' || c.error === '')) {
    errors.push('error.json needs a non-empty "message"');
  }
  if (
    engineMessage !== undefined &&
    (engineMessage !== true ||
      !(tags.includes('syntax-error') || tags.includes('big-mixed')) ||
      !quickJs)
  ) {
    errors.push(
      '"engineMessage": true is only for JavaScript and Lodash syntax-error and big-mixed cases',
    );
  }

  if ((pointer !== undefined) !== tags.includes('nested-root')) {
    errors.push('"path" and the tag "nested-root" go together');
  }

  const wizardFields = Object.keys(wizard ?? {});
  for (const field of wizardFields) {
    if (!(field in wizardTags)) errors.push(`unknown wizard field "${field}"`);
  }
  if (rfc9535) {
    errors.push(...rfc9535WizardErrors(wizard, tags));
    return errors;
  }
  for (const [field, tag] of Object.entries(wizardTags)) {
    if (wizardFields.includes(field) !== tags.includes(tag)) {
      errors.push(`tag "${tag}" goes with the wizard field "${field}"`);
    }
  }
  return errors;
}

/** Criterion 2's (014: criterion 3's) cells no case covers, as "<tag> in <language>". */
export function missingCells(cases: readonly QueryCase[]): string[] {
  const missing: string[] = [];
  for (const language of queryLanguages) {
    const required = languageRequiredTags(language as QueryLanguageId);
    for (const tag of required) {
      if (vocabulary.lodashOnly.includes(tag) && language !== 'lodash') continue;
      const covered = cases.some((c) => c.meta.language === language && c.meta.tags.includes(tag));
      if (!covered) missing.push(`${tag} in ${language}`);
    }
  }
  return missing;
}

/** Whether the case has a Q2 tag, which takes it out of the reference comparison (criterion 1). */
export const hasQ2Tag = (c: QueryCase): boolean => c.meta.tags.some((tag) => q2Tags.includes(tag));

/** The vendored JSONPath compliance test suite (014 criterion 1), in tests/query/jsonpath-cts/. */
export const ctsRoot = path.join(queryRoot, 'jsonpath-cts');

/** One test of cts.json: a valid selector with its result (or allowed results), or an invalid one. */
export interface CtsTest {
  name: string;
  selector: string;
  document?: unknown;
  result?: unknown[];
  results?: unknown[][];
  result_paths?: string[];
  results_paths?: string[][];
  invalid_selector?: true;
  tags?: string[];
}

/** SOURCE's `key: value` lines: url, commit, file, sha256, tests, license. */
export function ctsSource(root: string = ctsRoot): Record<string, string> {
  const source: Record<string, string> = {};
  for (const line of read(root, 'SOURCE').split('\n')) {
    const match = /^([a-z0-9]+): (.+)$/.exec(line);
    if (match) source[match[1]!] = match[2]!;
  }
  return source;
}

/** cts.json's raw bytes' SHA-256, in hex. */
export const ctsSha256 = (root: string = ctsRoot): string =>
  createHash('sha256')
    .update(readFileSync(path.join(root, 'cts.json')))
    .digest('hex');

/** cts.json's tests, in file order. */
export function loadCtsTests(root: string = ctsRoot): CtsTest[] {
  return (JSON.parse(read(root, 'cts.json')) as { tests: CtsTest[] }).tests;
}
