// 002 T6 gate, spec 002 criterion 3: for 10 000 random documents × random patches per format (seed
// committed in `arbitraries.ts`), `applyPatch` gives the data `immutable-json-patch` gives on the
// parsed input (rule 2), and every input comment whose span does not intersect a removed, replaced
// or moved member appears byte-identical in the output. A patch that fails (a `test` that does not
// hold, a path that does not exist) throws a `PatchError` where the reference throws too (R9).
//
// Documents are printed here, not by `stringify`, so they carry comments in every place the golden
// corpus tags (`before` lines, with or without a blank line; `after` on the member's line; `inline`
// between key and value or before the comma; comments in single-line and empty containers, before a
// closing bracket and around the root), and mix single-line and multi-line containers.
import { isDeepStrictEqual } from 'node:util';
import fc from 'fast-check';
import { immutableJSONPatch, type JSONPatchDocument } from 'immutable-json-patch';
import { describe, expect, it } from 'vitest';
import {
  getAdapter,
  PatchError,
  type Format,
  type FormatNode,
  type PatchOperation,
} from '../src/index.js';
import { dataArbitrary, SEED, styleArbitrary } from './arbitraries.js';
import { printDocument } from './print-document.js';

const RUNS = 10_000;

type Gen = fc.GeneratorValue;

function pick<T>(g: Gen, items: readonly T[]): T {
  return items[g(fc.integer, { min: 0, max: items.length - 1 })]!;
}

/**
 * The data without members the reference mishandles. `immutable-json-patch` 6.0.3 reads and writes
 * members by plain property access (lib/esm/immutabilityHelpers.js `getIn`, `setIn`), so it would
 * read `constructor` from the prototype and set the prototype for `__proto__`; and it reads a last
 * token `-` as "after the last item" in objects too (lib/esm/immutableJSONPatch.js
 * `resolvePathIndex`). Our adapters treat all of them as members (formats.test.ts).
 */
const usable = (key: string) => !(key in Object.prototype) && key !== '-';

function plain(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(plain);
  if (data !== null && typeof data === 'object') {
    const object: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) if (usable(k)) object[k] = plain(v);
    return object;
  }
  return data;
}

/** Patch values are plain JSON (R8): no -0, no non-finite numbers. */
const patchValue = dataArbitrary('json').map(
  (v) => JSON.parse(JSON.stringify(plain(v))) as unknown,
);

/** Equal as data, with -0 and 0 the same number: the JSON and JSONC writers write -0 from a `copy`
 *  as `0`, as `JSON.stringify` does (R8). */
function sameData(a: unknown, b: unknown): boolean {
  const normal = (x: unknown): unknown =>
    Object.is(x, -0)
      ? 0
      : Array.isArray(x)
        ? x.map(normal)
        : x !== null && typeof x === 'object'
          ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, normal(v)]))
          : x;
  return isDeepStrictEqual(normal(a), normal(b));
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

/** Every pointer in the data, the root `''` first. */
function pointers(data: unknown, prefix = ''): string[] {
  const out = [prefix];
  if (data !== null && typeof data === 'object') {
    for (const [k, v] of Object.entries(data)) out.push(...pointers(v, `${prefix}/${escape(k)}`));
  }
  return out;
}

const isContainer = (v: unknown) => v !== null && typeof v === 'object';
const finite = (v: unknown): boolean =>
  typeof v === 'number'
    ? Number.isFinite(v)
    : isContainer(v)
      ? Object.values(v).every(finite)
      : true;

