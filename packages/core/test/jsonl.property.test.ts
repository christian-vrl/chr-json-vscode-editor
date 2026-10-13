// 012 T2 gate, spec 012 criterion 3 (seed committed in `arbitraries.ts`, 10 000 runs each):
// - over generated JSON Lines texts (random values, blank lines, spaces and tabs around values, LF or
//   CRLF, final newline or not) and random valid patches, `applyPatch` gives the data
//   `immutable-json-patch` gives on the parsed input (002 criterion 2), fails where it fails, and
//   every line that holds no item an operation touches appears in the output byte-identical and in
//   the same order (checked operation by operation; a root `replace` goes through `diff` and
//   touches the items it changes, so it is checked for data only);
// - over generated arrays `a` of JSON values, `parse(stringify(a, style)).data` deep-equals `a`.
import { isDeepStrictEqual } from 'node:util';
import fc from 'fast-check';
import { immutableJSONPatch, type JSONPatchDocument } from 'immutable-json-patch';
import { describe, expect, it } from 'vitest';
import {
  getAdapter,
  nearestNumbers,
  parseData,
  PatchError,
  type PatchOperation,
  type Style,
} from '../src/index.js';
import { dataArbitrary, SEED } from './arbitraries.js';
import { jsonlLine, jsonlText, jsonlValue as value, pad, usable } from './jsonl-arbitraries.js';
import { readBack } from './read-back.js';

const RUNS = 10_000;
const adapter = getAdapter('jsonl');

type Gen = fc.GeneratorValue;

function pick<T>(g: Gen, items: readonly T[]): T {
  return items[g(fc.integer, { min: 0, max: items.length - 1 })]!;
}

// --- Patches -----------------------------------------------------------------------------------

const escape = (token: string) => token.replace(/~/g, '~0').replace(/\//g, '~1');
const unescape = (pointer: string) =>
  pointer === ''
    ? []
    : pointer
        .slice(1)
        .split('/')
        .map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));

function getIn(data: unknown, pointer: string): unknown {
  let node = data;
  for (const t of unescape(pointer)) node = (node as Record<string, unknown>)[t];
  return node;
}

function pointers(data: unknown, prefix = ''): string[] {
  const out = [prefix];
  if (data !== null && typeof data === 'object') {
    for (const [k, v] of Object.entries(data)) out.push(...pointers(v, `${prefix}/${escape(k)}`));
  }
  return out;
}

const isContainer = (v: unknown) => v !== null && typeof v === 'object';

/** A path `add` (or the destination of `move`/`copy`) can write in `data`; never the root. */
function addPath(data: unknown, g: Gen): string {
  const container = pick(
    g,
    pointers(data).filter((p) => isContainer(getIn(data, p))),
  );
  const node = getIn(data, container);
  if (Array.isArray(node)) {
    const index = g(fc.integer, { min: -1, max: node.length });
    return `${container}/${index < 0 ? '-' : index}`;
  }
  const keys = Object.keys(node as object);
  const name =
    keys.length > 0 && g(fc.boolean)
      ? pick(g, keys)
      : g(() => fc.string({ maxLength: 6 }).filter(usable));
  return `${container}/${escape(name)}`;
}

type Step = { op: PatchOperation; fails: boolean };

