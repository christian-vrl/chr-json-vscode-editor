// The single seam between the editor UI and the host it runs in (ADR-002; AGENTS.md §Glossary
// "HostAdapter"). Each host implements it once: VscodeHostAdapter over the webview message
// protocol (./protocol.ts), DevHostAdapter for the standalone page (003 T2), ChromeHostAdapter
// later. Nothing else in app-shell knows which host it runs in.
import type {
  DocumentChange,
  EditorSettings,
  ErrorMessage,
  InitMessage,
  SetFormatMessage,
  SetModeMessage,
  UpdateMessage,
} from './protocol.js';

/** The document as the host first hands it over (the `init` message without its envelope). */
export type OpenedDocument = Omit<InitMessage, 'protocol' | 'type'>;

/** Something the host tells the UI after `open`: the host → UI messages other than `init`. */
export type HostEvent = UpdateMessage | SetModeMessage | SetFormatMessage | ErrorMessage;

/** A failure the UI asks the host to show (the UI → host `error` message without its envelope). */
export type HostNotice = Omit<ErrorMessage, 'protocol' | 'type'>;

export interface Disposable {
  dispose(): void;
}

export interface HostAdapter {
  /** Resolves once with the document; maps to the host's `init` message. */
  open(): Promise<OpenedDocument>;
  /**
   * Hands a change to the host, which applies it to the document (in VS Code the host makes a
   * `WorkspaceEdit` and VS Code owns writing the file, ADR-003). `docVersion` is the version the
   * UI last received; the host answers a stale change with an `error` event. Maps to `edit`.
   */
  save(docVersion: number, change: DocumentChange): void;
  /** Subscribes to `update`, `setMode`, `setFormat` and `error` messages from the host. */
  onExternalChange(listener: (event: HostEvent) => void): Disposable;
  /** The settings from `init`. Only valid after `open` has resolved. */
  getSettings(): EditorSettings;
  /** Asks the host to show a failure to the user; maps to the UI → host `error` message. */
  showMessage(notice: HostNotice): void;
}
