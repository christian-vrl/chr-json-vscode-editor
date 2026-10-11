// Webview side of the e2e test hooks (003 T5; e2e builds only, see main.ts and esbuild.mjs). The
// extension host's hooks (editorProvider.ts) post `{ chrTest: 'probe', id }` and get back what the
// webview renders: which mode the library shows, whether its stylesheet applied, what it holds, and
// every CSP violation since the script started. `{ chrTest: 'patch', patch }` sends a patch as a
// tree edit would (criterion 1). It also reports each `validation` message it sees (004 T2), and
// `{ chrTest: 'selectDialect', dialect }` picks a dialect in the toolbar switch (004 T5).
// `{ chrTest: 'whenShown', id, text }` answers once the editor renders `text`, without sending
// what it holds, so the large-file benchmark (003 T11) can time renders of big documents;
// `{ chrTest: 'whenSettled', id }` answers once every edit was answered and the editor shows the
// document, so it can time an edit until the editor is free again. Both answers carry `ms`, the
// time since the last `patch` on the webview's clock, as a person editing in the webview sees it.
// `{ chrTest: 'type', id, text }` types `text` at the end of text mode's editor and answers
// with the time the last character went in (criterion 9, 003 T6). `{ chrTest: 'press', key, shift }`
// presses Ctrl+`key` in the focused element, and `{ chrTest: 'click', title }` clicks the menu
// button with that title (undo and redo, criterion 3, 003 T7). `{ chrTest: 'dom', id, steps }`
// clicks, fills in and presses keys on the page as a person would (003 T8; see DomStep).
import { decodeToWebview } from '@chr-json-editor/app-shell/protocol';
import type { AppHandle } from '@chr-json-editor/app-shell/ui';
import type { DomStep, RenderedProbe } from '../testProbe';
import { runSteps } from './domSteps';

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
  /** When the last `patch` reached the editor (`performance.now()`). */
  let patchedAt: number | undefined;
  const sincePatch = () => (patchedAt === undefined ? undefined : performance.now() - patchedAt);
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
      validationMarks: validationMarks(root ?? null),
      schemaStatus: schemaStatus(),

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
      if (shownText().includes(text)) api.postMessage({ chrTest: 'shown', id, ms: sincePatch() });
      else requestAnimationFrame(check);
    };
    check();
  }

  /** Answers `id` in the first frame after every edit is answered and shown (003 T11 benchmark). */
  function whenSettled(id: unknown): void {
    const check = () => {
      if (app()?.settled()) api.postMessage({ chrTest: 'settled', id, ms: sincePatch() });
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }

  /** Presses Ctrl+`key` (Shift too when `shift`) where the focus is, as a keystroke would. */
  function press(key: string, shift: boolean): void {
    const target = document.activeElement ?? document.body;
    const init = { key, code: `Key${key.toUpperCase()}`, ctrlKey: true, shiftKey: shift };
    target.dispatchEvent(
      new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }),
    );
    target.dispatchEvent(new KeyboardEvent('keyup', { ...init, bubbles: true, cancelable: true }));
  }

  function click(title: string): void {
    const button = document.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
    if (!button) throw new Error(`no button titled ${title}`);
    button.click();
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
    if (typeof message === 'object' && message !== null && message.chrTest === 'whenSettled') {
      whenSettled(message.id);
      return true;
    }
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
    if (typeof message === 'object' && message !== null && message.chrTest === 'dom') {
      void runSteps((message as { steps?: DomStep[] }).steps ?? []).then(
        (reads) => api.postMessage({ chrTest: 'probe', id: message.id, result: { reads } }),
        (error: unknown) =>
          api.postMessage({ chrTest: 'probe', id: message.id, result: { error: String(error) } }),
      );
      return true;
    }
    if (typeof message === 'object' && message !== null && message.chrTest === 'press') {
      const { key, shift } = message as { key?: unknown; shift?: unknown };
      press(String(key), shift === true);
      return true;
    }
    if (typeof message === 'object' && message !== null && message.chrTest === 'click') {
      click(String((message as { title?: unknown }).title));
      return true;
    }
    if (typeof message === 'object' && message !== null && message.chrTest === 'selectDialect') {
      selectDialect(String((message as { dialect?: unknown }).dialect));
      return true;
    }
    if (typeof message === 'object' && message !== null && message.chrTest === 'select') {
      const { path } = message as { path?: unknown };
      app()?.select(typeof path === 'string' ? path : '');
      return true;
    }
    if (typeof message === 'object' && message !== null && message.chrTest === 'patch') {
      patchedAt = performance.now();
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
