// Which schema validates a document (004 T5): the association rules of spec 004 criterion 1
// (core's resolveSchemaAssociation, 004 T3) applied to one open document, with the schema loaded
// and handed to its DocumentValidation (validation.ts). The document's top-level `$schema` is read
// from its text, so the binding is refreshed after each change; it only reloads when the answer
// changes. Remote schemas are never fetched (offline, AGENTS.md rule 3).
//
// No `vscode` import, so the unit tests run it directly; editorProvider.ts gives it the document,
// the `json.schemas`/`json5.schemas` levels (schemaSettings.ts) and a way to read a file.
import {
  detect,
  getAdapter,
  resolveSchemaAssociation,
  type Format,
  type SchemaAssociation,
  type SchemaSettingsScope,
} from '@chr-json-editor/core';
import type { SchemaDialect } from '@chr-json-editor/app-shell/protocol';
import { dataOrError } from './largeFile';
import type { DocumentValidation } from './validation';

/** What the binding reads about the document and its settings. */
export interface SchemaSource {
  /** The document's URI in `Uri.toString(true)` spelling, the one the resolver matches. */
  documentUri(): string;
  text(): string;
  /** The format the document is parsed as now (the format badge's choice, 003 T10). */
  format(): Format;
  /** Whether to read the data alone (a locked large-file tab, spec 008); false when absent. */
  dataOnly?(): boolean;
  /** `json.schemas` and `json5.schemas` levels, in VS Code's order (collectSchemaScopes). */
  settings(): { jsonSchemas: SchemaSettingsScope[]; json5Schemas: SchemaSettingsScope[] };
  /** The text of a local schema file (`file:` URI, `toString(true)` spelling). */
  readFile(uri: string): Promise<string>;
}

/** The reason shown when the schema that applies is not local. */
export const REMOTE_SCHEMA_REASON = 'Remote schemas are not loaded (offline)';

export class SchemaBinding {
  /** The association last applied, as a comparable string. */
  private key: string | undefined;
  /** The schema last handed to the validation, for the dialect switch. */
  private schema: object | boolean | undefined;
  /** The user's dialect for a schema without a known `$schema` (UNK-017); reset by a new schema. */
  private dialect: SchemaDialect | undefined;
  /** Bumped by every refresh, so a slow file read for an older answer is dropped. */
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The local file the schema comes from, if any: a change to it reloads the schema. */
  schemaFile: string | undefined;

  constructor(
    private readonly source: SchemaSource,
    private readonly validation: Pick<DocumentValidation, 'setSchema' | 'setUnavailable'>,
    private readonly delayMs = 100,
  ) {}

  /** The association for the document as it is now (criterion 1). */
  associate(): SchemaAssociation {
    const { jsonSchemas, json5Schemas } = this.source.settings();
    return resolveSchemaAssociation({
      documentUri: this.source.documentUri(),
      documentSchema: topLevelSchema(
        this.source.text(),
        this.source.format(),
        this.source.dataOnly?.(),
      ),
      jsonSchemas,
      json5Schemas,
    });
  }

  /** Refreshes after a burst of changes; `reload` also re-reads an unchanged schema file. */
  schedule(reload = false): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(reload), this.delayMs);
  }

  /**
   * Applies the association if it changed (or `reload`). Settles once the schema is handed over;
   * everything but reading a file happens before it returns.
   */
  refresh(reload = false): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    const association = this.associate();
    const key = JSON.stringify(association);
    if (key === this.key && !reload) return Promise.resolve();
    if (key !== this.key) this.dialect = undefined;
    this.key = key;
    const generation = ++this.generation;
    if (association.source === 'none') {
      this.schemaFile = undefined;
      this.apply(undefined);
      return Promise.resolve();
    }
    const { location } = association;
    this.schemaFile = location.kind === 'file' ? location.uri : undefined;
    switch (location.kind) {
      case 'inline':
        this.apply(location.schema as object);
        return Promise.resolve();
      case 'remote':
        this.unavailable(`${REMOTE_SCHEMA_REASON}: ${location.uri}`);
        return Promise.resolve();
      case 'file':
        return this.source.readFile(location.uri).then(
          (text) => {
            if (generation !== this.generation) return;
            const parsed = parseSchema(location.uri, text);
            if (typeof parsed === 'string') this.unavailable(parsed);
            else this.apply(parsed.schema);
          },
          (error: unknown) => {
            if (generation !== this.generation) return;
            const why = error instanceof Error ? error.message : String(error);
            this.unavailable(`The schema ${location.uri} cannot be read: ${why}`);
          },
        );
    }
  }

  /** The user's dialect switch: validates the same schema again as `dialect`. */
  setDialect(dialect: SchemaDialect): void {
    this.dialect = dialect;
    if (this.schema !== undefined) this.validation.setSchema(this.schema, dialect);
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.generation++;
  }

  private apply(schema: object | boolean | undefined): void {
    this.schema = schema;
    this.validation.setSchema(schema, this.dialect);
  }

  private unavailable(reason: string): void {
    this.schema = undefined;
    this.validation.setUnavailable(reason);
  }
}

/** The value of the document's top-level `$schema` member, if the text parses to an object. Core
 *  keeps the parse of the last text, so this shares the parse that the format badge and
 *  validation make of the same text (UNK-014, 004 T5 review F3). With `dataOnly` (a locked
 *  large-file tab, spec 008) it reads core's data-only parse, shared the same way (`dataOf`). */
export function topLevelSchema(text: string, format: Format, dataOnly = false): unknown {
  let data: unknown;
  try {
    if (dataOnly) {
      const read = dataOrError(format, text);
      data = 'data' in read ? read.data : undefined;
    } else data = getAdapter(format).parse(text).data;
  } catch {
    return undefined;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined;
  return Object.hasOwn(data, '$schema') ? (data as { $schema: unknown }).$schema : undefined;
}

/** Parses a schema file in the format its name gives (a schema may be JSONC or JSON5 too). */
export function parseSchema(uri: string, text: string): { schema: object | boolean } | string {
  const path = uri.replace(/[?#].*$/, '');
  const { format } = detect(path, undefined, text);
  let parsed;
  try {
    parsed = getAdapter(format).parse(text);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return `The schema ${uri} does not parse: ${why}`;
  }
  const error = parsed.diagnostics.find((d) => d.severity === 'error');
  if (error || parsed.tree === undefined) {
    return `The schema ${uri} does not parse${error ? `: ${error.message}` : ''}`;
  }
  const schema = parsed.data;
  if (typeof schema === 'boolean' || (typeof schema === 'object' && schema !== null)) {
    if (!Array.isArray(schema)) return { schema };
  }
  return `The schema ${uri} is not a JSON Schema (an object or a boolean)`;
}
