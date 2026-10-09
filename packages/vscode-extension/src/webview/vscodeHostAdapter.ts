// HostAdapter for the VS Code webview (003 T5, ADR-002): the editor UI's side of the message
// protocol (app-shell's protocol.ts). It talks to editorProvider.ts in the extension host through
// the webview's `postMessage`. Runs in the webview, so it must not import `vscode` or Node modules.
//
// `open` sends `ready` and resolves with the host's `init`: the host posts nothing before `ready`,
// so no message is lost while the script is still loading.
import {
  decodeToWebview,
  PROTOCOL_VERSION,
  type DocumentChange,
  type EditorSettings,
  type SchemaDialect,
  type ToHostMessage,
} from '@chr-json-editor/app-shell/protocol';
import type {
  Disposable,
  HostAdapter,
  HostEvent,
  HostNotice,
  OpenedDocument,
} from '@chr-json-editor/app-shell/ui';

/** The part of `acquireVsCodeApi()` the adapter uses. */
export interface WebviewApi {
  postMessage(message: unknown): void;
}

/** Calls `listener` with the data of each message the host posts; returns an unsubscribe. */
export type Subscribe = (listener: (data: unknown) => void) => () => void;

export class VscodeHostAdapter implements HostAdapter {
  readonly #api: WebviewApi;
  readonly #listeners = new Set<(event: HostEvent) => void>();
  #opened: Promise<OpenedDocument> | undefined;
  #resolveOpen: ((doc: OpenedDocument) => void) | undefined;
  #settings: EditorSettings | undefined;

  constructor(api: WebviewApi, subscribe: Subscribe) {
    this.#api = api;
    subscribe((data) => this.#receive(data));
  }

  open(): Promise<OpenedDocument> {
    this.#opened ??= new Promise((resolve) => {
      this.#resolveOpen = resolve;
      this.#post({ protocol: PROTOCOL_VERSION, type: 'ready', docVersion: 0 });
    });
    return this.#opened;
  }

  save(docVersion: number, change: DocumentChange): void {
    this.#post({ protocol: PROTOCOL_VERSION, type: 'edit', docVersion, change });
  }

  onExternalChange(listener: (event: HostEvent) => void): Disposable {
    this.#listeners.add(listener);
    return { dispose: () => this.#listeners.delete(listener) };
  }

  getSettings(): EditorSettings {
    if (!this.#settings) throw new Error('VscodeHostAdapter: getSettings() before open()');
    return this.#settings;
  }

  showMessage(notice: HostNotice): void {
    this.#post({ protocol: PROTOCOL_VERSION, type: 'error', ...notice });
  }

  setSchemaDialect(docVersion: number, dialect: SchemaDialect): void {
    this.#post({ protocol: PROTOCOL_VERSION, type: 'setDialect', docVersion, dialect });
  }

  #receive(data: unknown): void {
    const decoded = decodeToWebview(data);
    if (!decoded.ok) {
      this.showMessage({ docVersion: 0, code: 'bad-message', message: decoded.error });
      return;
    }
    const message = decoded.message;
    switch (message.type) {
      case 'init': {
        // Only the answer to this adapter's own `ready` counts.
        if (!this.#resolveOpen) return;
        const doc: OpenedDocument = {
          docVersion: message.docVersion,
          text: message.text,
          format: message.format,
          mode: message.mode,
          settings: message.settings,
        };
        this.#settings = doc.settings;
        this.#resolveOpen(doc);
        this.#resolveOpen = undefined;
        return;
      }
      default:
        for (const listener of [...this.#listeners]) listener(message);
    }
  }

  #post(message: ToHostMessage): void {
    this.#api.postMessage(message);
  }
}
