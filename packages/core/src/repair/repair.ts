// Repair that keeps comments (003 T8; UNK-018, decided by spike 002 T11, whose engine T this is:
// `spikes/repair-comments/engine-tagged.ts` and REPORT.md) and, in JSON5, JSON5-only values
// (UNK-028, owner decision).
//
// 1. Mask: each comment becomes a whitespace tag that encodes its index (a frame of k tabs, the
//    index in binary as two-character bits, "  " = 0 and " \t" = 1, and the frame again; k is one
//    more than the longest run of tabs in the input, so no tag can be confused with the file's own
//    whitespace). In JSON5, each literal jsonrepair would change becomes a placeholder string.
// 2. Repair with jsonrepair, which copies whitespace between tokens through unchanged, escapes
//    tabs inside strings and keeps valid strings as written, so each tag and placeholder reaches
//    the output wherever the repair moved it.
// 3. Restore each comment in place of its tag and each literal in place of its placeholder.
//
// Then the three checks the spike measured (REPORT.md §Consequences): the output parses in the
// file's format, its data equals the repair's without comments, and every comment is present.
// When the data differs, the result is the repair without comments and every comment is reported
// lost; a comment whose tag did not come back is reported lost too. The caller asks before
// writing a repair that loses comments (UNK-018's fallback).
import { jsonrepair } from 'jsonrepair';
import { diff } from '../diff.js';
import { getAdapter } from '../formats/adapters.js';
import { PatchError, type Format } from '../formats/types.js';
import { scan, type Span } from './scan.js';

export interface RepairResult {
  /** The repaired text; the input itself when it already parses. */
  text: string;
  /** The input's comments that are not in `text`, in input order. */
  lostComments: string[];
}

/** Repairs `text` as a document of `format`. Throws a `PatchError` when jsonrepair cannot. */
export function repair(text: string, format: Format): RepairResult {
  // jsonrepair would turn the lines into one array; JSON Lines has "Repair Lines" (spec 012 L10).
  if (format === 'jsonl') throw new PatchError('Repair JSON is not available for JSON Lines.');
  const adapter = getAdapter(format);
  if (parses(text, format)) return { text, lostComments: [] };
  const found = scan(text, format === 'json5');
  const placeholders = new Placeholders(text);

  const kept = repairMasked(text, found, placeholders);
  const plain = placeholders.restore(run(placeholders.mask(text, found.literals)), found.literals);
  if (plain === undefined || !parses(plain, format))
    throw new PatchError('cannot repair without changing JSON5 values');
  const all = found.comments.map((c) => c.text);
  if (
    kept === undefined ||
    !parses(kept.text, format) ||
    diff(adapter.parse(kept.text).data, adapter.parse(plain).data).length > 0
  )
    return { text: plain, lostComments: all };
  return { text: kept.text, lostComments: kept.lost.map((n) => all[n]!) };
}

function parses(text: string, format: Format): boolean {
  return !getAdapter(format)
    .parse(text)
    .diagnostics.some((d) => d.severity === 'error');
}

function run(text: string): string {
  try {
    return jsonrepair(text);
  } catch (error) {
    throw new PatchError(`cannot repair: ${(error as Error).message}`);
  }
}

/** Placeholder strings for protected literals: `"<open>n<close>"` with private-use characters
 *  that do not occur in the input. */
class Placeholders {
  private readonly open: string;
  private readonly close: string;

  constructor(text: string) {
    const free: string[] = [];
    for (let code = 0xe000; code <= 0xf8ff && free.length < 2; code++) {
      const c = String.fromCharCode(code);
      if (!text.includes(c)) free.push(c);
    }
    [this.open, this.close] = free as [string, string];
  }

  of(n: number): string {
    return `"${this.open}${n}${this.close}"`;
  }

  /** `text` with each literal replaced by its placeholder. */
  mask(text: string, literals: readonly Span[]): string {
    let out = '';
    let at = 0;
    literals.forEach((l, n) => {
      out += text.slice(at, l.start) + this.of(n);
      at = l.end;
    });
    return out + text.slice(at);
  }

