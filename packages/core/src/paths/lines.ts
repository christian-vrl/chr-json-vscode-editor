// JSON Lines items in the two editors (018 T4, UNK-090): A5 counts every non-blank line as an
// item, a bad one too, while the CHR JSON Editor's table and tree leave bad lines out of their items
// (spec 012 L1). These translate a path's first step between the two counts.
import { readLines } from '../formats/jsonl-adapter.js';
import type { Path } from './text.js';

/**
 * The item indices, as A5 counts items (every non-blank line, a bad one too), of a JSON Lines
 * text's bad lines: `bad`, their 1-based line numbers (`readLines`, read here when not given).
 */
export function badItems(text: string, bad: readonly number[] = readLines(text).bad): number[] {
  if (bad.length === 0) return [];
  const items: number[] = [];
  let next = 0;
  let item = 0;
  let start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (let line = 1; next < bad.length; line++) {
    const lf = text.indexOf('\n', start);
    const end = lf < 0 ? text.length : lf;
    if (line === bad[next]) {
      items.push(item);
      next++;
    }
    // A CR is the line ending only before a LF (spec 012 §Terms), as A5 reads it.
    const content = lf >= 0 && text.charCodeAt(end - 1) === 13 ? end - 1 : end;
    if (!/^[ \t]*$/.test(text.slice(start, content))) item++;
    if (lf < 0) break;
    start = lf + 1;
  }
  return items;
}

/** A text editor path in JSON Lines as the CHR JSON Editor's table names it: the item's row
 *  leaves out the bad lines before it. */
export function tablePath(path: Path, bad: readonly number[]): Path {
  const [first, ...rest] = path;
  if (typeof first !== 'number') return path;
  return [first - bad.filter((b) => b < first).length, ...rest];
}

/** A path of the CHR JSON Editor's table in JSON Lines as the text names it (A5): the row's item
 *  counts the bad lines before it. */
export function textPath(path: Path, bad: readonly number[]): Path {
  const [first, ...rest] = path;
  if (typeof first !== 'number') return path;
  let item = first;
  for (const b of bad) if (b <= item) item++;
  return [item, ...rest];
}
