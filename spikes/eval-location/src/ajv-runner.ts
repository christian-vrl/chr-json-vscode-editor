// The one validation routine every location runs (spike 004 T1): Ajv 8 for draft-07 with the
// options spec 004 criterion 2 fixes (`strict: false`, `allErrors: true`, `ajv-formats`) and no
// `loadSchema`. Ajv compiles a schema to JavaScript with `new Function`, which is why it needs a
// place where eval is allowed.
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

export interface ErrorKey {
  instancePath: string;
  keyword: string;
}

export interface Compiled {
  validate: ValidateFunction;
  compileMs: number;
}

export function compile(schema: object): Compiled {
  const start = performance.now();
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  return { validate, compileMs: performance.now() - start };
}

/** Spec 004 criterion 2's comparison form: `[{instancePath, keyword}]`, sorted. */
export function run(compiled: Compiled, data: unknown): { errors: ErrorKey[]; validateMs: number } {
  const start = performance.now();
  compiled.validate(data);
  const validateMs = performance.now() - start;
  const errors = (compiled.validate.errors ?? []).map(({ instancePath, keyword }) => ({
    instancePath,
    keyword,
  }));
  errors.sort((a, b) =>
    a.instancePath === b.instancePath
      ? a.keyword.localeCompare(b.keyword)
      : a.instancePath.localeCompare(b.instancePath),
  );
  return { errors, validateMs };
}

export function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