  /** `text` with each placeholder replaced by its literal; undefined unless each one occurs
   *  exactly once (the repair took one apart, so a value would change). */
  restore(text: string, literals: readonly Span[]): string | undefined {
    if (literals.length === 0) return text;
    const pattern = new RegExp(`"${this.open}(\\d+)${this.close}"`, 'g');
    const seen = new Set<number>();
    const out = text.replace(pattern, (whole, n: string) => {
      const index = Number(n);
      const literal = literals[index];
      if (!literal || seen.has(index)) return whole;
      seen.add(index);
      return literal.text;
    });
    if (seen.size !== literals.length || out.includes(this.open)) return undefined;
    return out;
  }
}

const bitsOf = (n: number): string =>
  n
    .toString(2)
    .split('')
    .map((b) => (b === '1' ? ' \t' : '  '))
    .join('');

/** Engine T: the repair with comments restored at their tags, and the indices of comments whose
 *  tag did not survive. Undefined when a protected literal did not survive. */
function repairMasked(
  text: string,
  { comments, literals, unclosed }: ReturnType<typeof scan>,
  placeholders: Placeholders,
): { text: string; lost: number[] } | undefined {
  let longestTabs = 0;
  for (const run of text.match(/\t+/g) ?? []) longestTabs = Math.max(longestTabs, run.length);
  const frame = '\t'.repeat(Math.max(2, longestTabs + 1));

  // Comments and literals never overlap: the scanner skips strings and comments as a whole.
  const spans = [
    ...comments.map((span, n) => ({ span, mask: frame + bitsOf(n) + frame })),
    ...literals.map((span, n) => ({ span, mask: placeholders.of(n) })),
  ].sort((a, b) => a.span.start - b.span.start);
  let masked = '';
  let at = 0;
  for (const { span, mask } of spans) {
    masked += text.slice(at, span.start) + mask;
    at = span.end;
  }
  const repaired = placeholders.restore(run(masked + text.slice(at)), literals);
  if (repaired === undefined) return undefined;

  // A tag is frame, bits, frame. Bits never hold two tabs in a row, so frames are unambiguous.
  const tag = new RegExp(`${frame}((?:  | \\t)+)${frame}`, 'g');
  const lastSignificant = significantEnd(text, comments);
  const firstTail = comments.findIndex((c) => c.start >= lastSignificant);
  const seen = new Set<number>();
  const pieces: string[] = [];
  let length = 0;
  let tailAt = -1; // offset in the output where the first comment after the root value starts
  let from = 0;
  for (const m of repaired.matchAll(tag)) {
    const n = parseInt(m[1]!.replace(/ \t/g, '1').replace(/ {2}/g, '0'), 2);
    const comment = comments[n];
    if (!comment || seen.has(n)) continue;
    seen.add(n);
    const gap = repaired.slice(from, m.index);
    pieces.push(gap);
    length += gap.length;
    if (n === firstTail) tailAt = length;
    pieces.push(comment.text);
    length += comment.text.length;
    from = m.index + m[0].length;
  }
  pieces.push(repaired.slice(from));
  let out = pieces.join('');

  // Truncated input: jsonrepair appends the missing closing brackets after the last value, ahead
  // of the whitespace that holds any comments at the end of the file, which would move those
  // comments outside the root. The brackets jsonrepair added go after those comments instead.
  if (tailAt >= 0 && unclosed > 0) {
    const head = out.slice(0, tailAt).trimEnd();
    const added = Math.min(unclosed, countClosersBefore(head, head.length));
    const closers = head.slice(head.length - added);
    if (/^[\]}]+$/.test(closers)) {
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      const rest = head.slice(0, head.length - added) + out.slice(head.length);
      out = rest.trimEnd() + eol + closers + rest.slice(rest.trimEnd().length);
    }
  }
  const lost = comments.map((_c, n) => n).filter((n) => !seen.has(n));
  return { text: out, lost };
}

/** End of the last character that is neither whitespace nor part of a comment. */
function significantEnd(text: string, comments: readonly Span[]): number {
  let end = text.length;
  for (let c = comments.length - 1; ;) {
    while (end > 0 && /\s/.test(text[end - 1]!)) end--;
    const last = comments[c];
    if (last && last.end === end) {
      end = last.start;
      c--;
      continue;
    }
    return end;
  }
}

/** How many `]`/`}` (whitespace between them allowed) end `text` before `end`. */
function countClosersBefore(text: string, end: number): number {
  let n = 0;
  for (let k = end - 1; k >= 0; k--) {
    const ch = text[k]!;
    if (ch === ']' || ch === '}') n++;
    else if (!/\s/.test(ch)) break;
  }
  return n;
}
