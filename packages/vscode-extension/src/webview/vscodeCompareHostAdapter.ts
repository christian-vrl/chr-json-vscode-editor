// CompareHostAdapter for the VS Code compare panel's webview (007 T4, ADR-002): the compare page's
// side of the protocol's compare messages. It talks to comparePanel.ts in the extension host
// through the webview's `postMessage`. Runs in the webview, so it must not import `vscode` or Node
// modules.
//
// The host parses both sides with core and runs `compare`; it sends each side's text, not its data,
// and the adapter parses it here with the editor's parser (`parseCompareText`), as the editor's
// webview parses the text it gets: a JSON message would turn JSON5's `NaN` and `Infinity` into
// `null` and `-0` into `0`. `open` sends `compareReady` and resolves with the host's first
// `compare`, which the host posts only in answer to it.
import {
  decodeToComparePage,
  PROTOCOL_VERSION,
  type CompareDifference,
  type CompareMessage,
  type CompareSideMessage,
  type ToCompareHostMessage,
} from '@chr-json-editor/app-shell/protocol';
import type {
  CompareHostAdapter,
  CompareNotice,
  CompareSide,
  CompareSideState,
  CompareState,
  Difference,
  Disposable,
  ParseCompareText,
} from '@chr-json-editor/app-shell/compare';
import type { Subscribe, WebviewApi } from './vscodeHostAdapter';

export class VscodeCompareHostAdapter implements CompareHostAdapter {
  readonly #api: WebviewApi;
  readonly #parse: ParseCompareText;
  readonly #listeners = new Set<(state: CompareState) => void>();
  #opened: Promise<CompareState> | undefined;
  #resolveOpen: ((state: CompareState) => void) | undefined;

  constructor(api: WebviewApi, subscribe: Subscribe, parse: ParseCompareText) {
    this.#api = api;
    this.#parse = parse;
    subscribe((data) => this.#receive(data));
  }

  open(): Promise<CompareState> {
    this.#opened ??= new Promise((resolve) => {
      this.#resolveOpen = resolve;
      this.#post({ protocol: PROTOCOL_VERSION, type: 'compareReady', docVersion: 0 });
    });
    return this.#opened;
  }

  onUpdate(listener: (state: CompareState) => void): Disposable {
    this.#listeners.add(listener);
    return { dispose: () => this.#listeners.delete(listener) };
  }

  copy(version: number, difference: Difference, to: CompareSide): void {
    this.#post({
      protocol: PROTOCOL_VERSION,
      type: 'copy',
      docVersion: version,
      difference: toMessage(difference),
      to,
    });
  }

  showMessage(notice: CompareNotice): void {
    this.#post({ protocol: PROTOCOL_VERSION, type: 'error', docVersion: 0, ...notice });
  }

  #receive(data: unknown): void {
    const decoded = decodeToComparePage(data);
    if (!decoded.ok) {
      this.showMessage({ code: 'bad-message', message: decoded.error });
      return;
    }
    const state = this.#state(decoded.message);
    if (this.#resolveOpen) {
      this.#resolveOpen(state);
      this.#resolveOpen = undefined;
      return;
    }
    for (const listener of [...this.#listeners]) listener(state);
  }

  #state(message: CompareMessage): CompareState {
    const left = this.#side(message.left);
    const right = this.#side(message.right);
    const compared = left.content.kind === 'data' && right.content.kind === 'data';
    return {
      version: message.docVersion,
      left,
      right,
      // The host compares only when both sides parse; a side that fails here compares nothing too.
      differences: compared ? message.differences : [],
    };
  }

  #side(side: CompareSideMessage): CompareSideState {
    const { name, format, writable } = side;
    if (side.content.kind === 'error') {
      return { name, format, writable, content: side.content };
    }
    try {
      return {
        name,
        format,
        writable,
        content: { kind: 'data', data: this.#parse(side.content.text, format) },
      };
    } catch (e) {
      return {
        name,
        format,
        writable,
        content: { kind: 'error', message: e instanceof Error ? e.message : String(e) },
      };
    }
  }

  #post(message: ToCompareHostMessage): void {
    this.#api.postMessage(message);
  }
}

/** core's `Difference` (optional paths) as the protocol's tagged one. */
function toMessage(d: Difference): CompareDifference {
  if (d.kind === 'added' && d.rightPath !== undefined) {
    return { kind: 'added', rightPath: d.rightPath };
  }
  if (d.kind === 'removed' && d.leftPath !== undefined) {
    return { kind: 'removed', leftPath: d.leftPath };
  }
  if (d.kind === 'changed' && d.leftPath !== undefined && d.rightPath !== undefined) {
    return { kind: 'changed', leftPath: d.leftPath, rightPath: d.rightPath };
  }
  throw new Error(`a ${d.kind} difference without its paths`);
}
