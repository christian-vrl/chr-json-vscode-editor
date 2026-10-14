// Spec 016 criterion 3 (016 T2, fast-check, seeds committed, 10 000 runs per dialect): for any data
// the 002 formats can hold (JSON5 values with `-0`, `NaN`, `±Infinity`, objects with any keys
// including `__proto__`, `constructor` and `$ref`, nesting to depth 64), spec 004's
// `compileSchema(generateSchema(data, d))` compiles in dialect `d` (not assumed), the schema is valid
// against `d`'s meta-schema (Ajv's `validateSchema`), and `data` passes it with no errors.
// Tightness, same runs: deleting a key the schema lists in `required` from an object gives a
// `required` error at that object's path, and putting `true` where the schema's `type` is
// `"string"` gives a `type` error at that path. The `required` lists those checks break are first
// checked against G3 computed from the data alone (016 T3, #115 review M1), so a generator that
// left a key out of `required` fails here instead of giving the check fewer places to try.
//
// UNK-085 (Ajv 8.20.0, the validator spec 004 ships): keys holding a lone surrogate are left out of
// the data, since Ajv cannot compile a `properties` entry so named ("URI malformed"); and the
// tightness checks skip places inside a `__proto__` member, since Ajv ignores a
// `properties.__proto__` schema (ajv/lib/vocabularies/code.ts:66). Validation of such data still
// passes; it just checks less there.
//
// Each run compiles a schema (about 17 ms), so the runs are split over
// generateSchema.property.<dialect>-<n>.test.ts files that Vitest runs in parallel, each with its
// own seed.
import fc from 'fast-check';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import { expect, it } from 'vitest';
import {
  generateSchema,
  LosslessNumber,
  type GeneratedSchema,
  type GeneratedSchemaDialect,
} from '@chr-json-editor/core';
import { dataArbitrary } from '../../../core/test/arbitraries.js';
import { identityData } from '../../../app-shell/test/query-identity.js';
import { compileSchema } from '../../src/validation';

export const SEED = 20261013;
export const RUNS = 10_000;
export const SHARDS = 4;

/** An own enumerable member, `__proto__` included (assignment would set the prototype). */
function define(object: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(object, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/** The value of an own member only, never an inherited one. */
const own = (object: object, key: string): unknown =>
  Object.getOwnPropertyDescriptor(object, key)?.value;

/** Keys that name inherited members or schema keywords, so arrays of objects that hold some of
 *  them and lack others exercise `ownProperties` and keyword-named properties together. */
const awkwardKey = fc.constantFrom(
  '__proto__',
  'constructor',
  'toString',
  'hasOwnProperty',
  '$ref',
  '$schema',
  'type',
  'properties',
  'required',
  'items',
);
const awkwardObject = fc
  .uniqueArray(fc.tuple(awkwardKey, dataArbitrary('json5')), { maxLength: 6, selector: ([k]) => k })
  .map((entries) => {
    const object: Record<string, unknown> = {};
    for (const [key, value] of entries) define(object, key, value);
    return object;
  });

/** 011's identity data (JSON5 values, any keys, nesting to depth 64), and arrays of objects with
 *  awkward keys. */
const data: fc.Arbitrary<unknown> = fc.oneof(
  identityData,
  awkwardObject,
  fc.array(awkwardObject, { minLength: 1, maxLength: 6 }),
);

type Path = string[];
/** An object the schema gives a `required` list, and a place the schema types as `"string"`. */
type Site = { kind: 'required'; path: Path; key: string } | { kind: 'string'; path: Path };

/** Every site in `value`, walking it together with its schema. */
function sites(value: unknown, schema: GeneratedSchema, path: Path, out: Site[]): Site[] {
  if (schema.type === 'string' && typeof value === 'string') out.push({ kind: 'string', path });
  if (Array.isArray(value)) {
    if (schema.items)
      value.forEach((item, i) => sites(item, schema.items!, [...path, String(i)], out));
  } else if (value !== null && typeof value === 'object') {
    for (const key of schema.required ?? []) out.push({ kind: 'required', path, key });
    for (const key of Object.keys(value)) {
      const child = schema.properties && (own(schema.properties, key) as GeneratedSchema);
      // Ajv does not check a `properties.__proto__` schema (UNK-085), so nothing below it is a site.
      if (child && key !== '__proto__') sites(own(value, key), child, [...path, key], out);
    }
  }
  return out;
}

/** A schema position: a member's key, or 0 for an array's elements. */
type Position = (string | 0)[];

/** G3 from the data alone (#115 review M1): for each position holding objects, the keys every one
 *  of them has, in the order keys are first met (document order, depth first); none when empty. */
function requiredFromData(value: unknown): Map<string, string[]> {
  const seen = new Map<string, { objects: number; counts: Map<string, number> }>();
  const walk = (v: unknown, at: Position) => {
    if (Array.isArray(v)) {
      for (const item of v) walk(item, [...at, 0]);
    } else if (v !== null && typeof v === 'object' && !(v instanceof LosslessNumber)) {
      const id = JSON.stringify(at);
      let entry = seen.get(id);
      if (!entry) seen.set(id, (entry = { objects: 0, counts: new Map() }));
      entry.objects++;
      for (const key of Object.keys(v)) entry.counts.set(key, (entry.counts.get(key) ?? 0) + 1);
      for (const key of Object.keys(v)) walk(own(v, key), [...at, key]);
    }
  };
  walk(value, []);
  const out = new Map<string, string[]>();
  for (const [id, { objects, counts }] of seen) {
    const required = [...counts].filter(([, n]) => n === objects).map(([key]) => key);
    if (required.length) out.set(id, required);
  }
  return out;
}

/** Every `required` list in the schema, by position. */
function requiredInSchema(
  schema: GeneratedSchema,
  at: Position = [],
  out = new Map<string, string[]>(),
): Map<string, string[]> {
  if (schema.required) out.set(JSON.stringify(at), schema.required);
  for (const key of Object.keys(schema.properties ?? {}))
    requiredInSchema(own(schema.properties!, key) as GeneratedSchema, [...at, key], out);
  if (schema.items) requiredInSchema(schema.items, [...at, 0], out);
  return out;
}

/** A deep copy that keeps own `__proto__` members, `-0`, `NaN` and `±Infinity`. */
function clone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clone);
  if (value !== null && typeof value === 'object') {
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) define(copy, key, clone(own(value, key)));
    return copy;
  }
  return value;
}

