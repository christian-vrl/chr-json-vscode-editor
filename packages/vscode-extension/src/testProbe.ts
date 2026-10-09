// What the webview's e2e test hook reports (003 T5; webview/testHooks.ts fills it, the extension
// host's hooks pass it to the e2e suite). Types only, shared by both sides.

/** What `probe` reports about the rendered webview. */
export interface RenderedProbe {
  /** The mode whose root element the library rendered, or null before the editor mounted. */
  mode: 'tree' | 'text' | 'table' | null;
  /** The mode the toolbar shows as pressed. */
  toolbarMode: string | null;
  /** The library sets `.jse-main { min-height: 150px }`; `0px` means its stylesheet did not apply. */
  mainMinHeight: string | null;
  /** The text the editor shows, from the mode's root element. */
  shownText: string;
  /** What the editor library holds: `{ text }` or `{ json }` (criterion 2). */
  content: { text: string } | { json: unknown } | null;
  /** The format label the toolbar shows (JSON, JSONC, JSON5). */
  format: string;
  /** The editor's notice line (edit errors, external changes over unsent edits). */
  notice: string;
  /** Text mode's parse error message (the library's `.jse-message.jse-error`), or null (003 T6). */
  errorMessage: string | null;
  /** Text mode's error markers drawn in the gutter: CodeMirror's `.cm-lint-marker-error` elements
   *  with a size and a colour, so a marker the CSP stopped from drawing does not count (003 T6). */
  errorMarkers: number;
  /** `securitypolicyviolation` events: directive, blocked URI, source location. */
  violations: string[];
  /** Inline validation marks (004 T5) in the mode shown: tree and table draw an icon at the node
   *  or cell (`path`, the RFC 6901 pointer of its `data-path`; null for a table row's gutter), and
   *  text mode underlines a range (`path` null, `text` the underlined text). */
  validationMarks: { path: string | null; severity: string; text: string }[];
  /** The toolbar's schema status: the dialect ("assumed draft-07"), and why it is not validated. */
  schemaStatus: string;
  /** `<style>` elements in the page: VS Code's own (`_defaultStyles`) and CodeMirror's, which
   *  must carry the nonce (UNK-029). */
  styleElements: { id: string; nonce: boolean }[];
}

/**
 * One step of the `dom` test hook (003 T8), run in the webview in order. Each step waits up to five
 * seconds for an element that matches `selector` and, when `text` is given, whose trimmed text
 * content is `text`.
 * - `click`: clicks it.
 * - `fill`: sets an input's or textarea's value and fires `input`, as typing would.
 * - `key`: fires `keydown` for `key` on it, with Ctrl or Shift held when asked.
 * - `waitFor`: only waits; with `gone`, until no element matches.
 * - `read`: reads its text content, or the attribute `attr`, into the hook's answer.
 */
export type DomStep =
  | { click: string; text?: string }
  | { fill: string; value: string }
  | { key: string; on: string; ctrl?: boolean; shift?: boolean }
  | { waitFor: string; text?: string; gone?: boolean }
  | { read: string; text?: string; attr?: string };