/** Up to four operations on the items; the last may be one that must fail. */
function patchFor(items: unknown[], g: Gen): Step[] {
  const steps: Step[] = [];
  let model: unknown = items;
  const count = g(fc.integer, { min: 1, max: 4 });
  for (let s = 0; s < count; s++) {
    const all = pointers(model);
    const members = all.slice(1);
    const kind = pick(g, ['add', 'replace', 'remove', 'move', 'copy', 'test', 'fail'] as const);
    let op: PatchOperation | undefined;
    let fails = false;
    if (kind === 'add') {
      op = { op: 'add', path: addPath(model, g), value: g(() => value) };
    } else if (kind === 'replace') {
      const path = pick(g, all);
      // L8: the root takes only an array.
      op = { op: 'replace', path, value: g(() => (path === '' ? fc.array(value) : value)) };
    } else if (kind === 'remove' && members.length > 0) {
      op = { op: 'remove', path: pick(g, members) };
    } else if (kind === 'move' && members.length > 0) {
      const from = pick(g, members);
      const after = immutableJSONPatch(model, [{ op: 'remove', path: from }]);
      let path = addPath(after, g);
      // The reference resolves a last `-` before it removes `from`; name the index instead.
      if (path.endsWith('/-')) {
        const parent = getIn(after, path.slice(0, -2)) as unknown[];
        path = `${path.slice(0, -1)}${parent.length}`;
      }
      const prefix = unescape(from);
      const tokens = unescape(path);
      const inside = prefix.length < tokens.length && prefix.every((t, i) => t === tokens[i]);
      if (!inside) op = { op: 'move', from, path };
    } else if (kind === 'copy') {
      op = { op: 'copy', from: pick(g, all), path: addPath(model, g) };
    } else if (kind === 'test') {
      const path = pick(g, all);
      op = { op: 'test', path, value: getIn(model, path) };
    } else if (kind === 'fail') {
      fails = true;
      const path = pick(g, all);
      op = g(fc.boolean)
        ? {
            op: 'test',
            path,
            value: g(() => value.filter((v) => !isDeepStrictEqual(v, getIn(model, path)))),
          }
        : pick<PatchOperation>(g, [
            { op: 'replace', path: `${path}/missing~1member`, value: 1 },
            { op: 'remove', path: `${path}/99` },
            { op: 'move', from: `${path}/missing`, path: '/0' },
            { op: 'copy', from: `${path}/missing`, path: '/0' },
            { op: 'add', path: `${path}/missing/x`, value: 1 },
          ]);
    }
    if (!op) continue;
    steps.push({ op, fails });
    if (fails) break;
    model = immutableJSONPatch(model, [op]);
  }
  return steps;
}

// --- Lines -------------------------------------------------------------------------------------

/** The lines of `text` without their endings, a leading BOM aside (spec 012 §Terms). */
const lines = (text: string) => (text === '' ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/));
const endings = (text: string) => new Set(text.match(/\r?\n/g) ?? []);

/** The 0-based line indices of the items, in order. */
const itemLines = (text: string) =>
  lines(text).flatMap((line, index) => (/^[ \t]*$/.test(line) ? [] : [index]));

/** The items (by their index before the operation) an operation names by its first token (`-`
 *  and the root name none). A `move` reads `path` after removing `from` (RFC 6902 §4.4), so an
 *  item after a moved item is one further on before it. */
function touched(op: PatchOperation): Set<number> {
  const first = (pointer: string) => {
    const token = unescape(pointer)[0];
    return token !== undefined && /^\d+$/.test(token) ? Number(token) : undefined;
  };
  const named = new Set<number>();
  const from = 'from' in op ? first(op.from) : undefined;
  let to = first(op.path);
  if (op.op === 'move' && from !== undefined && to !== undefined && unescape(op.from).length === 1)
    if (to >= from) to++;
  for (const index of [from, to]) if (index !== undefined) named.add(index);
  return named;
}

/** Whether `part` appears in `whole` in order. */
function isSubsequence(part: string[], whole: string[]): boolean {
  let i = 0;
  for (const item of whole) if (i < part.length && item === part[i]) i++;
  return i === part.length;
}

// --- The properties ----------------------------------------------------------------------------

