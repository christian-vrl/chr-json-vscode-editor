// Webview side of the e2e test hooks (003 T5; e2e builds only, see main.ts and esbuild.mjs). The
// extension host's hooks (editorProvider.ts) post `{ chrTest: 'probe', id }` and get back what the
// webview renders: which mode the library shows, whether its stylesheet applied, what it holds, and
// every CSP violation since the script started. `{ chrTest: 'patch', patch }` sends a patch as a
// tree edit would (criterion 1). `{ chrTest: 'type', id, text }` types `text` at the end of text
// mode's editor and answers with the time the last character went in (criterion 9, 003 T6). It also
// reports each `validation` message it sees (004 T2).
import { decodeToWebview } from '@chr-json-editor/app-shell/protocol';
import type { AppHandle } from '@chr-json-editor/app-shell/ui';
import type { RenderedProbe } from '../testProbe';

const MODE_ROOTS = [
  ['tree', '.jse-tree-mode'],
  ['text', '.jse-text-mode'],
  ['table', '.jse-table-mode'],
] as const;

export function installTestHooks(
  api: { postMessage(message: unknown): void },
  app: () => AppHandle | undefined,
) {
  const violations: string[] = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    violations.push(`${e.effectiveDirective} ${e.blockedURI} at ${e.sourceFile}:${e.lineNumber}`);
  });

  function probe(): RenderedProbe {
    const found = MODE_ROOTS.find(([, selector]) => document.querySelector(selector));
    const main = document.querySelector('.jse-main');
    const root = found && document.querySelector(found[1]);
    return {
      mode: found ? found[0] : null,
      toolbarMode:
        document
          .querySelector('[role="toolbar"] button[aria-pressed="true"]')
          ?.textContent?.trim() ?? null,
      mainMinHeight: main ? getComputedStyle(main).minHeight : null,
      shownText: root?.textContent ?? '',
      violations: [...violations],
      content: app()?.content() ?? null,
      format: document.querySelector('[role="toolbar"] .format')?.textContent?.trim() ?? '',
      notice: document.querySelector('.notice')?.textContent ?? '',
      errorMessage:
        document.querySelector('.jse-text-mode .jse-message.jse-error')?.textContent?.trim() ??
        null,
      errorMarkers: [...document.querySelectorAll('.jse-text-mode .cm-lint-marker-error')].filter(
        (marker) =>
          marker.getBoundingClientRect().width > 0 &&
          getComputedStyle(marker).backgroundColor !== 'rgba(0, 0, 0, 0)',
      ).length,
      styleElements: [...document.querySelectorAll('style')].map((s) => ({
        id: s.id,
        nonce: s.nonce !== '',
      })),
    };
  }

  /**
   * Types `text` at the end of text mode's editor the way the browser does for a keystroke
   * (`insertText`, which CodeMirror reads like typing); returns `Date.now()` after the last
   * character, so the host can time how long the document takes to follow.
   */
  async function type(text: string): Promise<number> {
    const content = document.querySelector<HTMLElement>('.jse-text-mode .cm-content');
    if (!content) throw new Error('text mode is not shown');
    content.focus();
    const selection = getSelection();
    selection?.selectAllChildren(content);
    selection?.collapseToEnd();
    // CodeMirror takes the caret from the DOM selection on `selectionchange`, a task later.
    await new Promise((resolve) => setTimeout(resolve, 50));
    for (const character of text) document.execCommand('insertText', false, character);
    return Date.now();
  }

  /** Returns true for a test message, which the editor never sees. */
  return (data: unknown): boolean => {
    const message = data as { chrTest?: unknown; id?: unknown; patch?: unknown; text?: unknown };
    if (typeof message === 'object' && message !== null && message.chrTest === 'probe') {
      api.postMessage({ chrTest: 'probe', id: message.id, result: probe() });
      return true;
    }
    if (typeof message === 'object' && message !== null && message.chrTest === 'type') {
      void type(String(message.text)).then(
        (typedAt) => api.postMessage({ chrTest: 'probe', id: message.id, result: { typedAt } }),
        (error: unknown) =>
          api.postMessage({ chrTest: 'probe', id: message.id, result: { error: String(error) } }),
      );
      return true;
    }
    if (typeof message === 'object' && message !== null && message.chrTest === 'patch') {
      app()?.patch(message.patch as Parameters<AppHandle['patch']>[0]);
      return true;
    }
    const decoded = decodeToWebview(data);
    if (decoded.ok && decoded.message.type === 'validation') {
      const { docVersion, result } = decoded.message;
      api.postMessage({
        chrTest: 'validationShown',
        docVersion,
        errors: result.kind === 'errors' ? result.errors : null,
        reason: result.kind === 'skipped' ? result.reason : null,
      });
    }
    return false;
  };
}
