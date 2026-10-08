// Webview side of the e2e test hooks (003 T5; e2e builds only, see main.ts and esbuild.mjs). The
// extension host's hooks (editorProvider.ts) post `{ chrTest: 'probe', id }` and get back what the
// webview renders: which mode the library shows, whether its stylesheet applied, and every CSP
// violation since the script started. It also reports each `validation` message it sees (004 T2).
import { decodeToWebview } from '@chr-json-editor/app-shell/protocol';
import type { RenderedProbe } from '../testProbe';

const MODE_ROOTS = [
  ['tree', '.jse-tree-mode'],
  ['text', '.jse-text-mode'],
  ['table', '.jse-table-mode'],
] as const;

export function installTestHooks(api: { postMessage(message: unknown): void }) {
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
      styleElements: [...document.querySelectorAll('style')].map((s) => ({
        id: s.id,
        nonce: s.nonce !== '',
      })),
    };
  }

  /** Returns true for a test message, which the editor never sees. */
  return (data: unknown): boolean => {
    const message = data as { chrTest?: unknown; id?: unknown };
    if (typeof message === 'object' && message !== null && message.chrTest === 'probe') {
      api.postMessage({ chrTest: 'probe', id: message.id, result: probe() });
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
