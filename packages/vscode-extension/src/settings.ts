// CHR JSON Editor's settings (spec 019 T1). The keys of `contributes.configuration` under
// `chrJsonEditor.`, and the pure part of the settings reader: given VS Code's `inspect` result for
// each key, `settingsFrom` picks the effective value as VS Code does and reads a value of the wrong
// type or out of range as the default (A6), so a hand-edited settings.json never stops a tab from
// opening. No `vscode` import, so the unit tests run it directly; settingsVscode.ts reads the
// `inspect` results for a document.
import {
  QUERY_LANGUAGE_IDS,
  type EditorSettings,
  type Mode,
} from '@chr-json-editor/app-shell/protocol';
import type { SmartFormatOptions } from '@chr-json-editor/core';
import { thresholdBytes } from './largeFile';

/** What a key holds, as `contributes.configuration` declares it (spec 019 §Settings). */
type Rule =
  | { type: 'string'; enum: readonly string[] }
  | { type: 'integer'; minimum: number; maximum: number }
  | { type: 'boolean' };

/** `language-overridable` keys take `[json]`-style values; `resource` keys do not (VS Code ignores
 *  a language block's value for them, so the reader does too). */
export type SettingScope = 'resource' | 'language-overridable';

interface KeyRule<T> {
  rule: Rule;
  default: T;
  scope: SettingScope;
}

export const MODES = ['tree', 'text', 'table'] as const satisfies readonly Mode[];

/** The query languages of the Transform dialog, by the page's ids (App.svelte `QUERY_LANGUAGES`). */
export const QUERY_LANGUAGES = QUERY_LANGUAGE_IDS;
export type QueryLanguage = (typeof QUERY_LANGUAGES)[number];

/** The section every key is under. */
export const SECTION = 'chrJsonEditor';

/** spec 019 §Settings, by key under `chrJsonEditor.` (package.json carries the same table; the
 *  manifest unit test checks both against the spec). */
export const SETTINGS = {
  defaultMode: {
    rule: { type: 'string', enum: MODES },
    default: 'tree',
    scope: 'language-overridable',
  },
  largeFileThreshold: {
    rule: { type: 'integer', minimum: 1, maximum: 50 },
    default: 5,
    scope: 'resource',
  },
  'smartFormat.maxLineLength': {
    rule: { type: 'integer', minimum: 20, maximum: 1000 },
    default: 120,
    scope: 'language-overridable',
  },
  'transform.defaultQueryLanguage': {
    rule: { type: 'string', enum: QUERY_LANGUAGES },
    default: 'jsonquery',
    scope: 'resource',
  },
  'validation.enable': { rule: { type: 'boolean' }, default: true, scope: 'resource' },
  'table.flattenColumns': { rule: { type: 'boolean' }, default: true, scope: 'resource' },
  escapeControlCharacters: { rule: { type: 'boolean' }, default: false, scope: 'resource' },
  escapeUnicodeCharacters: { rule: { type: 'boolean' }, default: false, scope: 'resource' },
} as const satisfies Record<keyof Omit<Settings, 'indent'>, KeyRule<unknown>>;

export type SettingKey = keyof typeof SETTINGS;

/** Every setting's value for one document, by key under `chrJsonEditor.`. */
export interface Settings {
  defaultMode: Mode;
  /** In MiB. */
  largeFileThreshold: number;
  'smartFormat.maxLineLength': number;
  'transform.defaultQueryLanguage': QueryLanguage;
  'validation.enable': boolean;
  'table.flattenColumns': boolean;
  escapeControlCharacters: boolean;
  escapeUnicodeCharacters: boolean;
  /** I1 (UNK-088 ★): the indent unit of new text, from VS Code's `editor.insertSpaces` and
   *  `editor.tabSize` for the document's language: a tab, or a number of spaces. */
  indent: '\t' | number;
}

/** One key's `inspect` result, as `WorkspaceConfiguration.inspect` gives it (only the fields read
 *  here; `undefined` when VS Code knows no such key). */
export interface Inspected {
  defaultValue?: unknown;
  globalValue?: unknown;
  workspaceValue?: unknown;
  workspaceFolderValue?: unknown;
  defaultLanguageValue?: unknown;
  globalLanguageValue?: unknown;
  workspaceLanguageValue?: unknown;
  workspaceFolderLanguageValue?: unknown;
}

/**
 * The value VS Code gives a key: a language value at any level wins over every plain value ("even
 * if the non-language-specific setting has a narrower scope", VS Code's docs, Language specific
 * editor settings), and within each kind the narrowest level wins: folder, workspace, user, default.
 * Undefined when no level sets it. With `languages` false (a `resource` key) language values are
 * skipped.
 */
export function effectiveValue(inspected: Inspected | undefined, languages = true): unknown {
  if (!inspected) return undefined;
  const order = [
    ...(languages
      ? [
          inspected.workspaceFolderLanguageValue,
          inspected.workspaceLanguageValue,
          inspected.globalLanguageValue,
          inspected.defaultLanguageValue,
        ]
      : []),
    inspected.workspaceFolderValue,
    inspected.workspaceValue,
    inspected.globalValue,
    inspected.defaultValue,
  ];
  return order.find((value) => value !== undefined);
}

