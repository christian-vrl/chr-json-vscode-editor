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
  /** `securitypolicyviolation` events: directive, blocked URI, source location. */
  violations: string[];
  /** `<style>` elements in the page: VS Code's own (`_defaultStyles`) and CodeMirror's, which
   *  must carry the nonce (UNK-029). */
  styleElements: { id: string; nonce: boolean }[];
}