describe('criterion 3: JSON Lines texts × random patches', () => {
  it(`${RUNS} runs, seed ${SEED}`, () => {
    fc.assert(
      fc.property(jsonlText, fc.gen(), (text, g) => {
        const input = adapter.parse(text);
        expect(input.diagnostics).toEqual([]);
        // The model and the reference read big numbers (spec 015) as nearest numbers; the values
        // the patch gives core are read back the way core reads their text (read-back.ts), so
        // `test` compares a big number with the big number its text holds.
        const items = nearestNumbers(input.data) as unknown[];
        const steps = patchFor(items, g);
        const reference = steps.map((s) => s.op);
        const patch = readBack(reference) as PatchOperation[];
        const failing = steps.some((s) => s.fails);
        if (failing) {
          // The last operation names a value that is not there, or tests a value that differs.
          // (The reference does not always throw: on an array it reads a missing index as
          // `undefined` and removes or replaces nothing.)
          expect(() => adapter.applyPatch(text, patch)).toThrow(PatchError);
          return;
        }
        const out = adapter.applyPatch(text, patch);
        const result = adapter.parse(out);
        expect(result.diagnostics).toEqual([]);
        // A whole number JavaScript writes as a big number reads back as one (read-back.ts).
        const want = readBack(immutableJSONPatch(items, reference as unknown as JSONPatchDocument));
        expect(
          isDeepStrictEqual(result.data, want),
          JSON.stringify({ text, patch, out, want }),
        ).toBe(true);

        // Operation by operation: the lines of items it does not name stay, in order, and the
        // text keeps its line ending and final newline (L9, R10). One exception is inherent: L4
        // removes the line ending before a last line that has none, and when the line before is
        // an empty blank line, that line ends where the text ends, so it is no line any more
        // (§Terms) and the text now ends with a line ending (README reading 9).
        let before = text;
        for (const op of patch) {
          const after = adapter.applyPatch(before, [op]);
          const named = touched(op);
          const items = itemLines(before);
          const old = lines(before);
          // A root `replace` may remove the last item too (through `diff`).
          const lastGoes =
            !/\n$/.test(before) &&
            items.at(-1) === old.length - 1 &&
            (op.path === '' ||
              ((op.op === 'remove' || op.op === 'move') &&
                named.has(items.length - 1) &&
                unescape(op.op === 'move' ? op.from : op.path).length === 1));
          const emptyGoes = lastGoes && old.at(-2) === '';
          if (op.path !== '') {
            const kept = old.filter(
              (_, index) =>
                !items.some((line, i) => line === index && named.has(i)) &&
                !(emptyGoes && index === old.length - 2),
            );
            expect(isSubsequence(kept, lines(after)), JSON.stringify({ before, op, after })).toBe(
              true,
            );
          }
          for (const ending of endings(after)) {
            expect(
              endings(before).size === 0 || endings(before).has(ending),
              JSON.stringify({ before, op, after }),
            ).toBe(true);
          }
          if (after !== '' && !emptyGoes) {
            expect(/\n$/.test(after), JSON.stringify({ before, op, after })).toBe(
              before === '' || /\n$/.test(before),
            );
          }
          before = after;
        }
      }),
      { numRuns: RUNS, seed: SEED },
    );
  }, 300_000);
});

describe('criterion 3: stringify round trip', () => {
  const style = fc.record({
    indent: fc.constant(0),
    eol: fc.constantFrom<Style['eol']>('\n', '\r\n'),
    finalNewline: fc.boolean(),
    quote: fc.constant<Style['quote']>('"'),
    unquotedKeys: fc.constant(false),
    trailingCommas: fc.constant(false),
  });

  it(`${RUNS} runs, seed ${SEED}`, () => {
    fc.assert(
      fc.property(fc.array(dataArbitrary('json'), { maxLength: 8 }), style, (a, s) => {
        const text = adapter.stringify(a, s);
        const parsed = adapter.parse(text);
        expect(parsed.diagnostics).toEqual([]);
        expect(isDeepStrictEqual(parsed.data, readBack(a)), JSON.stringify({ text, a })).toBe(true);
        expect(parsed.style.eol).toBe(
          a.length > 1 || (a.length === 1 && s.finalNewline) ? s.eol : '\n',
        );
      }),
      { numRuns: RUNS, seed: SEED },
    );
  }, 300_000);
});

describe("parseData('jsonl') agrees with parse (spec 008 criterion 6 for JSON Lines)", () => {
  /** Lines that may be bad: JSON5 syntax, two values, a lone CR, half a record, a BOM. */
  const junk = fc.constantFrom('{a:1}', '1 2', '1\r2', ' \r', '{"a":', ']', '//c', "'s'", '﻿1');
  const text = fc
    .record({
      bom: fc.boolean(),
      lines: fc.array(fc.oneof(jsonlLine, pad, junk), { maxLength: 6 }),
      eol: fc.constantFrom('\n', '\r\n'),
      finalNewline: fc.boolean(),
    })
    .map(
      ({ bom, lines, eol, finalNewline }) =>
        (bom ? '﻿' : '') + (lines.length === 0 ? '' : lines.join(eol) + (finalNewline ? eol : '')),
    );

  it(`${RUNS} runs, seed ${SEED}`, () => {
    fc.assert(
      fc.property(text, (t) => {
        const parsed = adapter.parse(t);
        const result = parseData('jsonl', t);
        const first = parsed.diagnostics[0];
        if (first) {
          expect(result).toEqual({ error: { message: first.message, offset: first.offset } });
        } else {
          expect('data' in result && isDeepStrictEqual(result.data, parsed.data)).toBe(true);
        }
      }),
      { numRuns: RUNS, seed: SEED },
    );
  }, 300_000);
});
