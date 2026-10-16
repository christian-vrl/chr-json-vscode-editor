// Text-mode sync timing (003 T6, spec 003 criterion 9, plan 003 risk R2). vanilla-jsoneditor's text
// mode reports a typed change through `onChange` only once typing has paused for 300 ms, and at once
// when the editor loses focus: index.js@3.13.0 wraps its CodeMirror change handler in a debounce of
// 300 (`var mn=oe(sn,300)`) and calls `mn.flush()` from `onBlur`. App.svelte adds no delay of its
// own, so this is the interval after which typing reaches the host. tests/web/text-mode.spec.ts
// fails if a library update changes it.
export const TEXT_DEBOUNCE_MS = 300;

/**
 * Where offset `at` of `before` lands in `after`, read as one changed span: the text between their
 * common start and common end (003 T7 F2). Text mode hands the library a new document as one
 * replacement of the whole text, which would put the cursor at the top of the file after every
 * undo, redo or other change made outside the editor. An offset before the span stays, one after it
 * moves with the text after it, and one inside or touching it goes to the span's new end, as VS
 * Code's own text editor leaves the cursor after an undo or redo of typing.
 */
export function mapOffset(before: string, after: string, at: number): number {
  const shorter = Math.min(before.length, after.length);
  let start = 0;
  while (start < shorter && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let end = 0;
  while (
    end < shorter - start &&
    before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)
  ) {
    end++;
  }
  if (at < start) return at;
  if (at > before.length - end) return Math.min(at - before.length + after.length, after.length);
  return after.length - end;
}