/** A path `add` (or the destination of `move`/`copy`) can write in `data`. */
function addPath(data: unknown, g: Gen): string {
  const containers = pointers(data).filter((p) => isContainer(getIn(data, p)));
  if (containers.length === 0) return '';
  const container = pick(g, containers);
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

/** Up to four operations; the last may be one that must fail. */
function patchFor(data: unknown, g: Gen): Step[] {
  const steps: Step[] = [];
  let model = data;
  const count = g(fc.integer, { min: 1, max: 4 });
  for (let s = 0; s < count; s++) {
    const all = pointers(model);
    const members = all.slice(1);
    const kind = pick(g, ['add', 'replace', 'remove', 'move', 'copy', 'test', 'fail'] as const);
    let op: PatchOperation | undefined;
    let fails = false;
    if (kind === 'add') {
      op = { op: 'add', path: addPath(model, g), value: g(() => patchValue) };
    } else if (kind === 'replace') {
      op = { op: 'replace', path: pick(g, all), value: g(() => patchValue) };
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
      if (finite(getIn(model, path))) op = { op: 'test', path, value: getIn(model, path) };
    } else if (kind === 'fail') {
      fails = true;
      const path = pick(g, all);
      // The reference compares by `JSON.stringify`, which writes non-finite numbers as `null`.
      if (!finite(getIn(model, path))) continue;
      op = g(fc.boolean)
        ? {
            op: 'test',
            path,
            value: g(() => patchValue.filter((v) => !sameData(v, getIn(model, path)))),
          }
        : pick<PatchOperation>(g, [
            { op: 'replace', path: `${path}/missing~1member`, value: 1 },
            { op: 'remove', path: `${path}/99` },
            { op: 'move', from: `${path}/missing`, path: '/x' },
            { op: 'copy', from: `${path}/missing`, path: '/x' },
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

// --- Comments a step may remove ----------------------------------------------------------------

interface Comment {
  text: string;
  offset: number;
  end: number;
}

function comments(text: string): Comment[] {
  return [...text.matchAll(/\/\/ c\d+|\/\* c\d+ \*\//g)].map((m) => ({
    text: m[0],
    offset: m.index,
    end: m.index + m[0].length,
  }));
}

/** The node at `pointer` with its parent container and its member node. */
function locate(
  root: FormatNode,
  pointer: string,
): { container?: FormatNode; member: FormatNode; value: FormatNode } | undefined {
  let container: FormatNode | undefined;
  let member = root;
  let value = root;
  for (const t of unescape(pointer)) {
    container = value;
    const items = value.children ?? [];
    const found =
      value.type === 'array'
        ? items[t === '-' ? items.length : Number(t)]
        : [...items].reverse().find((p) => p.children![0]!.value === t);
    if (!found) return undefined;
    member = found;
    value = found.type === 'property' ? found.children![1]! : found;
  }
  return { container, member, value };
}

const lineStart = (text: string, offset: number) => text.lastIndexOf('\n', offset - 1) + 1;
const lineEnd = (text: string, offset: number) => {
  const i = text.indexOf('\n', offset);
  return i < 0 ? text.length : i;
};

/**
 * The span of a member a step removes or moves: its own lines (its first to its last), clipped to
 * the space between its neighbors, plus the comment lines directly above it when only its leading
 * block comments precede it on its line (UNK-008: no blank line between; UNK-021 ★).
 */
function memberSpan(text: string, container: FormatNode, member: FormatNode): [number, number] {
  const items = container.children ?? [];
  const i = items.indexOf(member);
  const prevEnd = i > 0 ? items[i - 1]!.offset + items[i - 1]!.length : container.offset + 1;
  const nextStart =
    i < items.length - 1 ? items[i + 1]!.offset : container.offset + container.length - 1;
  let start = Math.max(lineStart(text, member.offset), prevEnd);
  const end = Math.min(lineEnd(text, member.offset + member.length), nextStart);
  const before = text.slice(lineStart(text, member.offset), member.offset);
  if (before.replace(/\/\* c\d+ \*\//g, '').trim() === '') {
    for (;;) {
      const above = lineStart(text, start - 1);
      if (start === 0 || above < prevEnd) break;
      const line = text.slice(above, start).trim();
      if (line === '' || line.replace(/\/\/ c\d+|\/\* c\d+ \*\//g, '').trim() !== '') break;
      start = above;
    }
  }
  return [start, end];
}

/** Comments a successful `op` on `text` may remove: those in a member it removes or moves, or in a
 *  value it replaces. */
function exempt(format: Format, text: string, op: PatchOperation): string[] {
  const adapter = getAdapter(format);
  const out: string[] = [];
  const inSpan = (source: string, [s, e]: [number, number]) =>
    out.push(
      ...comments(source)
        .filter((c) => c.offset < e && c.end > s)
        .map((c) => c.text),
    );
  const removed = (source: string, pointer: string) => {
    const found = locate(adapter.parse(source).tree!, pointer);
    if (found?.container) inSpan(source, memberSpan(source, found.container, found.member));
  };
  const replaced = (source: string, pointer: string, insert: boolean) => {
    const tree = adapter.parse(source).tree;
    if (!tree) return;
    const tokens = unescape(pointer);
    const parent = locate(
      tree,
      tokens.length > 1 ? `/${tokens.slice(0, -1).map(escape).join('/')}` : '',
    );
    // `add` to an array inserts; to an existing object member (or the root) it replaces.
    if (insert && tokens.length > 0 && parent?.value.type === 'array') return;
    const found = locate(tree, pointer);
    if (found) inSpan(source, [found.value.offset, found.value.offset + found.value.length]);
  };
  if (op.op === 'remove') removed(text, op.path);
  if (op.op === 'replace') replaced(text, op.path, false);
  if (op.op === 'add' || op.op === 'copy') replaced(text, op.path, true);
  if (op.op === 'move') {
    removed(text, op.from);
    replaced(adapter.applyPatch(text, [{ op: 'remove', path: op.from }]), op.path, true);
  }
  return out;
}

// --- The property ------------------------------------------------------------------------------

describe('criterion 3: random documents × random patches', () => {
  for (const format of ['json', 'jsonc', 'json5'] as const) {
    it(`${format}: ${RUNS} runs, seed ${SEED}`, () => {
      const adapter = getAdapter(format);
      fc.assert(
        fc.property(
          dataArbitrary(format).map(plain),
          styleArbitrary,
          fc.gen(),
          (data, style, g) => {
            const input = printDocument(data, format, style, g);
            const parsed = adapter.parse(input);
            expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
            const steps = patchFor(parsed.data, g);
            const patch = steps.map((s) => s.op);

            if (steps.at(-1)?.fails) {
              // R9: the patch throws as a whole. The reference agrees on a failing `test`; it does
              // not throw for every path RFC 6901 says does not exist (e.g. a member of a string).
              if (patch.at(-1)!.op === 'test')
                expect(() => immutableJSONPatch(parsed.data, patch as JSONPatchDocument)).toThrow();
              expect(() => adapter.applyPatch(input, patch)).toThrow(PatchError);
              return;
            }

            // Rule 2: the data matches the reference.
            const output = adapter.applyPatch(input, patch);
            const result = adapter.parse(output);
            expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
            if (format === 'json') expect(() => JSON.parse(output) as unknown).not.toThrow();
            const expected = immutableJSONPatch(parsed.data, patch as JSONPatchDocument);
            if (!sameData(result.data, expected)) expect(result.data).toEqual(expected);

            // Comments outside removed, replaced and moved members survive byte-identical.
            const mayGo = new Set<string>();
            let text = input;
            for (const op of patch) {
              for (const c of exempt(format, text, op)) mayGo.add(c);
              text = adapter.applyPatch(text, [op]);
            }
            const kept = comments(input).filter(
              (c) => !mayGo.has(c.text) && !output.includes(c.text),
            );
            expect(
              kept.map((c) => c.text),
              `${JSON.stringify(patch)}\n${input}\n=>\n${output}`,
            ).toEqual([]);
          },
        ),
        { seed: SEED, numRuns: RUNS },
      );
    }, 300_000);
  }
});
