// Reference readings of JSON Lines (spec 012 §Terms, L1, L2, J1), independent of `packages/core`,
// so a typo in a hand-written case fails before the `jsonl` adapter exists (012 T2). Lines, blank
// lines, items and bad lines are read exactly as spec 012 §Terms defines them.

const BOM = '﻿';

export interface Line {
  /** 1-based line number. */
  number: number;
  /** UTF-16 offset of the line's first character (the BOM, on a first line that has one). */
  start: number;
  /** The line without its ending; a leading BOM included. */
  content: string;
  /** `'\n'`, `'\r\n'`, or `''` for a last line with no ending. */
  ending: string;
}

/** The lines of `text`: up to and including each LF, then the text after the last LF when it is not
 *  empty. A CR right before the LF belongs to the ending. */
export function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  while (start < text.length) {
    const lf = text.indexOf('\n', start);
    const end = lf < 0 ? text.length : lf;
    const cr = lf > start && text[lf - 1] === '\r';
    lines.push({
      number: lines.length + 1,
      start,
      content: text.slice(start, cr ? end - 1 : end),
      ending: lf < 0 ? '' : cr ? '\r\n' : '\n',
    });
    start = lf < 0 ? text.length : lf + 1;
  }
  return lines;
}

/** The line's text without a leading BOM: a BOM is never a value byte. */
const valueText = (line: Line) =>
  line.number === 1 && line.content.startsWith(BOM) ? line.content.slice(1) : line.content;

export const isBlank = (line: Line) => /^[ \t]*$/.test(valueText(line));

/** The value bytes of a non-blank line: its text without spaces and tabs around it. */
export const valueBytes = (line: Line) => valueText(line).replace(/^[ \t]+|[ \t]+$/g, '');

/** Whether a non-blank line holds exactly one RFC 8259 value. `JSON.parse` reads one RFC 8259
 *  value and allows white space around it; a CR inside the line (a lone CR) makes it bad. */
export function isGoodLine(line: Line): boolean {
  if (line.content.includes('\r')) return false;
  try {
    JSON.parse(valueBytes(line));
    return true;
  } catch {
    return false;
  }
}

export interface JsonlReading {
  lines: Line[];
  /** L1: the items of the lines that are not bad, in line order. */
  items: unknown[];
  /** The lines that hold an item, in order. */
  itemLines: Line[];
  /** 1-based numbers of the bad lines. */
  bad: number[];
}

export function readJsonl(text: string): JsonlReading {
  const lines = splitLines(text);
  const itemLines = lines.filter((line) => !isBlank(line) && isGoodLine(line));
  return {
    lines,
    items: itemLines.map((line) => JSON.parse(valueBytes(line)) as unknown),
    itemLines,
    bad: lines.filter((line) => !isBlank(line) && !isGoodLine(line)).map((line) => line.number),
  };
}

/** L1's diagnostics: one error per bad line, spanning the line without its ending. */
export function badLineDiagnostics(text: string) {
  return splitLines(text)
    .filter((line) => !isBlank(line) && !isGoodLine(line))
    .map((line) => ({
      severity: 'error',
      message: `Line ${line.number} is not valid JSON.`,
      offset: line.start,
      length: line.content.length,
    }));
}

/** L2: the first line ending (`\n` when there is none), and whether the text ends with one (true
 *  for an empty text). */
export function jsonlStyle(text: string): { eol: string; finalNewline: boolean } {
  const first = /\r?\n/.exec(text);
  return { eol: first ? first[0] : '\n', finalNewline: text === '' || text.endsWith('\n') };
}

/** J1 written out: `[` + eol + each item's value bytes indented by two spaces, joined by `,` + eol,
 *  then eol + `]` + eol; `[]` + eol with no item; a leading BOM kept. */
export function j1(text: string): string {
  const { eol } = jsonlStyle(text);
  const bom = text.startsWith(BOM) ? BOM : '';
  const items = readJsonl(text).itemLines.map((line) => `  ${valueBytes(line)}`);
  return items.length === 0
    ? `${bom}[]${eol}`
    : `${bom}[${eol}${items.join(`,${eol}`)}${eol}]${eol}`;
}

/** A JSON text with every white-space character between tokens removed (002 R12 for strict JSON). */
export function compactJson(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (!/[ \t\r\n]/.test(text[i]!)) {
      out += text[i];
    }
  }
  return out;
}
