// 010 T2 gate, spec 010 criteria 3–6, over 10 000 documents per format (seed committed in
// `arbitraries.ts`) and every golden input of specs 002, 006 and 010. Documents are the 002
// generator's (`printDocument`: comments in every tagged place, single-line and multi-line
// containers, every indent unit, both line endings, with or without a final newline), on data
// that smart format lays out in each of its ways (tables whose rows list their keys in different
// orders, long number arrays, matrices, long strings), with JSON5-only syntax (`json5Only`),
// multi-line block comments (some with empty lines), line comments holding `*/` or ending in white
// space, a BOM, and `.json` files with comments and trailing commas (warnings).
// The checks restate the criteria from the spec, not from `smart-format.ts`:
// - 3: the output parses with no error in the same format and holds the same data (`-0` and
//   `__proto__` keys included); the kept tokens (all but white space, line breaks and commas) are
//   the input's in order, byte for byte, except the leading white space of a multi-line block
//   comment's later lines; a container ends with a trailing comma exactly when it had one and its
//   closing bracket starts a line (UNK-046, README reading 7), never in json.
// - 4: smart-formatting the output changes nothing.
// - 5: the BOM, line ending and final line ending are the input's; every line is indented in the
//   input's unit (2 spaces with no line break), plus only spaces that right-align a number.
// - 6: a line over 120 columns (a tab counted as 4) holds at most one key and one scalar value.
import { readdirSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { detectStyle, getAdapter, smartFormat, type Format, type Style } from '../src/index.js';
import { parseJson5 } from '../src/formats/json5-parser.js';
import { isComment, Kind, tokenize, type Token } from '../src/formats/tokens.js';
import { dataArbitrary, SEED, styleArbitrary } from './arbitraries.js';
import { json5Only } from './json5-only.js';
import { printDocument } from './print-document.js';

const RUNS = 10_000;
const FORMATS: Format[] = ['json', 'jsonc', 'json5'];

type Gen = fc.GeneratorValue;

const tokensOf = (text: string, format: Format): Token[] =>
  format === 'json5' ? parseJson5(text).tokens : tokenize(text);
const slice = (text: string, t: Token) => text.slice(t.offset, t.end);
const withoutBom = (text: string) => (text.startsWith('\uFEFF') ? text.slice(1) : text);

// ---- Data smart format lays out in each of its ways.

/** An object with own enumerable members, `__proto__` included. */
function toObject(entries: [string, unknown][]): Record<string, unknown> {
  const object: Record<string, unknown> = {};
  for (const [key, value] of entries)
    Object.defineProperty(object, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  return object;
}

const KEYS = ['id', 'name', 'x', 'y', '__proto__', 'tags', 'pos', 'a b'];

function layoutData(format: Format): fc.Arbitrary<unknown> {
  const number = fc.oneof(
    fc.integer({ min: -1000, max: 100_000 }),
    fc.double({ min: -1e6, max: 1e6, noNaN: true }),
    fc.constantFrom(0, -0, 1.5, 10.25, 1e21),
    ...(format === 'json5' ? [fc.constantFrom(Infinity, -Infinity, NaN)] : []),
  );
  const short = fc.oneof(
    fc.constantFrom('Ann', 'Bob', 'Christopher', '', 'ünï', '日本'),
    fc.string({ maxLength: 8 }),
  );
  const cell = fc.oneof(
    number,
    short,
    fc.boolean(),
    fc.constant(null),
    fc.array(number, { maxLength: 3 }),
    fc
      .shuffledSubarray(['p', 'q', 'r'], { minLength: 1 })
      .chain((keys) =>
        fc.tuple(...keys.map(() => number)).map((v) => toObject(keys.map((k, i) => [k, v[i]]))),
      ),
  );
  const row = (keys: string[]) =>
    fc.tuple(...keys.map(() => cell)).map((v) => toObject(keys.map((k, i) => [k, v[i]])));
  // Rows over one key list, in one order or each in its own (UNK-045).
  const table = fc
    .tuple(
      fc.shuffledSubarray(KEYS, { minLength: 1, maxLength: 5 }),
      fc.boolean(),
      fc.integer({ min: 2, max: 6 }),
    )
    .chain(([keys, sameOrder, n]) =>
      fc.array(
        sameOrder
          ? row(keys)
          : fc.shuffledSubarray(keys, { minLength: 1 }).chain((own) => row(own)),
        { minLength: n, maxLength: n },
      ),
    );
  const numbers = fc.array(number, { minLength: 5, maxLength: 60 });
  const matrix = fc.array(fc.array(number, { minLength: 3, maxLength: 3 }), {
    minLength: 2,
    maxLength: 5,
  });
  const long = fc.string({ minLength: 40, maxLength: 140 });
  const part = fc.oneof(dataArbitrary(format), table, numbers, matrix, long, cell);
  const key = fc.oneof(
    fc.constantFrom(...KEYS, 'aVeryLongPropertyNameIndeed'),
    fc.string({ maxLength: 6 }),
  );
  return fc.oneof(
    part,
    fc.uniqueArray(fc.tuple(key, part), { maxLength: 6, selector: ([k]) => k }).map(toObject),
    fc.array(part, { maxLength: 4 }),
  );
}

// ---- Documents.

/** Some comments of `text` changed in ways FracturedJson reads badly: a `/* cN *\/` spanning
 *  several lines (later lines indented, sometimes with an empty or blank line), a `// cN` holding
 *  `*\/` or ending in white space. */
function oddComments(text: string, eol: string, g: Gen): string {
  return text
    .replace(/\/\* (c\d+) \*\//g, (all, name: string) => {
      const roll = g(fc.integer, { min: 1, max: 6 });
      if (roll === 1) return `/* ${name}${eol}${' '.repeat(g(fc.nat, 6))}more */`;
      if (roll === 2) return `/* ${name}${eol}${eol}  ${eol}more${eol}${eol} */`;
      return all;
    })
    .replace(/\/\/ (c\d+)/g, (all, name: string) => {
      const roll = g(fc.integer, { min: 1, max: 6 });
      if (roll === 1) return `// ${name} ends */ here`;
      if (roll === 2) return `// ${name}  \t`;
      return all;
    });
}

function sourceDocument(format: Format, data: unknown, style: Style, g: Gen): string {
  // A `.json` file with comments or trailing commas reads with warnings (spec 002 §Scope), so
  // some json documents are printed as JSONC.
  const printed = format === 'json' && g(fc.integer, { min: 1, max: 4 }) === 1 ? 'jsonc' : format;
  let text = printDocument(data, printed, style, g);
  if (format === 'json5' && g(fc.boolean)) text = json5Only(text, g);
  if (printed !== 'json') text = oddComments(text, style.eol, g);
  return g(fc.integer, { min: 1, max: 10 }) === 1 ? `\uFEFF${text}` : text;
}

// ---- The checks.

/** Kept tokens (criterion 3), a multi-line block comment's later lines trimmed at the start. */
function kept(text: string, format: Format): string[] {
  return tokensOf(text, format)
    .filter((t) => t.kind !== Kind.Whitespace && t.kind !== Kind.LineBreak && t.kind !== Kind.Comma)
    .map((t) =>
      t.kind === Kind.BlockComment
        ? slice(text, t)
            .split(/\r\n|\r|\n|\u2028|\u2029/)
            .map((l, i) => (i === 0 ? l : l.trimStart()))
            .join('\n')
        : slice(text, t),
    );
}

/** Per container, in order of its opening bracket: whether it ends with a comma, and whether its
 *  closing bracket is the first token on its line. */
function containers(tokens: readonly Token[]): { trailing: boolean; ownLine: boolean }[] {
  const found: { trailing: boolean; ownLine: boolean }[] = [];
  const open: number[] = [];
  let previous: Token | undefined;
  let lineStart = true;
  for (const t of tokens) {
    if (t.kind === Kind.LineBreak) lineStart = true;
    if (t.kind === Kind.Whitespace || t.kind === Kind.LineBreak) continue;
    if (t.kind === Kind.OpenBrace || t.kind === Kind.OpenBracket) {
      open.push(found.length);
      found.push({ trailing: false, ownLine: false });
    } else if (t.kind === Kind.CloseBrace || t.kind === Kind.CloseBracket) {
      const c = found[open.pop()!]!;
      c.trailing = previous?.kind === Kind.Comma;
      c.ownLine = lineStart;
    }
    lineStart = false;
    if (!isComment(t)) previous = t;
  }
  return found;
}

/** Each output line: its text, its first token, and the keys and scalar values that start on it. */
function lines(text: string, format: Format) {
  const tokens = tokensOf(text, format);
  const rows: { start: number; end: number; first?: Token; keys: number; scalars: number }[] = [];
  let row = {
    start: 0,
    end: text.length,
    first: undefined as Token | undefined,
    keys: 0,
    scalars: 0,
  };
  rows.push(row);
  const significant = tokens.filter(
    (t) => t.kind !== Kind.Whitespace && t.kind !== Kind.LineBreak && !isComment(t),
  );
  const isKey = new Set<Token>();
  significant.forEach((t, i) => {
    if (significant[i + 1]?.kind === Kind.Colon) isKey.add(t);
  });
  for (const t of tokens) {
    if (t.kind === Kind.LineBreak) {
      row.end = t.offset;
      row = { start: t.end, end: text.length, first: undefined, keys: 0, scalars: 0 };
      rows.push(row);
      continue;
    }
    if (t.kind !== Kind.Whitespace && row.first === undefined) row.first = t;
    if (isKey.has(t)) row.keys++;
    else if (
      t.kind === Kind.StringLiteral ||
      t.kind === Kind.NumericLiteral ||
      t.kind === Kind.TrueKeyword ||
      t.kind === Kind.FalseKeyword ||
      t.kind === Kind.NullKeyword
    )
      row.scalars++;
  }
  return rows.map((r) => ({ ...r, text: text.slice(r.start, r.end) }));
}

function check(input: string, format: Format): void {
  const adapter = getAdapter(format);
  const before = adapter.parse(withoutBom(input));
  // Criterion 5: a text with no value (empty, white space or comments only) comes back unchanged.
  const noValue = tokensOf(withoutBom(input), format).every(
    (t) => t.kind === Kind.Whitespace || t.kind === Kind.LineBreak || isComment(t),
  );
  if (noValue) {
    expect(smartFormat(input, format)).toBe(input);
    return;
  }
  if (before.diagnostics.some((d) => d.severity === 'error')) {
    expect(() => smartFormat(input, format)).toThrow();
    return;
  }
  const out = smartFormat(input, format);
  const body = withoutBom(out);

  // Criterion 3.
  const after = adapter.parse(body);
  expect(after.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  expect(isDeepStrictEqual(after.data, before.data)).toBe(true);
  expect(kept(body, format)).toEqual(kept(withoutBom(input), format));
  const had = containers(tokensOf(withoutBom(input), format));
  const now = containers(tokensOf(body, format));
  expect(now.length).toBe(had.length);
  now.forEach((c, i) => {
    expect(c.trailing, `container ${i}`).toBe(format !== 'json' && had[i]!.trailing && c.ownLine);
  });

  // Criterion 4.
  expect(smartFormat(out, format)).toBe(out);

  // Criterion 5.
  expect(out.startsWith('\uFEFF')).toBe(input.startsWith('\uFEFF'));
  const style = detectStyle(withoutBom(input), format);
  expect(body.endsWith('\n')).toBe(style.finalNewline);
  const breaks = tokensOf(body, format).filter((t) => t.kind === Kind.LineBreak);
  for (const b of breaks) expect(slice(body, b)).toBe(style.eol);
  // Every line is indented in the unit, then only spaces that align it with its neighbours; and
  // reading the output's style gives the same unit back.
  const unit = style.indent === '\t' ? '\t' : ' '.repeat(style.indent);
  let indented = false;
  for (const line of lines(body, format)) {
    if (line.first === undefined) {
      expect(line.text.trim(), 'a blank line').toBe('');
      continue;
    }
    // A line that starts inside a multi-line comment or string is not indented by the layout.
    if (line.first.offset < line.start) continue;
    const indent = line.text.slice(0, line.first.offset - line.start);
    if (indent !== '') indented = true;
    expect(
      indent.split(unit).join('').replace(/^ +$/, ''),
      `indent of ${JSON.stringify(line.text)}`,
    ).toBe('');
  }
  if (indented) expect(detectStyle(body, format).indent).toBe(style.indent);

  // Criterion 6.
  for (const line of lines(body, format)) {
    const width = line.text.replace(/\t/g, '    ').length;
    if (width > 120) {
      expect(line.keys <= 1 && line.scalars <= 1, `line of ${width}: ${line.text}`).toBe(true);
    }
  }
}

describe('smartFormat property suite (spec 010 criteria 3–6)', () => {
  for (const format of FORMATS) {
    it(`${format}: ${RUNS} runs, seed ${SEED}`, () => {
      fc.assert(
        fc.property(layoutData(format), styleArbitrary, fc.gen(), (data, style, g) => {
          check(sourceDocument(format, data, style, g), format);
        }),
        { seed: SEED, numRuns: RUNS },
      );
    }, 600_000);
  }

  // Every golden input of specs 002 (`tests/golden/<format>/<case>/input.<ext>`), 006
  // (`tests/golden/convert/<from>-to-<to>/<case>/input.<from>`) and 010.
  const root = new URL('../../../tests/golden/', import.meta.url);
  const inputs: [string, Format, string][] = [];
  const add = (dir: URL, format: Format, name: string) => {
    for (const c of readdirSync(dir, { withFileTypes: true })) {
      if (!c.isDirectory()) continue;
      const file = new URL(`${c.name}/input.${format}`, dir);
      try {
        inputs.push([`${name}/${c.name}`, format, readFileSync(file, 'utf8')]);
      } catch {
        // A case with no input in this format (a CSV or an error case).
      }
    }
  };
  for (const format of FORMATS) {
    add(new URL(`${format}/`, root), format, format);
    add(new URL(`smart-format/${format}/`, root), format, `smart-format/${format}`);
  }
  for (const pair of readdirSync(new URL('convert/', root))) {
    const from = pair.split('-to-')[0] as Format;
    add(new URL(`convert/${pair}/`, root), from, `convert/${pair}`);
  }

  it('finds the golden inputs of 002, 006 and 010', () => {
    expect(inputs.filter(([n]) => n.startsWith('convert/')).length).toBeGreaterThan(0);
    expect(inputs.filter(([n]) => n.startsWith('smart-format/')).length).toBeGreaterThan(0);
    expect(
      inputs.filter(([n]) => !n.includes('/') || /^json5?c?\//.test(n)).length,
    ).toBeGreaterThan(0);
  });

  it.each(inputs)('golden input %s', (_, format, text) => {
    check(text, format);
  });
});
