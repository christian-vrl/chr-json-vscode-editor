// Webview side of the compare panel's e2e test hooks (007 T4; e2e builds only, see compareMain.ts
// and esbuild.mjs). The extension host's hooks (comparePanel.ts) post `{ chrTest: 'probe', id }`
// and get back what the compare page renders (ComparePageProbe), and `{ chrTest: 'dom', id, steps }`
// clicks Next, Previous and the copy buttons as a person would (DomStep).
import type { ComparePageProbe, DomStep } from '../testProbe';
import { runSteps } from './domSteps';

const DIFF_CLASSES = ['chr-diff-added', 'chr-diff-removed', 'chr-diff-changed', 'chr-diff-inside'];

export function installCompareTestHooks(api: { postMessage(message: unknown): void }) {
  const violations: string[] = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    violations.push(`${e.effectiveDirective} ${e.blockedURI} at ${e.sourceFile}:${e.lineNumber}`);
  });

  function side(name: 'left' | 'right'): ComparePageProbe['left'] {
    const section = document.querySelector(`.compare .side.${name}`);
    const marks: Record<string, string[]> = {};
    for (const className of DIFF_CLASSES) {
      marks[className] = [...(section?.querySelectorAll(`.jse-json-node.${className}`) ?? [])].map(
        (node) => decodeURIComponent(node.getAttribute('data-path') ?? ''),
      );
    }
    const copy = document.querySelector<HTMLButtonElement>(
      `.compare .copy button:nth-child(${name === 'left' ? 1 : 2})`,
    );
    return {
      name: section?.querySelector('.name')?.textContent?.trim() ?? '',
      error: section?.querySelector('.parse-error')?.textContent?.trim() ?? null,
      tree: !!section?.querySelector('.editor:not(.hidden) .jse-tree-mode'),
      marks,
      selected: [...(section?.querySelectorAll('.jse-json-node.jse-selected') ?? [])].map((n) =>
        decodeURIComponent(n.getAttribute('data-path') ?? ''),
      ),
      canCopyInto: copy ? !copy.disabled : false,
    };
  }

  function probe(): ComparePageProbe {
    const main = document.querySelector('.jse-main');
    return {
      counter: document.querySelector('.compare .counter')?.textContent?.trim() ?? '',
      left: side('left'),
      right: side('right'),
      mainMinHeight: main ? getComputedStyle(main).minHeight : null,
      violations: [...violations],
      styleElements: [...document.querySelectorAll('style')].map((s) => ({
        id: s.id,
        nonce: s.nonce !== '',
      })),
    };
  }

  /** Returns true for a test message, which the page never sees. */
  return (data: unknown): boolean => {
    const message = data as { chrTest?: unknown; id?: unknown };
    if (typeof message !== 'object' || message === null || !('chrTest' in message)) return false;
    if (message.chrTest === 'probe') {
      api.postMessage({ chrTest: 'probe', id: message.id, result: probe() });
    } else if (message.chrTest === 'dom') {
      void runSteps((message as { steps?: DomStep[] }).steps ?? []).then(
        (reads) => api.postMessage({ chrTest: 'probe', id: message.id, result: { reads } }),
        (error: unknown) =>
          api.postMessage({ chrTest: 'probe', id: message.id, result: { error: String(error) } }),
      );
    }
    return true;
  };
}
