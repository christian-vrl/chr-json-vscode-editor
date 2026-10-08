// Comment-keeping repair (002 T11 spike, UNK-018): mask comments, repair, re-anchor.
//
// 1. Mask: find every comment with a scanner that knows the string forms jsonrepair accepts
//    ("…", '…', “…”, ‘…’, and a string left open at the end of its line) and overwrite it with
//    spaces, keeping line breaks, so the masked text has the same length and line structure.
// 2. Repair: run jsonrepair on the masked text. jsonrepair copies whitespace through, so each
//    comment's run of spaces normally survives in its output.
// 3. Re-anchor: align masked text and repaired text with a character diff (Myers). A comment whose
//    placeholder survived intact is written back over it; otherwise it is inserted at the mapped
//    position of its start.
import { jsonrepair } from 'jsonrepair';

export interface Comment {
  start: number;
  end: number;
  text: string;
}

const DOUBLE_QUOTES = new Set(['"', '“', '”']);
const SINGLE_QUOTES = new Set(["'", '‘', '’']);

/** Every `//` and `/* *\/` comment outside strings, in order. */
export function scanComments(text: string): Comment[] {
  const comments: Comment[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    const closers = DOUBLE_QUOTES.has(ch) ? DOUBLE_QUOTES : SINGLE_QUOTES.has(ch) ? SINGLE_QUOTES : null;
    if (closers) {
      // A string ends at a closing quote of the same kind, or (left open) at the end of the line.
      i++;
      while (i < text.length && !closers.has(text[i]!) && text[i] !== '\n' && text[i] !== '\r') {
        i += text[i] === '\\' ? 2 : 1;
      }
      if (i < text.length && closers.has(text[i]!)) i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      let end = i + 2;
      while (end < text.length && text[end] !== '\n' && text[end] !== '\r') end++;
      comments.push({ start: i, end, text: text.slice(i, end) });
      i = end;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      const end = close < 0 ? text.length : close + 2;
      comments.push({ start: i, end, text: text.slice(i, end) });
      i = end;
      continue;
    }
    i++;
  }
  return comments;
}

/** Replaces each comment with spaces, keeping line breaks, so offsets and lines are unchanged. */
export function mask(text: string, comments: Comment[]): string {
  let out = '';
  let at = 0;
  for (const c of comments) {
    out += text.slice(at, c.start) + c.text.replace(/[^\r\n]/g, ' ');
    at = c.end;
  }
  return out + text.slice(at);
}

/**
 * Myers O(ND) diff. Returns, for each index of `a`, the index of `b` it is matched to, or -1 when
 * that character was deleted.
 */
export function align(a: string, b: string): Int32Array {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
          ? v[offset + k + 1]!
          : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  // Walk the trace backwards to recover the matched pairs.
  const map = new Int32Array(n).fill(-1);
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d]!;
    const k = x - y;
    const prevK =
      k === -d || (k !== d && vd[offset + k - 1]! < vd[offset + k + 1]!) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : vd[offset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      map[x] = y;
    }
    if (d > 0) {
      x = prevX;
      y = prevY;
    }
  }
  return map;
}

export interface RepairResult {
  text: string;
  /** Comments that could not be written back over their own placeholder and were inserted. */
  inserted: number;
}

/** Repairs `text` with jsonrepair and puts its comments back. Throws when jsonrepair does. */
export function repairKeepingComments(text: string): RepairResult {
  const comments = scanComments(text);
  const masked = mask(text, comments);
  const repaired = jsonrepair(masked);
  const map = align(masked, repaired);

  type Edit = { at: number; removeLength: number; insert: string };
  const edits: Edit[] = [];
  let inserted = 0;
  for (const c of comments) {
    const first = map[c.start]!;
    let intact = first >= 0;
    for (let i = c.start; intact && i < c.end; i++) intact = map[i] === first + (i - c.start);
    if (intact) {
      edits.push({ at: first, removeLength: c.end - c.start, insert: c.text });
      continue;
    }
    // Insert after the last surviving character before the comment.
    let i = c.start - 1;
    while (i >= 0 && map[i]! < 0) i--;
    const at = i < 0 ? 0 : map[i]! + 1;
    const lineComment = c.text.startsWith('//');
    const needsBreak = lineComment && repaired[at] !== '\n' && repaired[at] !== '\r';
    edits.push({ at, removeLength: 0, insert: c.text + (needsBreak ? '\n' : ' ') });
    inserted++;
  }
  // Apply from the end so earlier offsets stay valid; equal offsets keep comment order.
  let out = repaired;
  for (let e = edits.length - 1; e >= 0; e--) {
    const { at, removeLength, insert } = edits[e]!;
    out = out.slice(0, at) + insert + out.slice(at + removeLength);
  }
  return { text: out, inserted };
}
