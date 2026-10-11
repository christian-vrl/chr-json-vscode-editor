// JSON Schema validation in the extension host (004 T2, ADR-010). Ajv compiles a schema to
// JavaScript with `new Function`, which the webview CSP forbids (spec 003 criterion 6), so it runs
// here in Node and the webview gets the errors as a `validation` message keyed by `docVersion`.
//
// No `vscode` import, so the unit tests run it directly; editorProvider.ts wires it to a document
// and a webview. 004 T4: the dialect comes from the schema's own `$schema` (UNK-017, UNK-031):
// draft-04 runs on `ajv-draft-04`, draft-06 and draft-07 on `Ajv`, 2019-09 and 2020-12 on their own
// Ajv classes; every meta-schema ships inside those packages and so inside this bundle. A missing
// or unknown `$schema` is assumed draft-07; drafts before 04 are not validated. Which schema
// applies to a document is schemaBinding.ts (004 T5, the association rules of 004 T3).
import { getAdapter, type Format } from '@chr-json-editor/core';
import {
  PROTOCOL_VERSION,
  type SchemaDialect,
  type SchemaError,
  type ValidationMessage,
} from '@chr-json-editor/app-shell/protocol';
import Ajv, { MissingRefError } from 'ajv';
import Ajv2019 from 'ajv/dist/2019';
import Ajv2020 from 'ajv/dist/2020';
import draft06MetaSchema from 'ajv/dist/refs/json-schema-draft-06.json';
import AjvDraft04 from 'ajv-draft-04';
import addFormats from 'ajv-formats';
import { dataOrError } from './largeFile';

export type ValidationResult = ValidationMessage['result'];
export type DialectChoice = NonNullable<ValidationMessage['dialect']>;

/** A compiled schema: data in, every error out, sorted by `instancePath` then `keyword`. */
export type Validator = (data: unknown) => SchemaError[];

/** What compiling a schema gives: a validator, or why the schema cannot be used. */
export type CompiledSchema =
  | { ok: true; dialect: DialectChoice; validate: Validator }
  | { ok: false; dialect: DialectChoice | null; reason: string };

/** Spec 004 criterion 3's message, the reason a schema with a remote `$ref` is not used. */
export const REMOTE_REF_REASON = 'Remote schema references are not loaded (offline)';

/** The `$schema` URI Ajv registers each dialect's bundled meta-schema under. */
const META_SCHEMA: Record<SchemaDialect, string> = {
  'draft-04': 'http://json-schema.org/draft-04/schema',
  'draft-06': 'http://json-schema.org/draft-06/schema',
  'draft-07': 'http://json-schema.org/draft-07/schema',
  '2019-09': 'https://json-schema.org/draft/2019-09/schema',
  '2020-12': 'https://json-schema.org/draft/2020-12/schema',
};

/** `$schema` values of drafts before 04 ("Schema draft not supported", no validation). */
const OLD_DRAFTS = /^https?:\/\/json-schema\.org\/(draft-0[0-3])\/schema#?$/;

/**
 * Picks the dialect from the schema's own `$schema` (UNK-017, UNK-031). A missing `$schema`, or
 * one naming no dialect this editor knows (a custom meta-schema), runs as draft-07, `assumed`, and
 * is `switchable`: `override` is the user's switch for those, and a known `$schema` always wins
 * over it. Returns a string, the reason not to validate, when `$schema` names a draft before 04 or
 * is not a string.
 */
