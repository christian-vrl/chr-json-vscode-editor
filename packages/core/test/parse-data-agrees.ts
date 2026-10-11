// Spec 008 criterion 6: `parseData(format, text)` agrees with `getAdapter(format).parse(text)`.
// Shared by the property suite (`parse-data.property.test.ts`) and the golden-input test
// (`tests/golden/parse-data.test.ts`).
import { isDeepStrictEqual } from 'node:util';
import { expect } from 'vitest';
import { getAdapter, parseData, type Format } from '../src/index.js';

/** Member names in order, at every depth: `isDeepStrictEqual` does not compare key order. */
function keyOrder(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(keyOrder);
  if (data !== null && typeof data === 'object')
    return Object.entries(data).map(([k, v]) => [k, keyOrder(v)]);
  return null;
}

/** `{ data }` equal to the full parse's data (key order too) when it has no error diagnostic,
 *  otherwise `{ error }` with its first error's message and offset. */
export function expectAgrees(format: Format, text: string): void {
  const full = getAdapter(format).parse(text);
  const light = parseData(format, text);
  const first = full.diagnostics.find((d) => d.severity === 'error');
  const label = `${format}: ${JSON.stringify(text)}`;
  if (first) {
    expect(light, label).toEqual({ error: { message: first.message, offset: first.offset } });
    return;
  }
  expect(Object.keys(light), label).toEqual(['data']);
  const { data } = light as { data: unknown };
  // `toEqual` only to print the difference: it treats -0 and 0 as equal.
  if (!isDeepStrictEqual(data, full.data)) expect(data, label).toEqual(full.data);
  expect(isDeepStrictEqual(data, full.data), label).toBe(true);
  expect(keyOrder(data), label).toEqual(keyOrder(full.data));
}
