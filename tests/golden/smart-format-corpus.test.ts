// Checks the smart-format corpus (010 T1) against facts that do not use core's format code or
// FracturedJson, so a slip in an expected file or a tag fails before `smartFormat` exists (010 T2
// runs criterion 1 on the same cases). A small scanner below reads all three formats.
// - Criterion 3 on expected: the data equals the input's (json5's `parse`, which reads JSON and
//   JSONC too); the kept tokens (everything but white space, line breaks and commas) are the
//   input's in the same order, each byte-identical, except the leading white space of a multi-line
//   block comment's later lines; json output parses with `JSON.parse` when the input did.
// - L6 (UNK-046): a container in expected ends with a trailing comma exactly when the same
//   container (by order of its opening bracket) had one in the input and is written on several
//   lines, its closing bracket starting a line (README reading 7); never in json.
// - Criterion 5 and L1, L2: a BOM exactly when the input has one; every line break is the input's;
//   a final line break exactly when the input has one; every line's indentation is made of the
//   input's indent unit (2 spaces for a one-line input), then only the spaces that right-align a
//   number at the start of a compact-array row.
// - Criterion 6: a line longer than 120 characters (a tab counted as the indent width, 4 for tab
//   indents) holds at most one key and one scalar value, plus comments.
// - Tags: `style`, `trailingComma`, `special` (json5's literal kinds, key-order and big numbers,
//   spec 015 criterion 1) and the
//   comment tags `none`, `with-warning`, `header`, `footer` and `multi-line-block` match the input.
//   The other comment tags and `layout` are checked by the Reviewer against expected.
import { isDeepStrictEqual } from 'node:util';
import JSON5 from 'json5';
import { describe, expect, it } from 'vitest';
import { hasBigNumber } from './facts.js';
import { loadSmartFormatCases, type SmartFormatCase } from './smart-format.js';

const cases = loadSmartFormatCases();

type Kind = 'punct' | 'string' | 'word' | 'line-comment' | 'block-comment' | 'space' | 'eol';
interface Token {
  kind: Kind;
  text: string;
  /** 0-based line the token starts on. */
  line: number;
}

/** Tokens of a JSON, JSONC or JSON5 text (a leading BOM left out), white space included. */
function scan(source: string): Token[] {
  const text = withoutBom(source);
  const tokens: Token[] = [];
  let line = 0;
  let i = 0;
  const push = (kind: Kind, end: number) => {
    const t = text.slice(i, end);
    tokens.push({ kind, text: t, line });
    line += t.split(/\r\n|\r|\n/).length - 1;
    i = end;
  };
  while (i < text.length) {
    const c = text[i]!;
    if ('{}[],:'.includes(c)) push('punct', i + 1);
    else if (c === '\r' || c === '\n') push('eol', text.startsWith('\r\n', i) ? i + 2 : i + 1);
    else if (c === ' ' || c === '\t') push('space', i + /^[ \t]*/.exec(text.slice(i))![0].length);
    else if (text.startsWith('//', i)) {
      const end = text.slice(i).search(/[\r\n]/);
      push('line-comment', end < 0 ? text.length : i + end);
    } else if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) throw new Error('block comment left open');
      push('block-comment', end + 2);
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c)
        j += text[j] === '\\' ? (text.startsWith('\r\n', j + 1) ? 3 : 2) : 1;
      if (j >= text.length) throw new Error('string left open');
      push('string', j + 1);
    } else {
      const end = text.slice(i).search(/[{}[\],:\s"'/]/);
      push('word', end < 0 ? text.length : i + end);
    }
  }
  return tokens;
}

const withoutBom = (text: string) => (text.startsWith('\uFEFF') ? text.slice(1) : text);
const isTrivia = (t: Token) =>
  t.kind === 'space' || t.kind === 'eol' || t.kind === 'line-comment' || t.kind === 'block-comment';
const isComment = (t: Token) => t.kind === 'line-comment' || t.kind === 'block-comment';
const isValue = (t: Token) => t.kind === 'string' || t.kind === 'word';

/** Kept tokens (criterion 3), with a multi-line block comment's later lines trimmed at the start. */
const kept = (tokens: Token[]) =>
  tokens
    .filter((t) => t.kind !== 'space' && t.kind !== 'eol' && t.text !== ',')
    .map((t) =>
      t.kind === 'block-comment'
        ? t.text
            .split(/\r\n|\r|\n/)
            .map((l, i) => (i === 0 ? l : l.trimStart()))
            .join('\n')
        : t.text,
    );