/** `data` with the site broken: its required key deleted, or its string replaced by `true`. */
function breakSite(data: unknown, site: Site): unknown {
  const root = { value: clone(data) } as Record<string, unknown>;
  let parent: Record<string, unknown> = root;
  let key = 'value';
  for (const step of site.path) {
    parent = own(parent, key) as Record<string, unknown>;
    key = step;
  }
  if (site.kind === 'required') delete (own(parent, key) as Record<string, unknown>)[site.key];
  else define(parent, key, true);
  return root.value;
}

/** RFC 6901, as Ajv writes `instancePath`. */
const pointer = (path: Path) =>
  path.map((step) => `/${step.replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');

const metaValidators: Record<GeneratedSchemaDialect, Ajv> = {
  'draft-07': new Ajv({ strict: false }),
  '2020-12': new Ajv2020({ strict: false }),
};

/** A key Ajv cannot compile as a `properties` name: one holding a lone surrogate (UNK-085). */
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

function keysAjvCompiles(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(keysAjvCompiles);
  if (value !== null && typeof value === 'object')
    return Object.keys(value).every(
      (k) => !LONE_SURROGATE.test(k) && keysAjvCompiles(own(value, k)),
    );
  return true;
}

/** Registers shard `shard` (0-based) of criterion 3 in `dialect`: `RUNS / SHARDS` runs from
 *  `SEED + shard`. */
export function schemaProperty(dialect: GeneratedSchemaDialect, shard: number): void {
  const seed = SEED + shard;
  const runs = RUNS / SHARDS;
  it(`criterion 3, ${dialect}, shard ${shard + 1}/${SHARDS}: ${runs} runs, seed ${seed}`, () => {
    fc.assert(
      fc.property(
        data.filter(keysAjvCompiles),
        fc.nat(),
        fc.nat(),
        (value, pickRequired, pickString) => {
          const schema = generateSchema(value, dialect);
          const compiled = compileSchema(schema);
          if (!compiled.ok) throw new Error(compiled.reason);
          expect(compiled.dialect).toEqual({ name: dialect, assumed: false, switchable: false });
          const meta = metaValidators[dialect];
          expect(meta.validateSchema(schema), JSON.stringify(meta.errors)).toBe(true);
          expect(compiled.validate(value)).toEqual([]);
          expect(requiredInSchema(schema)).toEqual(requiredFromData(value));

          const all = sites(value, schema, [], []);
          const required = all.filter((s) => s.kind === 'required');
          const strings = all.filter((s) => s.kind === 'string');
          for (const [list, pick, keyword] of [
            [required, pickRequired, 'required'],
            [strings, pickString, 'type'],
          ] as const) {
            if (list.length === 0) continue;
            const site = list[pick % list.length]!;
            const errors = compiled.validate(breakSite(value, site));
            expect(errors).toContainEqual(
              expect.objectContaining({ instancePath: pointer(site.path), keyword }),
            );
          }
        },
      ),
      { seed, numRuns: runs },
    );
  }, 600_000);
}