export function selectDialect(
  schema: object | boolean,
  override?: SchemaDialect,
): DialectChoice | string {
  const stated = typeof schema === 'object' ? (schema as { $schema?: unknown }).$schema : undefined;
  const assumed: DialectChoice = {
    name: override ?? 'draft-07',
    assumed: override === undefined,
    switchable: true,
  };
  if (stated === undefined) return assumed;
  if (typeof stated !== 'string') return "The schema's $schema is not a string.";
  const uri = stated.replace(/^http:\/\//, 'https://').replace(/#$/, '');
  for (const [name, meta] of Object.entries(META_SCHEMA) as [SchemaDialect, string][]) {
    if (uri === meta.replace(/^http:\/\//, 'https://')) {
      return { name, assumed: false, switchable: false };
    }
  }
  const old = OLD_DRAFTS.exec(stated);
  if (old) return `Schema draft not supported (${old[1]}); use draft-04 or later.`;
  return assumed;
}

/**
 * Compiles `schema` with the options spec 004 criterion 2 fixes: `strict: false`,
 * `allErrors: true`, `ajv-formats`, and no `loadSchema`, so a remote `$ref` never loads (offline,
 * AGENTS.md rule 3) and is reported as {@link REMOTE_REF_REASON} instead. Never throws.
 */
export function compileSchema(schema: object | boolean, override?: SchemaDialect): CompiledSchema {
  const dialect = selectDialect(schema, override);
  if (typeof dialect === 'string') return { ok: false, dialect: null, reason: dialect };
  const options = { strict: false, allErrors: true };
  const ajv =
    dialect.name === '2020-12'
      ? new Ajv2020(options)
      : dialect.name === '2019-09'
        ? new Ajv2019(options)
        : dialect.name === 'draft-04'
          ? new AjvDraft04(options)
          : new Ajv(options);
  if (dialect.name === 'draft-06') ajv.addMetaSchema(draft06MetaSchema);
  addFormats(ajv);
  // Ajv finds the meta-schema by `$schema`; write it as Ajv registered it (no `#`, its scheme)
  // so every spelling selectDialect accepts, and the user's switch, compile the same way.
  const source =
    typeof schema === 'object' ? { ...schema, $schema: META_SCHEMA[dialect.name] } : schema;
  let validate;
  try {
    validate = ajv.compile(source);
  } catch (error) {
    const reason =
      error instanceof MissingRefError && /^[a-z][a-z0-9+.-]*:\/\//i.test(error.missingSchema)
        ? `${REMOTE_REF_REASON}: ${error.missingRef}`
        : `The schema does not compile: ${describe(error)}`;
    return { ok: false, dialect, reason };
  }
  return {
    ok: true,
    dialect,
    validate: (data) => {
      validate(data);
      const errors = (validate.errors ?? []).map(({ instancePath, keyword, message }) => ({
        instancePath,
        keyword,
        message: message ?? keyword,
      }));
      return errors.sort((a, b) =>
        a.instancePath === b.instancePath
          ? a.keyword.localeCompare(b.keyword)
          : a.instancePath.localeCompare(b.instancePath),
      );
    },
  };
}

/** Parses `text` as `format` and validates the data; never throws. With `dataOnly` (a locked
 *  large-file tab, spec 008 criterion 8) the data comes from core's data-only parse. */
export function validateText(
  text: string,
  format: Format,
  validator: Validator,
  dataOnly = false,
): ValidationResult {
  if (dataOnly) {
    let read;
    try {
      read = dataOrError(format, text);
    } catch (error) {
      return { kind: 'skipped', reason: `The ${format} parser failed: ${describe(error)}` };
    }
    if ('error' in read) return { kind: 'skipped', reason: DOES_NOT_PARSE };
    return { kind: 'errors', errors: validator(read.data) };
  }
  let parsed;
  try {
    parsed = getAdapter(format).parse(text);
  } catch (error) {
    return { kind: 'skipped', reason: `The ${format} parser failed: ${describe(error)}` };
  }
  if (parsed.tree === undefined || parsed.diagnostics.some((d) => d.severity === 'error')) {
    return { kind: 'skipped', reason: DOES_NOT_PARSE };
  }
  return { kind: 'errors', errors: validator(parsed.data) };
}

const DOES_NOT_PARSE = 'The document does not parse, so it was not validated.';

/** What `DocumentValidation` needs from the document and the webview. */
export interface ValidationTarget {
  /** The document's text and version now (VS Code: `getText()` and `version`). */
  snapshot(): { text: string; docVersion: number };
  /** The format to parse the text as now: the format badge's choice can change it (003 T10). */
  format(): Format;
  /** Whether to read the data alone (a locked large-file tab, spec 008); false when absent. */
  dataOnly?(): boolean;
  post(message: ValidationMessage): void;
}

/**
 * Validation for one open document. `schedule()` after each change coalesces bursts of changes
 * into one run on a timer, so typing never waits on Ajv (plan 004 §Constraints); each run reads
 * the text and version together, so a result always names the version it describes.
 */
export class DocumentValidation {
  private compiled: CompiledSchema | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly target: ValidationTarget,
    private readonly delayMs = 100,
  ) {}

  /**
   * Sets the schema and validates at once. `dialect` is the user's switch for a schema without
   * `$schema` (UNK-017); without it such a schema runs as draft-07, `assumed`. Undefined removes
   * the schema: the webview is told once (`none`) so it drops the errors it shows.
   */
  setSchema(schema: object | boolean | undefined, dialect?: SchemaDialect): void {
    if (schema === undefined) {
      const had = this.hasSchema;
      this.compiled = undefined;
      this.dispose();
      if (had) this.post(null, { kind: 'none' });
      return;
    }
    this.compiled = compileSchema(schema, dialect);
    this.run();
  }

  /** A schema applies but cannot be used (unreadable, not JSON, remote): every run says why. */
  setUnavailable(reason: string): void {
    this.compiled = { ok: false, dialect: null, reason };
    this.run();
  }

  get hasSchema(): boolean {
    return this.compiled !== undefined;
  }

  schedule(): void {
    if (!this.hasSchema) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), this.delayMs);
  }

  /** Validates the current text now and posts the result. Without a schema, posts nothing. */
  run(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const compiled = this.compiled;
    if (!compiled) return;
    const { text, docVersion } = this.target.snapshot();
    const result: ValidationResult = compiled.ok
      ? validateText(text, this.target.format(), compiled.validate, this.target.dataOnly?.())
      : { kind: 'skipped', reason: compiled.reason };
    this.post(compiled.dialect, result, docVersion);
  }

  private post(
    dialect: DialectChoice | null,
    result: ValidationResult,
    docVersion = this.target.snapshot().docVersion,
  ): void {
    this.target.post({
      protocol: PROTOCOL_VERSION,
      type: 'validation',
      docVersion,
      dialect,
      result,
    });
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
