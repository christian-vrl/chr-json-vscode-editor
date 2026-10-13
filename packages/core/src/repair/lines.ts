// Repair Lines (spec 012 L10, 012 T3): a JSON Lines text with each bad line repaired where it can
// be. Each maximal run of consecutive bad lines is first read as one value: a pretty-printed record
// becomes one line. Otherwise each line of the run is repaired alone by `repair` (the 002 T11
// engine, `jsonrepair`). A repaired value is written as 002 R12 compacts it (tokens kept); a line
// that does not give one value stays as it is and is listed in `unrepaired`. Line endings, blank
// lines and the other lines are unchanged.
import { compact } from '../formats/actions.js';
import { openJson } from '../formats/jsonc-adapter.js';
import { classify, split, type Line } from '../formats/jsonl-adapter.js';
import { PatchError } from '../formats/types.js';
import { repair } from './repair.js';

export interface RepairLinesResult {
  /** The repaired text; the input itself when it has no bad line. */
  text: string;
  /** 1-based numbers, in `text`, of the bad lines left (README JSON Lines reading 6). */
  unrepaired: number[];
}

export function repairLines(text: string): RepairLinesResult {
  const { bom, lines } = split(text);
  if (!lines.some((line) => line.kind === 'bad')) return { text, unrepaired: [] };
  const out: Line[] = [];
  const unrepaired: number[] = [];
  for (let i = 0; i < lines.length;) {
    if (lines[i]!.kind !== 'bad') {
      out.push(lines[i++]!);
      continue;
    }
    let end = i;
    while (end < lines.length && lines[end]!.kind === 'bad') end++;
    const run = lines.slice(i, end);
    // The run's text with the line endings inside it: one value, when it is a pretty-printed record.
    const whole = oneLine(
      run.map((line, k) => line.text + (k < run.length - 1 ? line.ending : '')).join(''),
    );
    if (whole !== undefined) {
      out.push({ text: whole, ending: run.at(-1)!.ending, kind: 'item' });
    } else {
      for (const line of run) {
        const repaired = oneLine(repairedLine(line.text));
        if (repaired === undefined) {
          unrepaired.push(out.length + 1);
          out.push(line);
        } else {
          out.push({ ...line, text: repaired, kind: 'item' });
        }
      }
    }
    i = end;
  }
  return { text: bom + out.map((line) => line.text + line.ending).join(''), unrepaired };
}

/** `text` compacted as R12 compacts it when it is exactly one RFC 8259 value that fits on a line;
 *  `undefined` otherwise. */
function oneLine(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  try {
    JSON.parse(text);
  } catch {
    return undefined;
  }
  const line = compact(text, openJson);
  return classify(line).kind === 'item' ? line : undefined;
}

/** `text` repaired by core's repair as a JSON document, or `undefined` when it cannot be. */
function repairedLine(text: string): string | undefined {
  try {
    return repair(text, 'json').text;
  } catch (error) {
    if (error instanceof PatchError) return undefined;
    throw error;
  }
}
