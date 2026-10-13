// CsvHostAdapter for the VS Code CSV panel's webview (009 T4, ADR-002): the CSV page's side of the
// protocol's CSV messages. It talks to csvPanel.ts in the extension host through the webview's
// `postMessage`. Runs in the webview, so it must not import `vscode` or Node modules.
//
// `open` sends `csvReady` and resolves with the host's `csvSource`, which the host posts only in
// answer to it. An export's preview arrives as JSON5 text and is read here with core's `parseData`:
// a JSON message would turn `NaN` and `Infinity` into `null` and `-0` into `0` (as the compare
// panel's adapter explains), and the preview writes those differently (X5). `run` sends `csvRun`
// and resolves with the `csvOutcome` that carries the same request number.
import {
  decodeToCsvPage,
  PROTOCOL_VERSION,
  type CsvSourceMessageBody,
  type ToCsvHostMessage,
} from '@chr-json-editor/app-shell/protocol';
import type {
  CsvHostAdapter,
  CsvOutcome,
  CsvRequest,
  CsvSource,
} from '@chr-json-editor/app-shell/csv';
import { parseData } from '@chr-json-editor/core';
import type { Subscribe, WebviewApi } from './vscodeHostAdapter';

export class VscodeCsvHostAdapter implements CsvHostAdapter {
  readonly #api: WebviewApi;
  #opened: Promise<CsvSource> | undefined;
  #resolveOpen: ((source: CsvSource) => void) | undefined;
  readonly #runs = new Map<number, (outcome: CsvOutcome) => void>();
  #nextRun = 1;

  constructor(api: WebviewApi, subscribe: Subscribe) {
    this.#api = api;
    subscribe((data) => this.#receive(data));
  }

  open(): Promise<CsvSource> {
    this.#opened ??= new Promise((resolve) => {
      this.#resolveOpen = resolve;
      this.#post({ protocol: PROTOCOL_VERSION, type: 'csvReady', docVersion: 0 });
    });
    return this.#opened;
  }

  run(request: CsvRequest): Promise<CsvOutcome> {
    const id = this.#nextRun++;
    return new Promise((resolve) => {
      this.#runs.set(id, resolve);
      this.#post({
        protocol: PROTOCOL_VERSION,
        type: 'csvRun',
        docVersion: 0,
        request: id,
        run: request,
      });
    });
  }

  #receive(data: unknown): void {
    const decoded = decodeToCsvPage(data);
    if (!decoded.ok) {
      this.#post({
        protocol: PROTOCOL_VERSION,
        type: 'error',
        docVersion: 0,
        code: 'bad-message',
        message: decoded.error,
      });
      return;
    }
    const message = decoded.message;
    if (message.type === 'csvSource') {
      if (!this.#resolveOpen) return;
      this.#resolveOpen(toSource(message.source));
      this.#resolveOpen = undefined;
      return;
    }
    this.#runs.get(message.request)?.(message.outcome);
    this.#runs.delete(message.request);
  }

  #post(message: ToCsvHostMessage): void {
    this.#api.postMessage(message);
  }
}

/** The message's source as the page takes it: an export's preview read from its JSON5 text. */
export function toSource(source: CsvSourceMessageBody): CsvSource {
  if (source.mode === 'import') return { ...source };
  const read = parseData('json5', source.preview);
  // The host wrote the text with core's `stringify`, so it always reads back; a text that does not
  // shows as a value X1 refuses rather than as rows.
  const preview = 'data' in read ? read.data : undefined;
  return { ...source, preview };
}
