// The last text each adapter parsed, and what parsing it gave (UNK-014). After every change the
// extension host parses the same text for the format badge, schema validation and the top-level
// `$schema` (004 T5 review F3), and the next edit parses it once more; each of those took a full
// parse of the document. With this cache the text is parsed once and every caller reuses it.
// One entry per adapter: a parse of a 50 MiB document holds about a gigabyte (bench/RESULTS.md),
// so the cache keeps only the newest text. Callers must not change what they get back.

/** `compute`, remembering the result for the last text it was called with. A text equal to that
 *  one returns the same result without computing it again. Nothing is kept when `compute` throws. */
export function lastText<T>(compute: (text: string) => T): (text: string) => T {
  let last: { text: string; value: T } | undefined;
  return (text) => {
    if (last?.text !== text) last = { text, value: compute(text) };
    return last.value;
  };
}
