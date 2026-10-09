// Webview side of the e2e test hooks (003 T5; e2e builds only, see main.ts and esbuild.mjs). The
// extension host's hooks (editorProvider.ts) post `{ chrTest: 'probe', id }` and get back what the
// webview renders: which mode the library shows, whether its stylesheet applied, what it holds, and
// every CSP violation since the script started. `{ chrTest: 'patch', patch }` sends a patch as a
// tree edit would (criterion 1). It also reports each `validation` message it sees (004 T2), and
// `{ chrTest: 'selectDialect', dialect }` picks a dialect in the toolbar switch (004 T5).
// `{ chrTest: 'whenShown', id, text }` answers once the editor renders `text`, without sending
// what it holds, so the large-file benchmark (003 T11) can time renders of big documents.
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
      validationMarks: validationMarks(root ?? null),
      schemaStatus: schemaStatus(),

      styleElements: [...document.querySelectorAll('style')].map((s) => ({
        id: s.id,
        nonce: s.nonce !== '',
      })),
    };
  }

  /** The toolbar's schema status as a person reads it: the chosen option, then any reason. */
  function schemaStatus(): string {
    const schema = document.querySelector('[role="toolbar"] .schema');
    if (!schema) return '';
    const select = schema.querySelector('select');
    const parts = [...schema.children].map((child) =>
      child === select ? (select.selectedOptions[0]?.textContent ?? '') : (child.textContent ?? ''),
    );
    return parts
      .map((part) => part.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' ');
  }

  function selectDialect(dialect: string): void {
    const select = document.querySelector<HTMLSelectElement>('[role="toolbar"] .schema select');
    if (!select) throw new Error('no dialect switch in the toolbar');
    select.value = dialect;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** The rendered mode's text with whitespace runs as single spaces. */
  function shownText(): string {
    const found = MODE_ROOTS.find(([, selector]) => document.querySelector(selector));
    const root = found && document.querySelector(found[1]);
    return (root?.textContent ?? '').replace(/\s+/g, ' ');
  }

  /** Answers `id` in the first frame whose rendered text contains `text` (003 T11 benchmark). */
  function whenShown(id: unknown, text: string): void {
    const check = () => {
      if (shownText().includes(text)) api.postMessage({ chrTest: 'shown', id });
      else requestAnimationFrame(check);
    };
    check();
  }

  /** Returns true for a test message, which the editor never sees. */
  return (data: unknown): boolean => {
    const message = data as { chrTest?: unknown; id?: unknown; patch?: unknown; text?: unknown };
    if (
      typeof message === 'object' &&
      message !== null &&
      message.chrTest === 'whenShown' &&
      typeof message.text === 'string'
    ) {
      whenShown(message.id, message.text);
      return true;
    }
    if (typeof message === 'object' && message !== null && message.chrTest === 'probe') {
      api.postMessage({ chrTest: 'probe', id: message.id, result: probe() });
      return true;
    }
    if (typeof message === 'object' && message !== null && message.chrTest === 'selectDialect') {
      selectDialect(String((message as { dialect?: unknown }).dialect));
      return true;
    }
    if (typeof message === 'object' && message !== null && message.chrTest === 'patch') {
      app()?.patch(message.patch as Parameters<AppHandle['patch']>[0]);
      return true;
    }
    const decoded = decodeToWebview(data);
    if (decoded.ok && decoded.message.type === 'validation') {
      const { docVersion, result, dialect } = decoded.message;
      api.postMessage({
        chrTest: 'validationShown',
        docVersion,
        dialect,
        errors: result.kind === 'errors' ? result.errors : null,
        reason: result.kind === 'skipped' ? result.reason : null,
      });
    }
    return false;
  };
}

const SEVERITIES = ['error', 'warning', 'info'] as const;

/** The inline validation marks under `root` (see RenderedProbe.validationMarks). */
function validationMarks(root: Element | null): RenderedProbe['validationMarks'] {
  if (!root) return [];
  const marks: RenderedProbe['validationMarks'] = [];
  // Tree and table: the library's ValidationErrorIcon, a button classed by severity. The error
  // list under the contents uses the same classes on table rows, so only buttons count.
  for (const severity of SEVERITIES) {
    for (const icon of root.querySelectorAll(`button.jse-validation-${severity}`)) {
      const owner = icon.closest('[data-path]');
      const path = owner ? decodeURIComponent(owner.getAttribute('data-path') ?? '') : null;
      marks.push({ path, severity, text: owner?.textContent ?? '' });
    }
    // Text: CodeMirror's lint decoration over the range the error points at.
    for (const range of root.querySelectorAll(`.cm-lintRange-${severity}`)) {
      marks.push({ path: null, severity, text: range.textContent ?? '' });
    }
  }
  return marks;
}
