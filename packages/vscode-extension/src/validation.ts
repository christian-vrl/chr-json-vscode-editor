// JSON Schema validation in the extension host (004 T2, ADR-010). Ajv compiles a schema to
// JavaScript with `new Function`, which the webview CSP forbids (spec 003 criterion 6), so it runs
// here in Node and the webview gets the errors as a `validation` message keyed by `docVersion`.
//
// No `vscode` import, so the unit tests run it directly; editorProvider.ts wires it to a document
// and a webview. Dialect selection, bundled meta-schemas and fixtures are 004 T4; until then every
// schema runs as draft-07, the dialect assumed when `$schema` is missing (UNK-017). Where the
// schema comes from is 004 T5 (association, 004 T3's resolver).
import { getAdapter, type Format } from '@chr-json-editor/core';
import {
  PROTOCOL_VERSION,
  type SchemaError,
  type ValidationMessage,
} from '@chr-json-editor/app-shell/protocol';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

export type ValidationResult = ValidationMessage['result'];

/** A compiled schema: data in, every error out, sorted by `instancePath` then `keyword`. */
export type Validator = (data: unknown) => SchemaError[];

/**
 * Compiles `schema` with the options spec 004 criterion 2 fixes: `strict: false`,
 * `allErrors: true`, `ajv-formats`, and no `loadSchema`, so a remote `$ref` never loads (offline,
 * AGENTS.md rule 3) and compiling throws instead.
 */
export function compileSchema(schema: object | boolean): Validator {
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  return (data) => {
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
  };
}

/** Parses `text` as `format` and validates the data; never throws. */
export function validateText(text: string, format: Format, validator: Validator): ValidationResult {
  let parsed;
  try {
    parsed = getAdapter(format).parse(text);
  } catch (error) {
    return { kind: 'skipped', reason: `The ${format} parser failed: ${describe(error)}` };
  }
  if (parsed.tree === undefined || parsed.diagnostics.some((d) => d.severity === 'error')) {
    return { kind: 'skipped', reason: 'The document does not parse, so it was not validated.' };
  }
  return { kind: 'errors', errors: validator(parsed.data) };
}

/** What `DocumentValidation` needs from the document and the webview. */
export interface ValidationTarget {
  /** The document's text and version now (VS Code: `getText()` and `version`). */
  snapshot(): { text: string; docVersion: number };
  format: Format;
  post(message: ValidationMessage): void;
}

/**
 * Validation for one open document. `schedule()` after each change coalesces bursts of changes
 * into one run on a timer, so typing never waits on Ajv (plan 004 §Constraints); each run reads
 * the text and version together, so a result always names the version it describes.
 */
export class DocumentValidation {
  private validator: Validator | undefined;
  private compileError: string | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly target: ValidationTarget,
    private readonly delayMs = 100,
  ) {}

  /** Sets the schema (undefined: none) and validates at once. */
  setSchema(schema: object | boolean | undefined): void {
    this.validator = undefined;
    this.compileError = undefined;
    if (schema !== undefined) {
      try {
        this.validator = compileSchema(schema);
      } catch (error) {
        this.compileError = describe(error);
      }
    }
    this.run();
  }

  get hasSchema(): boolean {
    return this.validator !== undefined || this.compileError !== undefined;
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
    if (!this.hasSchema) return;
    const { text, docVersion } = this.target.snapshot();
    const result: ValidationResult = this.validator
      ? validateText(text, this.target.format, this.validator)
      : { kind: 'skipped', reason: `The schema does not compile: ${this.compileError}` };
    this.target.post({ protocol: PROTOCOL_VERSION, type: 'validation', docVersion, result });
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
