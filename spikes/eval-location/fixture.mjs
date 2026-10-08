// Benchmark fixture for spike 004 T1: a draft-07 schema with exactly 200 rules and a document of
// 1,000,000 to 1,048,576 bytes that it validates, with about 1% of the items invalid so the error
// path is exercised. Deterministic (seeded PRNG), so every run and every reviewer gets the same
// bytes; run.mjs records the document's SHA-256.
//
// A "rule" is one assertion keyword instance (type, minLength, pattern, required, ...); applicators
// that only hold other rules (properties, items) are not counted. countRules() checks the 200.
import { createHash } from 'node:crypto';

const ASSERTIONS = new Set([
  'type',
  'enum',
  'const',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minItems',
  'maxItems',
  'uniqueItems',
  'required',
  'additionalProperties',
]);

const PROPERTY_COUNT = 39;
const FORMATS = ['date', 'email', 'uuid'];
const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];

function propertySchema(i) {
  switch (i % 4) {
    case 0:
      return {
        type: 'string',
        minLength: 1,
        maxLength: 40,
        pattern: '^[a-z0-9@.-]+$',
        format: FORMATS[i % 3],
      };
    case 1:
      return {
        type: 'integer',
        minimum: 0,
        maximum: 100000,
        multipleOf: 1,
        exclusiveMaximum: 100001,
      };
    case 2:
      return {
        type: 'array',
        minItems: 1,
        maxItems: 8,
        uniqueItems: true,
        items: { type: 'string' },
      };
    default:
      return { type: 'string', enum: WORDS, minLength: 4, maxLength: 7, pattern: '^[a-z]+$' };
  }
}

export function schema() {
  const properties = {};
  for (let i = 0; i < PROPERTY_COUNT; i++) properties[`p${i}`] = propertySchema(i);
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'array',
    minItems: 1,
    items: {
      type: 'object',
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    },
  };
}

export function countRules(node) {
  if (Array.isArray(node)) return node.reduce((n, child) => n + countRules(child), 0);
  if (node === null || typeof node !== 'object') return 0;
  let n = 0;
  for (const [key, value] of Object.entries(node)) {
    if (ASSERTIONS.has(key)) n++;
    // Recurse into subschemas only, not into keyword values such as enum lists.
    if (key === 'properties') n += Object.values(value).reduce((m, s) => m + countRules(s), 0);
    else if (key === 'items') n += countRules(value);
  }
  return n;
}

// mulberry32: tiny, seeded, good enough for test data.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hex(random, n) {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(random() * 16).toString(16);
  return s;
}

function validValue(i, random) {
  switch (i % 4) {
    case 0: {
      const format = FORMATS[i % 3];
      if (format === 'date') {
        const d = 1 + Math.floor(random() * 28);
        return `2026-0${1 + Math.floor(random() * 9)}-${String(d).padStart(2, '0')}`;
      }
      if (format === 'email') return `user${Math.floor(random() * 1e6)}@example.org`;
      return `${hex(random, 8)}-${hex(random, 4)}-4${hex(random, 3)}-a${hex(random, 3)}-${hex(random, 12)}`;
    }
    case 1:
      return Math.floor(random() * 100000);
    case 2: {
      const n = 1 + Math.floor(random() * 4);
      return WORDS.slice(0, 8)
        .sort(() => random() - 0.5)
        .slice(0, n);
    }
    default:
      return WORDS[Math.floor(random() * WORDS.length)];
  }
}

function invalidValue(i) {
  switch (i % 4) {
    case 0:
      return 'NOT VALID';
    case 1:
      return -1;
    case 2:
      return [];
    default:
      return 'zulu';
  }
}

/** The document text (2-space indent, LF, final newline) and its data. */
export function documentText() {
  const random = prng(4001);
  const items = [];
  const min = 1_000_000;
  const max = 1_048_576;
  // Size of JSON.stringify(items, null, 2) + "\n", kept incrementally: "[\n", each item's lines
  // indented two more spaces, ",\n" between items, "\n]" and the final newline.
  let size = 2 + 2 + 1;
  while (size < min) {
    const item = {};
    for (let i = 0; i < PROPERTY_COUNT; i++) item[`p${i}`] = validValue(i, random);
    if (random() < 0.01) {
      const bad = Math.floor(random() * PROPERTY_COUNT);
      item[`p${bad}`] = invalidValue(bad);
    }
    const rendered = JSON.stringify(item, null, 2);
    size += rendered.length + 2 * rendered.split('\n').length + (items.length ? 2 : 0);
    items.push(item);
  }
  const text = `${JSON.stringify(items, null, 2)}\n`;
  const bytes = Buffer.byteLength(text);
  if (bytes < min || bytes > max)
    throw new Error(`document is ${bytes} bytes, outside [${min}, ${max}]`);
  return text;
}

export function describeFixture() {
  const s = schema();
  const text = documentText();
  const rules = countRules(s);
  if (rules !== 200) throw new Error(`schema has ${rules} rules, expected 200`);
  return {
    schema: s,
    text,
    rules,
    bytes: Buffer.byteLength(text),
    items: JSON.parse(text).length,
    sha256: createHash('sha256').update(text).digest('hex'),
  };
}
