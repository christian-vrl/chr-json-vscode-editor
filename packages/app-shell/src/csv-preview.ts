// What a host sends the CSV panel for its preview (plan 009 §Approach): the first 100 rows, so the
// preview stays fast at any size. Plain TypeScript with no DOM, for the dev host here and the
// extension host (009 T4).

/** Rows the preview shows (spec 009 criterion 6). */
export const CSV_PREVIEW_ROWS = 100;

/** The preview's row source: the first 100 items of an array, any other value as it is (X1 decides
 *  whether it exports). */
export function previewRows(data: unknown): unknown {
  return Array.isArray(data) && data.length > CSV_PREVIEW_ROWS
    ? data.slice(0, CSV_PREVIEW_ROWS)
    : data;
}

/** The candidate delimiters of I3, each read by its own scanner below. */
const DELIMITERS = [',', ';', '\t', '|'].map((d) => d.charCodeAt(0));

const QUOTE = 0x22;
const CR = 0x0d;
const LF = 0x0a;

/**
 * The start of a CSV `text` that holds its first 100 rows whatever options the panel shows: it
 * ends at the first line end where at least 101 non-empty records (a header and 100 rows) are done
 * when read with each delimiter of I3, and where none of those readings is inside a quoted field.
 * So `csvToJson` on it gives the same first 100 rows as on the whole text, with the same warnings
 * and errors for the records it holds, whichever delimiter and header setting is chosen. Without
 * such a line end, it is the whole text.
 *
 * Errors in the records past the cut show only in the full import, which the host runs when a
 * button writes: a quote left open after the 100th row, and I5's cap on the `null` items filled in
 * for missing array indices, which counts over every row of the import (UNK-063), so rows past the
 * cut can take it over the limit when the first 100 do not. The page shows such an error from the
 * host's answer (Csv.svelte, `runError`).
 *
 * Each reading follows I2 as core's reader does (csvToJson.ts `readRecords`): a quote opens a
 * quoted field only at the start of a field, `""` inside it is a quote, and text after the closing
 * quote is plain text up to the next delimiter or line end. Empty lines are not counted: they are
 * skipped as rows when there is more than one field name (I2), and the panel shows 100 rows at most.
 */
export function csvPreviewText(text: string): { text: string; complete: boolean } {
  const records = CSV_PREVIEW_ROWS + 1;
  const readings = DELIMITERS.map((delimiter) => ({
    delimiter,
    inQuotes: false,
    fieldStart: true,
    /** The character just read was the first of a `""` inside a quoted field. */
    escaped: false,
    /** Whether the current record has any character (an empty line has none). */
    content: false,
    done: 0,
  }));
  const length = text.length;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < length; i++) {
    const c = text.charCodeAt(i);
    const lineEnd = c === CR || c === LF;
    let allAtEnd = lineEnd;
    for (const r of readings) {
      if (r.escaped) {
        r.escaped = false;
      } else if (r.inQuotes) {
        if (c === QUOTE) {
          if (text.charCodeAt(i + 1) === QUOTE) r.escaped = true;
          else r.inQuotes = false;
        } else if (lineEnd) {
          allAtEnd = false;
        }
      } else if (lineEnd) {
        if (r.content) r.done++;
        r.content = false;
        r.fieldStart = true;
      } else {
        r.content = true;
        if (c === QUOTE && r.fieldStart) r.inQuotes = true;
        r.fieldStart = c === r.delimiter;
      }
    }
    if (!lineEnd) continue;
    // CR LF is one line end. A reading inside quotes reads the LF as text, which changes nothing.
    if (c === CR && text.charCodeAt(i + 1) === LF) i++;
    if (allAtEnd && readings.every((r) => r.done >= records)) {
      return { text: text.slice(0, i + 1), complete: i + 1 >= length };
    }
  }
  return { text, complete: true };
}
