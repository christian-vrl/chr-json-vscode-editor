// Webview side of the CSV panel's e2e test hooks (009 T4; e2e builds only, see csvMain.ts and
// esbuild.mjs). The extension host's hooks (csvPanel.ts) post `{ chrTest: 'probe', id }` and get
// back what the CSV page renders (CsvPageProbe), and `{ chrTest: 'dom', id, steps }` changes
// options and clicks the buttons as a person would (DomStep).
import type { CsvPageProbe, DomStep } from '../testProbe';
import { runSteps } from './domSteps';

const text = (element: Element | null | undefined) => element?.textContent?.trim() ?? '';

export function installCsvTestHooks(api: { postMessage(message: unknown): void }) {
  const violations: string[] = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    violations.push(`${e.effectiveDirective} ${e.blockedURI} at ${e.sourceFile}:${e.lineNumber}`);
  });

  function probe(): CsvPageProbe {
    const csv = document.querySelector('.csv .csv-text:not(.hidden)');
    return {
      heading: text(document.querySelector('.csv .heading')),
      summary: text(document.querySelector('.csv .summary')),
      options: [...document.querySelectorAll('.csv .options label')].map((label) => {
        const field = label.querySelector('select, input');
        const value =
          field instanceof HTMLSelectElement
            ? field.value
            : field instanceof HTMLInputElement && field.checked
              ? 'on'
              : 'off';
        return {
          label: text(label)
            .replace(/\s+/g, ' ')
            .replace(/^Delimiter .*/, 'Delimiter'),
          value,
        };
      }),
      buttons: [...document.querySelectorAll<HTMLButtonElement>('.csv .actions button')].map(
        (button) => ({ label: text(button), disabled: button.disabled }),
      ),
      csv: csv ? (csv.textContent ?? '') : null,
      table: !!document.querySelector('.csv .table:not(.hidden) .jse-table-mode'),
      error: document.querySelector('.csv .error')
        ? text(document.querySelector('.csv .error'))
        : null,
      warnings: [...document.querySelectorAll('.csv .warnings li')].map((li) => text(li)),
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