/** Per container, in order of its opening bracket: whether it ends with a trailing comma, and
 *  whether it is written on several lines: its closing bracket starts a line (README reading 7). */
function containers(tokens: Token[]): { trailing: boolean; multiLine: boolean }[] {
  const found: { trailing: boolean; multiLine: boolean }[] = [];
  const open: number[] = [];
  let previous: Token | undefined;
  let lineStart = true;
  for (const t of tokens) {
    if (t.kind === 'eol') lineStart = true;
    if (t.kind === 'space' || t.kind === 'eol') continue;
    if (t.text === '{' || t.text === '[') {
      open.push(found.length);
      found.push({ trailing: false, multiLine: false });
    } else if (t.text === '}' || t.text === ']') {
      const c = found[open.pop()!]!;
      c.trailing = previous?.text === ',';
      c.multiLine = lineStart;
    }
    lineStart = false;
    if (!isComment(t)) previous = t;
  }
  return found;
}

/** Lines of `text` (BOM left out) with the token kinds that start on each. */
function lines(text: string): { text: string; tokens: Token[]; continues: boolean }[] {
  const tokens = scan(text);
  const rows = withoutBom(text)
    .split(/\r\n|\r|\n/)
    .map((t) => ({ text: t, tokens: [] as Token[], continues: false }));
  for (const t of tokens) {
    rows[t.line]!.tokens.push(t);
    const breaks = t.text.split(/\r\n|\r|\n/).length - 1;
    // A line that starts inside a multi-line string or block comment.
    if (t.kind !== 'eol') for (let k = 1; k <= breaks; k++) rows[t.line + k]!.continues = true;
  }
  return rows;
}

const eolOf = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n');

/** The input's indent unit as the style tag names it. */
function indentTag(c: SmartFormatCase): string {
  return c.tags.style.find((s) => s.startsWith('indent-') || s === 'one-line-input')!;
}
const unitOf = (tag: string) => (tag === 'indent-tab' ? '\t' : tag === 'indent-4' ? '    ' : '  ');

