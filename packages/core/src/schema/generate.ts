// JSON Schema generator (spec 016, 016 T1). Rules G1–G9 of spec/016-generate-schema/spec.md; the
// corpus in tests/schema-gen/ encodes them. One pass over the data fills an accumulator per schema
// position (plan 016 §Approach), a second writes the schema in G6's key order. The first pass uses an
// explicit stack, so G9's depth limit is a counter rather than a stack overflow; the second recurses
// at most as deep as that limit allows.
import { LosslessNumber } from '../formats/numbers.js';

/** The dialects the generator writes (UNK-069: the command writes `draft-07`). */
export type GeneratedSchemaDialect = 'draft-07' | '2020-12';

/** Each dialect's `$schema` URI, as spec 004's validator registers it (spec 016 §Terms). */
export const GENERATED_SCHEMA_URI: Record<GeneratedSchemaDialect, string> = {
  'draft-07': 'http://json-schema.org/draft-07/schema#',
  '2020-12': 'https://json-schema.org/draft/2020-12/schema',
};

/** G9: data nested deeper than this many levels is not generated. */
export const MAX_SCHEMA_DEPTH = 1000;

/** G9's message. */
export const SCHEMA_TOO_DEEP_MESSAGE =
  'The document is nested too deeply to generate a schema (more than 1,000 levels).';

/** Thrown by {@link generateSchema} for data nested more than {@link MAX_SCHEMA_DEPTH} levels (G9). */
export class SchemaTooDeepError extends Error {
  constructor() {
    super(SCHEMA_TOO_DEEP_MESSAGE);
    this.name = 'SchemaTooDeepError';
  }
}

export interface GenerateSchemaOptions {
  /**
   * G8: `data` is a JSON Lines document's items (`parseData('jsonl', text)`), and the schema
   * describes one line, the set of all items, rather than the array.
   */
  lines?: boolean;
}

/** A generated schema; `$schema` only at the root (G6). */
export interface GeneratedSchema {
  $schema?: string;
  type?: string | string[];
  properties?: Record<string, GeneratedSchema>;
  required?: string[];
  items?: GeneratedSchema;
}

// G2's fixed order of types, as bits of `Accumulator.types`.
const TYPE_ORDER = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'] as const;
const OBJECT = 1 << 0;
const ARRAY = 1 << 1;
const STRING = 1 << 2;
const NUMBER = 1 << 3;
const INTEGER = 1 << 4;
const BOOLEAN = 1 << 5;
const NULL = 1 << 6;

/** What one schema position has seen: the values of a set (G2). */
interface Accumulator {
  types: number;
  /** How many objects the set has (G3's `required`). */
  objects: number;
  /** Every key of those objects, in the order first met, with its values and how many held it. */
  properties: Map<string, { values: Accumulator; count: number }> | undefined;
  /** All elements of the set's arrays together (G4). */
  items: Accumulator | undefined;
}

function accumulator(): Accumulator {
  return { types: 0, objects: 0, properties: undefined, items: undefined };
}

/** G1: the type bit of `value`. */
function typeOf(value: unknown): number {
  if (value === null) return NULL;
  // A big number (spec 015) is typed by its nearest number, the value spec 004's validator sees
  // (015 B6): a 19-digit id is an integer, `1e400` (Infinity) a number.
  if (value instanceof LosslessNumber) return typeOf(Number(value.value));
  switch (typeof value) {
    case 'boolean':
      return BOOLEAN;
    case 'string':
      return STRING;
    case 'number':
      // `-0` and `1e300` are integers; `NaN` and `±Infinity` (JSON5) are numbers.
      return Number.isInteger(value) ? INTEGER : NUMBER;
    default:
      return Array.isArray(value) ? ARRAY : OBJECT;
  }
}

/**
 * The JSON Schema of `data` in `dialect` (spec 016 G1–G9): which keys exist and what types they
 * hold, nothing else (G5). With `lines`, `data` is a JSON Lines document's items and the schema
 * describes one line (G8). Throws {@link SchemaTooDeepError} when `data` is nested more than
 * {@link MAX_SCHEMA_DEPTH} levels, an array or object being one level (`[[1]]` is two).
 */
export function generateSchema(
  data: unknown,
  dialect: GeneratedSchemaDialect,
  options: GenerateSchemaOptions = {},
): GeneratedSchema {
  const root = accumulator();
  // Depth-first in document order: children are pushed in reverse, so the first one pops first and
  // keys are met in document order (G3).
  const stack: { value: unknown; into: Accumulator; depth: number }[] = [];
  if (options.lines) {
    const lines = data as readonly unknown[];
    for (let i = lines.length - 1; i >= 0; i--)
      stack.push({ value: lines[i], into: root, depth: 0 });
  } else {
    stack.push({ value: data, into: root, depth: 0 });
  }
  for (let entry = stack.pop(); entry !== undefined; entry = stack.pop()) {
    const { value, into, depth } = entry;
    const type = typeOf(value);
    into.types |= type;
    if (type !== ARRAY && type !== OBJECT) continue;
    if (depth >= MAX_SCHEMA_DEPTH) throw new SchemaTooDeepError();
    if (type === ARRAY) {
      const items = (into.items ??= accumulator());
      const array = value as readonly unknown[];
      for (let i = array.length - 1; i >= 0; i--) {
        stack.push({ value: array[i], into: items, depth: depth + 1 });
      }
      continue;
    }
    into.objects++;
    const properties = (into.properties ??= new Map<
      string,
      { values: Accumulator; count: number }
    >());
    const object = value as Record<string, unknown>;
    // Own keys only (G3): `JSON.parse` and core's parsers define `__proto__` as an own key.
    const keys = Object.keys(object);
    for (const key of keys) {
      let property = properties.get(key);
      if (property === undefined) {
        property = { values: accumulator(), count: 0 };
        properties.set(key, property);
      }
      property.count++;
    }
    for (let i = keys.length - 1; i >= 0; i--) {
      const key = keys[i]!;
      stack.push({ value: object[key], into: properties.get(key)!.values, depth: depth + 1 });
    }
  }
  const schema: GeneratedSchema = { $schema: GENERATED_SCHEMA_URI[dialect] };
  // G8: an empty JSON Lines document has no values, so its schema is `$schema` alone.
  if (root.types !== 0) Object.assign(schema, write(root));
  return schema;
}

/** The schema of one accumulator, keys in G6's order. */
function write(acc: Accumulator): GeneratedSchema {
  const schema: GeneratedSchema = {};
  // G2: every integer is a number, so `number` alone stands for both.
  const types = acc.types & NUMBER ? acc.types & ~INTEGER : acc.types;
  const names = TYPE_ORDER.filter((_, bit) => types & (1 << bit));
  schema.type = names.length === 1 ? names[0] : names;
  if (acc.properties !== undefined && acc.properties.size > 0) {
    const properties: Record<string, GeneratedSchema> = {};
    const required: string[] = [];
    for (const [key, { values, count }] of acc.properties) {
      // defineProperty keeps `__proto__` an own key, which a plain assignment would not (G3).
      Object.defineProperty(properties, key, {
        value: write(values),
        enumerable: true,
        writable: true,
        configurable: true,
      });
      if (count === acc.objects) required.push(key);
    }
    schema.properties = properties;
    if (required.length > 0) schema.required = required;
  }
  // G4: no `items` when every array was empty.
  if (acc.items !== undefined && acc.items.types !== 0) schema.items = write(acc.items);
  return schema;
}
