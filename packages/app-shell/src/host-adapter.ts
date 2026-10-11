// The single seam between the editor UI and the host it runs in (ADR-002; AGENTS.md §Glossary
// "HostAdapter"). Each host implements it once: VscodeHostAdapter over the webview message
// protocol (./protocol.ts), DevHostAdapter for the standalone page (003 T2), ChromeHostAdapter
// later. Nothing else in app-shell knows which host it runs in.
import type {
  DocumentChange,
  EditorSettings,
  ErrorMessage,
  FlushMessage,
  GetRowSourceMessage,
  InitMessage,
  SchemaDialect,
  SetFormatMessage,
  SetModeMessage,
  UpdateMessage,
  ValidationMessage,
} from './protocol.js';

/** The document as the host first hands it over (the `init` message without its envelope). */
export type OpenedDocument = Omit<InitMessage, 'protocol' | 'type'>;

/** Something the host tells the UI after `open`: the host → UI messages other than `init`. */
export type HostEvent =
  | UpdateMessage
  | SetModeMessage
  | SetFormatMessage
  | ErrorMessage
  | ValidationMessage
  | FlushMessage
  | GetRowSourceMessage;

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
  /** Subscribes to the host's `update`, `setMode`, `setFormat`, `error`, `validation`, `flush`,
   *  `getRowSource` messages. */
  onExternalChange(listener: (event: HostEvent) => void): Disposable;
  /** The settings from `init`. Only valid after `open` has resolved. */
  getSettings(): EditorSettings;
  /** Asks the host to show a failure to the user; maps to the UI → host `error` message. */
  showMessage(notice: HostNotice): void;
  /**
   * The user's dialect for a schema that names none this editor knows (UNK-017's switch, 004 T5);
   * the host validates again and answers with a `validation` event. Maps to `setDialect`.
   */
  setSchemaDialect(docVersion: number, dialect: SchemaDialect): void;
  /**
   * Undoes or redoes the document's last change in the host's own history (003 T7); a change comes
   * back as an `update` event with origin `external`. Maps to `undo` and `redo`.
   */
  undo(docVersion: number): void;
  redo(docVersion: number): void;
  /** Answers the host's `flush` event once every change the UI made is answered. Maps to `flushed`. */
  flushed(docVersion: number, request: number): void;
  /** "Open as Text" in the large-file banner (spec 008 criterion 3): the host shows the document in
   *  its own text editor instead. Maps to `openAsText`. */
  openAsText(docVersion: number): void;
  /** "Edit anyway" in the large-file banner (spec 008 criterion 4): the host accepts this UI's
   *  changes from now on. Maps to `unlock`. */
  unlock(docVersion: number): void;
  /** Answers the host's `getRowSource` event with the JSON Pointer of what the user is looking at
   *  (spec 009 criterion 7): `''` for the document's data. Maps to `rowSource`. */
  rowSource(docVersion: number, request: number, path: string): void;
}
