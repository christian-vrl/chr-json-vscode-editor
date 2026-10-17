// UNK-091: a click that closes its own webview ("Open as Text" replaces the tab with the text
// editor) races the page's answer to the `dom` hook against the tab closing. When the tab wins, the
// host fails the waiting call with WEBVIEW_CLOSED (editorProvider.ts) instead of leaving it
// pending forever, so the click counts as done either way; the caller then checks what it did.
const WEBVIEW_CLOSED = 'the webview closed before it answered';

/** Runs `steps` on the webview of `uri`, the last of which closes that webview. */
exports.clickClosingTab = async function clickClosingTab(hooks, uri, steps) {
  try {
    await hooks.dom(uri.toString(), steps);
  } catch (error) {
    if (!String(error && error.message).startsWith(WEBVIEW_CLOSED)) throw error;
  }
};
