// Text-mode sync timing (003 T6, spec 003 criterion 9, plan 003 risk R2). vanilla-jsoneditor's text
// mode reports a typed change through `onChange` only once typing has paused for 300 ms, and at once
// when the editor loses focus: index.js@3.13.0 wraps its CodeMirror change handler in a debounce of
// 300 (`var mn=oe(sn,300)`) and calls `mn.flush()` from `onBlur`. App.svelte adds no delay of its
// own, so this is the interval after which typing reaches the host. tests/web/text-mode.spec.ts
// fails if a library update changes it.
export const TEXT_DEBOUNCE_MS = 300;
