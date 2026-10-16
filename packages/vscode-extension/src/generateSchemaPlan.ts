// What "Generate JSON Schema" (spec 016 T3, criteria 5–7) writes and says, as pure functions with
// no `vscode` import so unit tests can call them; generateSchemaCommand.ts binds them to VS Code.
// The schema itself is core's `generateSchema` (016 T1), in the dialect UNK-069 picked.
import {
  generateSchema,
  parseData,
  SchemaTooDeepError,
  type Format,
  type GeneratedSchemaDialect,
} from '@chr-json-editor/core';
import { FORMAT_LABELS } from './convertPlan';

/** UNK-069 ★: the command writes draft-07. */
export const COMMAND_DIALECT = 'draft-07' satisfies GeneratedSchemaDialect;

const BOM = '﻿';

/** What generating a schema from a document's text gives. */
export type SchemaPlan =
  | {
      kind: 'schema';
      /** The schema file (spec 016 §Terms): `JSON.stringify(schema, null, indent)` and a final
       *  `\n`, `indent` being spec 019 I1's (2 by default). */
      text: string;
      /** The data's own top-level `$schema` member, what spec 004's resolver reads first. */
      documentSchema: unknown;
    }
  /** No source data: the offset of the first error in the document's text (criterion 6). */
  | { kind: 'broken'; offset: number }
  /** G9: nested more than 1,000 levels. */
  | { kind: 'too-deep'; message: string };

/**
 * The schema file for `text` read as `format`. A leading byte order mark is the file's encoding
 * mark, not content, as for the convert commands; a JSON Lines document gives the schema of one
 * line (G8). `indent` is the schema file's indent unit (spec 019 I1: VS Code's for JSON).
 */
export function planSchema(text: string, format: Format, indent: '\t' | number = 2): SchemaPlan {
  const shift = text.startsWith(BOM) ? 1 : 0;
  const parsed = parseData(format, text.slice(shift));
  if ('error' in parsed) return { kind: 'broken', offset: parsed.error.offset + shift };
  try {
    const schema = generateSchema(parsed.data, COMMAND_DIALECT, { lines: format === 'jsonl' });
    const { data } = parsed;
    const documentSchema =
      format !== 'jsonl' && typeof data === 'object' && data !== null && !Array.isArray(data)
        ? (Object.getOwnPropertyDescriptor(data, '$schema')?.value as unknown)
        : undefined;
    return { kind: 'schema', text: `${JSON.stringify(schema, null, indent)}\n`, documentSchema };
  } catch (error) {
    if (!(error instanceof SchemaTooDeepError)) throw error;
    return { kind: 'too-deep', message: error.message };
  }
}

/** The schema file's name: `base` with its last extension replaced by `.schema.json`
 *  (`data.json5` → `data.schema.json`, criterion 5). */
export function schemaName(base: string): string {
  const dot = base.lastIndexOf('.');
  return `${dot > 0 ? base.slice(0, dot) : base}.schema.json`;
}

/** Criterion 6: why a broken document gives no schema. `line` and `column` count from 1. A JSON
 *  Lines document names "Repair Lines", the repair its tab offers (spec 012 criterion 9). */
export function brokenSchemaMessage(format: Format, line: number, column: number): string {
  return (
    "CHR JSON Editor: can't generate a JSON Schema: the document is not valid " +
    `${FORMAT_LABELS[format]} (error at line ${line}, column ${column}). ` +
    `Fix it or run "${format === 'jsonl' ? 'Repair Lines' : 'Repair JSON'}" first.`
  );
}

/** Criterion 9: the progress notification's title above spec 008's threshold. */
export const GENERATING_TITLE = 'Generating JSON Schema…';

/** Criterion 7's notification. */
export function generatedMessage(schemaFile: string, source: string): string {
  return `Generated ${schemaFile} from ${source}.`;
}

/** Criterion 7's button. */
export function linkButton(source: string): string {
  return `Use for ${source}`;
}

/** A `json.schemas` entry: the document and the schema, relative to their workspace folder. */
export interface SchemaLink {
  fileMatch: [string];
  url: string;
}

/**
 * Criterion 7's entry for the document at `documentPath` and the schema at `schemaPath`, both inside
 * the folder at `folderPath` (URI paths, `/`-separated, same scheme and authority):
 * `{"fileMatch": ["/<path>"], "url": "./<schema path>"}`. Undefined when either lies outside the
 * folder (a schema saved elsewhere through the save dialog has no folder-relative `url`).
 */
export function schemaLink(
  folderPath: string,
  documentPath: string,
  schemaPath: string,
): SchemaLink | undefined {
  const root = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;
  if (!documentPath.startsWith(root) || !schemaPath.startsWith(root)) return undefined;
  return {
    fileMatch: [`/${documentPath.slice(root.length)}`],
    url: `./${schemaPath.slice(root.length)}`,
  };
}

/** The folder's `json.schemas` with `link` appended, existing entries kept (criterion 7). A value
 *  that is not an array holds no entries, so the result is `link` alone. */
export function withSchemaLink(existing: unknown, link: SchemaLink): unknown[] {
  return [...(Array.isArray(existing) ? (existing as unknown[]) : []), link];
}