/**
 * Whether `value` is valid for `rule` (A6). A string is never a number or a boolean (`"5"`,
 * `"10"`, `"true"`); integers are whole numbers in range (`2.5`, `0`, `51` are not). `1e1` in
 * settings.json is JSON's way of writing the number 10, so it arrives as 10 and is valid: no
 * reader can tell it from `10`. Enum values match exactly (`"TREE"` is not `"tree"`).
 */
export function isValid(rule: Rule, value: unknown): boolean {
  switch (rule.type) {
    case 'string':
      return typeof value === 'string' && rule.enum.includes(value);
    case 'integer':
      return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= rule.minimum &&
        value <= rule.maximum
      );
    case 'boolean':
      return typeof value === 'boolean';
  }
}

/** VS Code's defaults for `editor.tabSize` and `editor.insertSpaces`. */
const EDITOR_TAB_SIZE = 4;
const EDITOR_INSERT_SPACES = true;

/**
 * Every setting for one document from VS Code's `inspect` results: `inspect(key)` for each key under
 * `chrJsonEditor.` and `editor(key)` for `tabSize` and `insertSpaces`, both read for the document's
 * URI and language. A missing, wrong-typed or out-of-range value reads as the default (A6).
 */
export function settingsFrom(
  inspect: (key: SettingKey) => Inspected | undefined,
  editor: (key: 'tabSize' | 'insertSpaces') => Inspected | undefined,
): Settings {
  const settings = {} as Record<SettingKey, unknown>;
  for (const [key, { rule, default: fallback, scope }] of Object.entries(SETTINGS) as [
    SettingKey,
    KeyRule<unknown>,
  ][]) {
    const value = effectiveValue(inspect(key), scope === 'language-overridable');
    settings[key] = isValid(rule, value) ? value : fallback;
  }
  return { ...(settings as Omit<Settings, 'indent'>), indent: indentFrom(editor) };
}

/** I1 (UNK-088 ★): the indent unit of new text from VS Code's `inspect` results for
 *  `editor.insertSpaces` and `editor.tabSize` (read for the document's or the new file's URI and
 *  language): a tab when `insertSpaces` is `false`, else `tabSize` spaces. */
export function indentFrom(
  editor: (key: 'tabSize' | 'insertSpaces') => Inspected | undefined,
): Settings['indent'] {
  const insertSpaces = effectiveValue(editor('insertSpaces'));
  const tabSize = effectiveValue(editor('tabSize'));
  // VS Code clamps `editor.tabSize` to 1–100 (its schema's range); an invalid one reads as 4.
  const spaces = isValid({ type: 'integer', minimum: 1, maximum: 100 }, tabSize)
    ? (tabSize as number)
    : EDITOR_TAB_SIZE;
  return (typeof insertSpaces === 'boolean' ? insertSpaces : EDITOR_INSERT_SPACES) ? spaces : '\t';
}

/** Smart Format's options from a document's settings (F1's line length, I1's indent for a text
 *  with no indentation; A4: the caller reads the settings when the run starts). */
export function smartFormatOptionsFrom(
  settings: Pick<Settings, 'smartFormat.maxLineLength' | 'indent'>,
): SmartFormatOptions {
  return { maxLineLength: settings['smartFormat.maxLineLength'], indent: settings.indent };
}

/** Every setting at its default, VS Code's indentation defaults included. */
export const DEFAULT_SETTINGS: Settings = settingsFrom(
  () => undefined,
  () => undefined,
);

/** M1: the mode a JSON, JSONC or JSON5 tab opens in (a JSON Lines tab opens in Table whatever the
 *  value, spec 012 criterion 6, which the editor provider decides). A large-file tab has no Text
 *  mode, so `"text"` opens it in Tree (spec 008). */
export function openingMode(settings: Pick<Settings, 'defaultMode'>, largeFile: boolean): Mode {
  if (largeFile && settings.defaultMode === 'text') return 'tree';
  return settings.defaultMode;
}

/** The settings the page uses (019 T2), sent in `init` and in `settings` when they change (A2):
 *  T1's threshold in bytes, Q1, D1 and D2. */
export function pageSettings(settings: Settings): EditorSettings {
  return {
    thresholdBytes: thresholdBytes(settings),
    defaultQueryLanguage: settings['transform.defaultQueryLanguage'],
    flattenColumns: settings['table.flattenColumns'],
    escapeControlCharacters: settings.escapeControlCharacters,
    escapeUnicodeCharacters: settings.escapeUnicodeCharacters,
  };
}

/** Whether two page settings differ, so the host sends `settings` only for a change the page
 *  sees. */
export function samePageSettings(a: EditorSettings, b: EditorSettings): boolean {
  return (Object.keys(a) as (keyof EditorSettings)[]).every((key) => a[key] === b[key]);
}
