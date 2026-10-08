// Engine T (tagged whitespace) for comment-keeping repair (002 T11 spike, UNK-018).
//
// 1. Mask: replace each comment (scan.ts) with a whitespace tag that encodes its index: a frame of
//    k tabs, the index in binary as two-character bits ("  " = 0, " \t" = 1), and the frame again.
//    k is one more than the longest run of tabs in the input, so no tag can be confused with the
//    file's own whitespace.
// 2. Repair: jsonrepair copies whitespace between tokens through unchanged and escapes tabs inside
//    strings, so each tag reaches the output as written, wherever the repair moved it.
// 3. Re-anchor: find the tags in the output and write each comment back in place of its tag.
//    Linear in the file size; no diff.
// A tag that does not come back (jsonrepair dropped the whitespace it sat in) is reported as lost.
import { jsonrepair } from 'jsonrepair';
import { scan } from './scan.ts';

export interface RepairResult {
  text: string;
  /** Indices of comments whose tag did not survive the repair. */
  lost: number[];
}

const bitsOf = (n: number): string =>
  n
    .toString(2)
    .split('')
    .map((b) => (b === '1' ? ' \t' : '  '))
    .join('');

export function repairKeepingComments(text: string): RepairResult {
  const { comments, unclosed } = scan(text);
  let longestTabs = 0;
  for (const run of text.match(/\t+/g) ?? []) longestTabs = Math.max(longestTabs, run.length);
  const frame = '\t'.repeat(Math.max(2, longestTabs + 1));

  const parts: string[] = [];
  let at = 0;
  comments.forEach((c, n) => {
    parts.push(text.slice(at, c.start), frame + bitsOf(n) + frame);
    at = c.end;
  });
  parts.push(text.slice(at));
  const repaired = jsonrepair(parts.join(''));

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
function significantEnd(text: string, comments: { start: number; end: number }[]): number {
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
