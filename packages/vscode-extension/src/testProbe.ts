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
 * - `mousedown`: presses and releases the left button on it (the tree selects a node on press).
 * - `waitFor`: only waits; with `gone`, until no element matches.
 * - `read`: reads its text content, or the attribute `attr`, into the hook's answer.
 * - `readAll`: reads the trimmed text content of every match, as one JSON array of strings.
 * - `select`: picks the option `value` of a `<select>` and fires `change`, as a person would.
 */
export type DomStep =
  | { click: string; text?: string }
  | { fill: string; value: string }
  | { key: string; on: string; ctrl?: boolean; shift?: boolean }
  | { mousedown: string; text?: string }
  | { waitFor: string; text?: string; gone?: boolean }
  | { read: string; text?: string; attr?: string }
  | { readAll: string }
  | { select: string; value: string };

/** What the compare panel's `probe` reports about its page (007 T4, compareTestHooks.ts). */
export interface ComparePageProbe {
  /** The toolbar's counter: "3 differences", "Difference 1 of 3 differences", "No differences in
   *  the data", or why nothing was compared. */
  counter: string;
  left: ComparePanelSideProbe;
  right: ComparePanelSideProbe;
  /** The library sets `.jse-main { min-height: 150px }`; `0px` means its stylesheet did not apply. */
  mainMinHeight: string | null;
  /** `securitypolicyviolation` events: directive, blocked URI, source location. */
  violations: string[];
  /** `<style>` elements in the page, as in RenderedProbe. */
  styleElements: { id: string; nonce: boolean }[];
}

export interface ComparePanelSideProbe {
  /** The title above the side's panel. */
  name: string;
  /** The parse error shown instead of the side's tree, or null. */
  error: string | null;
  /** Whether the side's tree is rendered. */
  tree: boolean;
  /** Per difference class, the JSON Pointer of every rendered node that has it. */
  marks: Record<string, string[]>;
  /** The JSON Pointers of the selected nodes. */
  selected: string[];
  /** Whether the "Copy to …" button for this side is enabled. */
  canCopyInto: boolean;
}

/** What the CSV panel's `probe` reports about its page (009 T4, csvTestHooks.ts). */
export interface CsvPageProbe {
  /** The page's heading: "Export people.json to CSV", "Import people.csv". */
  heading: string;
  /** The status next to the buttons: rows and columns. */
  summary: string;
  /** Every option: its label and its value (a select's value, or "on"/"off"). */
  options: { label: string; value: string }[];
  /** Every action button, in order, and whether it is disabled. */
  buttons: { label: string; disabled: boolean }[];
  /** The export preview's CSV text, or null when none is shown. */
  csv: string | null;
  /** Whether the import preview's table is shown. */
  table: boolean;
  /** The error shown instead of the preview, or null. */
  error: string | null;
  /** The warnings listed under the preview. */
  warnings: string[];
  /** `securitypolicyviolation` events: directive, blocked URI, source location. */
  violations: string[];
  /** `<style>` elements in the page, as in RenderedProbe. */
  styleElements: { id: string; nonce: boolean }[];
}
