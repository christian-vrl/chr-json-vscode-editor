// Bench fixtures for spike 011 T1: arrays of records of 1,040,000 to 1,048,576 bytes ("1 MiB") and
// 5,200,000 to 5,242,880 bytes ("5 MiB", at most spec 008's threshold, so JavaScript and Lodash are
// offered for it under UNK-049). Deterministic (seeded PRNG); run.mjs records each SHA-256.
import { createHash } from 'node:crypto';

const CITIES = ['Lisbon', 'Porto', 'Recife', 'Santos', 'Curitiba', 'Belém', 'Natal', 'Manaus'];
const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];

// mulberry32, as in spikes/eval-location/fixture.mjs.
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

function record(i, random) {
  const pick = (list) => list[Math.floor(random() * list.length)];
  return {
    id: i,
    name: `${pick(WORDS)} ${pick(WORDS)} ${i}`,
    active: random() < 0.6,
    total: Math.round(random() * 100000) / 100,
    tags: WORDS.filter(() => random() < 0.25),
    address: { city: pick(CITIES), zip: String(10000 + Math.floor(random() * 89999)) },
  };
}

/** Text with 2-space indent and a final newline, between min and max UTF-8 bytes. */
export function documentText(min, max, seed) {
  const random = prng(seed);
  const items = [];
  // "[\n" + "\n]" + "\n", each item indented two more spaces, ",\n" between items.
  let size = 5;
  while (size < min) {
    const rendered = JSON.stringify(record(items.length, random), null, 2);
    const next =
      size + Buffer.byteLength(rendered) + 2 * rendered.split('\n').length + (items.length ? 2 : 0);
    if (next > max) break;
    size = next;
    items.push(JSON.parse(rendered));
  }
  const text = `${JSON.stringify(items, null, 2)}\n`;
  const bytes = Buffer.byteLength(text);
  if (bytes < min || bytes > max)
    throw new Error(`document is ${bytes} bytes, outside [${min}, ${max}]`);
  return text;
}

export const FIXTURES = [
  { id: '1mib', min: 1_040_000, max: 1_048_576, seed: 11011 },
  { id: '5mib', min: 5_200_000, max: 5_242_880, seed: 11015 },
];

export function describeFixtures() {
  return FIXTURES.map(({ id, min, max, seed }) => {
    const text = documentText(min, max, seed);
    return {
      id,
      text,
      bytes: Buffer.byteLength(text),
      items: JSON.parse(text).length,
      sha256: createHash('sha256').update(text).digest('hex'),
    };
  });
}