describe.each(cases)('smart-format case $format/$name', (c) => {
  const input = scan(c.input);
  const expected = scan(c.expected);

  it('keeps the data and every kept token, in order (criterion 3)', () => {
    expect(
      isDeepStrictEqual(JSON5.parse(withoutBom(c.expected)), JSON5.parse(withoutBom(c.input))),
    ).toBe(true);
    expect(kept(expected)).toEqual(kept(input));
    if (c.format === 'json' && !input.some(isComment)) {
      expect(() => JSON.parse(withoutBom(c.expected)) as unknown).not.toThrow();
    }
  });

  it('has a trailing comma only where the input had one and the container is multi-line (L6)', () => {
    const before = containers(input);
    const after = containers(expected);
    expect(after.length).toBe(before.length);
    after.forEach((container, i) => {
      const want = c.format !== 'json' && before[i]!.trailing && container.multiLine;
      expect(container.trailing, `container ${i}`).toBe(want);
    });
  });

  it("keeps the input's BOM, line breaks, final newline and indent unit (criterion 5)", () => {
    expect(c.expected.startsWith('\uFEFF')).toBe(c.input.startsWith('\uFEFF'));
    const eol = eolOf(c.input);
    expect(expected.filter((t) => t.kind === 'eol').every((t) => t.text === eol)).toBe(true);
    expect(/(\r\n|\n)$/.test(c.expected)).toBe(/(\r\n|\n)$/.test(c.input));
    const unit = unitOf(indentTag(c));
    for (const row of lines(c.expected)) {
      if (row.continues) continue;
      // Whole units, then only the spaces that right-align a number in a column (§Layout).
      const [, units, pad] = new RegExp(`^((?:${unit})*)([ \\t]*)`).exec(row.text)!;
      const aligned =
        /^ *$/.test(pad!) && /^[+-]?[\d.]/.test(row.text.slice(units!.length + pad!.length));
      expect(pad === '' || aligned, JSON.stringify(row.text)).toBe(true);
    }
  });

  it('puts at most one key and one scalar on a line longer than 120 (criterion 6)', () => {
    const width = indentTag(c) === 'indent-tab' ? 4 : unitOf(indentTag(c)).length;
    for (const row of lines(c.expected)) {
      if (row.text.replaceAll('\t', ' '.repeat(width)).length <= 120) continue;
      const significant = row.tokens.filter((t) => !isTrivia(t));
      const keys = significant.filter((t, i) => isValue(t) && significant[i + 1]?.text === ':');
      const scalars = significant.filter((t) => isValue(t) && !keys.includes(t));
      expect(keys.length <= 1 && scalars.length <= 1, row.text).toBe(true);
    }
  });

  it('has style tags that match the input', () => {
    const facts: [string, boolean][] = [
      ['bom', c.input.startsWith('\uFEFF')],
      ['crlf', c.input.includes('\r\n')],
      ['no-final-newline', !/(\r\n|\n)$/.test(c.input)],
      ['one-line-input', !/[\r\n]/.test(c.input.replace(/(\r\n|\n)$/, ''))],
    ];
    for (const [tag, fact] of facts) expect(c.tags.style.includes(tag), tag).toBe(fact);
    const tag = indentTag(c);
    if (tag !== 'one-line-input') {
      const indents = lines(c.input)
        .filter((row) => !row.continues)
        .map((row) => /^[ \t]*/.exec(row.text)![0])
        .filter((indent) => indent !== '');
      const unit = unitOf(tag);
      expect(indents).toContain(unit);
      expect(indents.every((indent) => indent.split(unit).join('') === '')).toBe(true);
    }
  });

  it('has comment, trailing comma and special tags that match the input', () => {
    const comments = input.filter(isComment);
    expect(c.tags.comments.includes('none')).toBe(comments.length === 0);
    if (c.format === 'json') {
      expect(c.tags.comments.includes('with-warning')).toBe(comments.length > 0);
    } else {
      const significant = input.filter((t) => !isTrivia(t));
      const first = input.indexOf(significant[0]!);
      const last = input.indexOf(significant.at(-1)!);
      const facts: [string, boolean][] = [
        ['header', input.slice(0, first).some(isComment)],
        ['footer', input.slice(last).some(isComment)],
        [
          'multi-line-block',
          comments.some((t) => t.kind === 'block-comment' && /[\r\n]/.test(t.text)),
        ],
      ];
      for (const [tag, fact] of facts) expect(c.tags.comments.includes(tag), tag).toBe(fact);
    }
    expect(c.tags.trailingComma === 'yes').toBe(containers(input).some((x) => x.trailing));

    const significant = input.filter((t) => !isTrivia(t));
    const words = significant.filter((t) => t.kind === 'word').map((t) => t.text);
    const strings = significant.filter((t) => t.kind === 'string').map((t) => t.text);
    const specials: [string, boolean][] = [
      ['key-order', hasKeyOrderRows(JSON5.parse(withoutBom(c.input)))],
      ['big-number', words.some(hasBigNumber)],
      [
        'unquoted-key',
        significant.some((t, i) => t.kind === 'word' && significant[i + 1]?.text === ':'),
      ],
      ['single-quote', strings.some((s) => s.startsWith("'"))],
      ['hex', words.some((w) => /^[+-]?0[xX]/.test(w))],
      ['infinity-nan', words.some((w) => /^[+-]?(Infinity|NaN)$/.test(w))],
      ['plus-sign', words.some((w) => w.startsWith('+'))],
      ['leading-dot', words.some((w) => /^[+-]?\./.test(w))],
      ['line-continuation', strings.some((s) => /\\(\r\n|\r|\n)/.test(s))],
    ];
    for (const [tag, fact] of specials) expect(c.tags.special.includes(tag), tag).toBe(fact);
    expect(c.tags.special.includes('none')).toBe(!specials.some(([, fact]) => fact));
  });
});

/** UNK-045's case: two objects in one container that list shared keys in different orders. */
function hasKeyOrderRows(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const children = Object.values(value);
  const rows = children.filter(
    (v): v is object => typeof v === 'object' && v !== null && !Array.isArray(v),
  );
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const b = Object.keys(rows[j]!);
      const shared = Object.keys(rows[i]!).filter((k) => b.includes(k));
      if (
        !isDeepStrictEqual(
          shared,
          b.filter((k) => shared.includes(k)),
        )
      )
        return true;
    }
  }
  return children.some(hasKeyOrderRows);
}
