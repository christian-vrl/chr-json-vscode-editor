<!--
  The editor UI (003 T2, UNK-010: Svelte 5). A toolbar with the mode switch and the format badge
  around one vanilla-jsoneditor instance; every document change goes to the HostAdapter and every
  host event comes from it, so this component never knows which host it runs in (ADR-002).

  vanilla-jsoneditor bundles its own Svelte runtime, so it is mounted through its plain
  `createJSONEditor` API rather than used as a component of this app (UNK-027).

  Schema errors (004 T5) come from the host as `validation` events (the host runs Ajv, ADR-010) and
  reach the library through its `validator` prop, which draws them inline in tree, table and text
  mode. The toolbar shows the dialect the schema ran as, with UNK-017's switch when the schema
  names none, and why a document was not validated.

  Undo and redo (003 T7, plan 003 risk R1) belong to the host's history of the document, never the
  library's: the undo and redo keys and the library's menu buttons send `undo` and `redo` to the
  host, which undoes there (in VS Code, the document's own undo stack), and the result comes back
  as an external `update`. While a key or value is being typed inline, the keys undo that typing
  in the field instead, as the browser does it. Before the host saves, it asks for a `flush`, so
  the saved file has the typing text mode has not reported yet.

  Whole-document actions (003 T8) never let the library rewrite the text, which would drop comments
  (its text mode writes `JSON.stringify` of the data). Format, compact and repair go to the host as
  actions core runs on the document's text; a sort or transform, which the library hands back as
  new data for a whole object or array, goes as core's sort with the new order or as core's diff
  (data-change.ts, 002 R12–R14). The library's own buttons and shortcuts are rerouted here.

  Large-file mode (spec 008, UNK-040) is the host's choice when the tab opens: a banner says so,
  the modes are Tree and Table only (VS Code's text editor is the way to edit text), and the tab
  starts locked: the library is `readOnly`, the whole-document actions are not offered, and no
  change, undo or redo leaves the UI. "Edit anyway" unlocks it until the tab closes; "Open as Text"
  asks the host for its text editor.

  JavaScript and Lodash queries (spec 011) are listed in Transform when the host passes a loader for
  the query engine (mount.ts `MountOptions`). They are the library's own languages, with
  `executeQuery` running the query in the sealed QuickJS engine (query/run-query.ts), never in the
  page. The engine is loaded and compiled when a Transform dialog first opens, which waits for it
  (criterion 10). Above 5 MiB, measured on the text when the dialog opens, they are not listed
  (criterion 11, query/size-gate.ts), and the engine is not loaded for that dialog.

  JSON Lines (spec 012) offers Table and Tree only, Table first (criterion 6): VS Code's text editor
  is the line editor, and format and compact are not offered (its lines are one record each). A
  document with bad lines shows its items read-only under a banner naming the first bad line
  (criterion 8, UNK-051): "Open as Text" asks the host for its text editor, and "Repair Lines" is
  the one change the UI sends then (core's `repairLines`, run by the host). The banner and the
  read-only state follow the document's text, so an edit made elsewhere that leaves no bad line
  makes the tab editable again.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import {
    type ContextMenuItem,
    createJSONEditor,
    isContextMenuColumn,
    isContextMenuRow,
    javascriptQueryLanguage,
    jmespathQueryLanguage,
    jsonpathQueryLanguage,
    jsonQueryLanguage,
    lodashQueryLanguage,
    parseJSONPath,
    type Content,
    createMultiSelection,
    isMenuButton,
    isMultiSelection,
    isValueSelection,
    type JSONEditorSelection,
    type JsonEditor,
    type MenuItem,
    type Mode as LibraryMode,
    type OnChangeStatus,
    type QueryLanguage,
    type RenderMenuContext,
    type ValidationError,
    type Validator,
    ValidationSeverity,
  } from 'vanilla-jsoneditor';
  import { getAdapter } from '@chr-json-editor/core';
  import { compileJSONPointer, getIn, parseJSONPointer, type JSONPath } from 'immutable-json-patch';
  import './theme.css';
  import { dataChange, isContainer, reordering } from './data-change.js';
  import type { HostAdapter, HostEvent } from './host-adapter.js';
  import { parserFor, validationParserFor } from './parser.js';
  import { columnPath, exactOrder, onlyNestedPath, type SortRequest } from './sort-order.js';
  import { jsonpathRfc9535QueryLanguage } from './query/jsonpath-rfc9535.js';
  import {
    isQueryEngineLoaded,
    loadQueryEngine,
    QueryError,
    runQuery,
    type QueryEngineLoader,
    type QueryLanguageId,
  } from './query/run-query.js';
  import { queryLanguagesFor } from './query/size-gate.js';
  import {
    isEditError,
    MODES,
    SCHEMA_DIALECTS,
    type DocumentAction,
    type DocumentChange,
    type Format,
    type JsonPatchOperation,
    type LargeFile,
    type Mode,
    type SchemaDialect,
    type ValidationMessage,
  } from './protocol.js';

  let {
    host,
    loadQueryEngine: queryEngineLoader,
  }: {
    host: HostAdapter;
    loadQueryEngine?: QueryEngineLoader;
  } = $props();

  const MODE_LABELS: Record<Mode, string> = { tree: 'Tree', text: 'Text', table: 'Table' };
  const FORMAT_LABELS: Record<Format, string> = {
    json: 'JSON',
    jsonc: 'JSONC',
    json5: 'JSON5',
    jsonl: 'JSON Lines',
  };
  /** Transform's query languages (spec 003 criterion 5, spec 011 criterion 8 as amended by spec 014
   *  criterion 5), in this order. The library's JSONPath is jsonpath-plus, Goessner's JSONPath;
   *  JSONPath (RFC 9535) is json-p3 (query/jsonpath-rfc9535.ts). JSONQuery's description
   *  links to jsonquerylang.org (004 T1 review). JavaScript and Lodash only with the host's engine
   *  loader, read once at mount. */
  // svelte-ignore state_referenced_locally: the library takes the list once, when it mounts
  const QUERY_LANGUAGES: QueryLanguage[] = [
    jsonQueryLanguage,
    jmespathQueryLanguage,
    jsonpathRfc9535QueryLanguage,
    { ...jsonpathQueryLanguage, name: 'JSONPath (Goessner)' },
    ...(queryEngineLoader
      ? [
          sealedLanguage(javascriptQueryLanguage, 'javascript'),
          sealedLanguage(lodashQueryLanguage, 'lodash'),
        ]
      : []),
  ];

  /** The library's language (name, description, wizard's `createQuery`) with the query run in the
   *  sealed engine. A QueryError reaches the preview as a plain Error, so it reads like the
   *  library's own languages' errors ("Error: …"). Each run marks `chr:query-run` on the page's
   *  performance timeline (spec 011 criterion 5's web test times the limits from it). */
  function sealedLanguage(language: QueryLanguage, id: QueryLanguageId): QueryLanguage {
    return {
      ...language,
      executeQuery: (json, query) => {
        performance.mark('chr:query-run');
        try {
          return runQuery(id, json, query);
        } catch (error) {
          throw error instanceof QueryError ? new Error(error.message) : error;
        }
      },
    };
  }

  /** A Transform dialog waiting for the engine to compile; a second request meanwhile is dropped. */
  let engineWait: Promise<void> | undefined;
  /** The query language last picked in Transform, kept while a large document hides it. */
  let chosenQueryLanguageId = QUERY_LANGUAGES[0]!.id;
  /** The list the library holds now: all of QUERY_LANGUAGES, or the ones allowed above 5 MiB. */
  let shownQueryLanguages = QUERY_LANGUAGES;

  /**
   * Gives the library the languages for the document's size now (criterion 11): the text as text
   * mode shows it (typing included), else the host's last text. A language the list leaves out is
   * not selected; the user's pick comes back with it. Returns whether the engine's languages are
   * listed.
   */
  function showQueryLanguagesForSize(): boolean {
    if (!editor) return true;
    let text = docText;
    if (mode === 'text') {
      flushText();
      const content = editor.get();
      if ('text' in content) text = content.text;
    }
    const shown = queryLanguagesFor(QUERY_LANGUAGES, text);
    if (shown.length !== shownQueryLanguages.length) {
      shownQueryLanguages = shown;
      const selected = shown.some((language) => language.id === chosenQueryLanguageId)
        ? chosenQueryLanguageId
        : shown[0]!.id;
      editor.updateProps({ queryLanguages: shown, queryLanguageId: selected });
    }
    return shown === QUERY_LANGUAGES;
  }

  /**
   * Opens a Transform dialog with `open` once the query engine is compiled (criterion 10): the first
   * time, it loads and compiles the engine first. If that fails, the dialog opens anyway and
   * JavaScript and Lodash say the engine is not loaded. A document above 5 MiB lists no engine
   * language (criterion 11), so its dialog opens without loading the engine.
   */
  function withQueryEngine(open: () => void): void {
    const engineListed = showQueryLanguagesForSize();
    if (!queryEngineLoader || !engineListed || isQueryEngineLoaded()) {
      open();
      return;
    }
    if (engineWait) return;
    engineWait = loadQueryEngine(queryEngineLoader)
      .catch((error: unknown) => console.error('CHR JSON Editor: query engine', error))
      .finally(() => {
        engineWait = undefined;
        if (editor) open();
      });
  }

  /** Text mode's "Smart format" button (spec 010 criterion 7), added next to the library's Format. */
  const SMART_FORMAT_CLASS = 'chr-smart-format';
  /** Its icon: rows of short items lined up in columns, in Font Awesome's shape (the library draws
   *  menu icons from these). */
  const SMART_FORMAT_ICON = {
    prefix: 'fas',
    iconName: 'table-cells',
    icon: [
      448,
      512,
      [],
      '',
      'M0 96h192v64H0zM256 96h192v64H256zM64 224h128v64H64zM256 224h192v64H256zM64 352h128v64H64zM256 352h192v64H256z',
    ],
  } as unknown as NonNullable<Extract<MenuItem, { type: 'button' }>['icon']>;
  /** The buttons for whole-document actions (003 T8), hidden on a locked large file. */
  const ACTION_BUTTONS = [
    'jse-format',
    SMART_FORMAT_CLASS,
    'jse-compact',
    'jse-sort',
    'jse-transform',
  ];
  /** The modes large-file mode offers (spec 008 criterion 2). */
  const LARGE_FILE_MODES: readonly Mode[] = ['tree', 'table'];
  /** The modes JSON Lines offers, Table first (spec 012 criterion 6). */
  const JSON_LINES_MODES: readonly Mode[] = ['table', 'tree'];
  /** The library's buttons JSON Lines does not offer (spec 012 criterion 6): a record is one line. */
  const JSON_LINES_HIDDEN = ['jse-format', 'jse-compact'];

  let mode = $state<Mode | undefined>();
  /** Large-file mode, as the host chose it in `init` (spec 008); null for the normal editor. */
  let largeFile = $state<LargeFile | null>(null);
  /** A large file the user has not chosen "Edit anyway" for: read-only (criterion 2). */
  const locked = $derived(largeFile !== null && !largeFile.unlocked);
  let format = $state<Format | undefined>();
  const modes = $derived(
    format === 'jsonl' ? JSON_LINES_MODES : largeFile ? LARGE_FILE_MODES : MODES,
  );
  /** A JSON Lines document's bad lines (spec 012 criterion 8), 1-based and in order; null when there
   *  is none, or the document is not JSON Lines. */
  let badLines = $state<number[] | null>(null);
  /** The library shows the document read-only: a locked large file, or JSON Lines with a bad line. */
  const readOnly = $derived(locked || badLines !== null);
  let notice = $state<string | undefined>();
  /** The host's latest `validation`; its errors show only while it describes the shown text. */
  let validation = $state<ValidationMessage | undefined>();
  let target: HTMLDivElement;
  let editor: JsonEditor | undefined;
  /** What tree or table mode has selected (the library's `onSelect`), for "Export to CSV…". */
  let selection: JSONEditorSelection | undefined;

  // Sync (003 T5). The host owns the document: the UI sends each change as an `edit` made on
  // `docVersion` and the host answers every edit, in order, with an `update` (origin `edit`) or an
  // edit error. Only one edit is in flight, so each is made on the version the host holds; changes
  // made meanwhile wait in `queued`. The library never reports a programmatic `update` as a change,
  // so text from the host is never echoed back. Typing the library has not reported yet is not in
  // `editor.get()`, so a host answer arriving meanwhile leaves the newer keystrokes in place.
  //
  // A tree or table edit is already in the library's data when it is sent. When the host answers
  // it, the editor keeps that data instead of parsing the whole new text again (UNK-014): the host
  // applied the same operations, so the text holds the same data. Text mode still shows the
  // document's own bytes (criterion 10), so it gets the text when it is shown.
  /** The version and text of the document as the host last sent them. */
  let docVersion = 0;
  let docText = '';
  let inFlight = false;
  /** The change in flight, or the last one sent. */
  let sent: DocumentChange | undefined;
  /** Every change sent since the library last got the host's text was already in its data, so
   *  once all are answered its data is the document's. */
  let ownChanges = true;

  /** A change waiting to be sent; `shown` when the library already holds it. */
  interface Pending {
    change: DocumentChange;
    shown: boolean;
  }
  /** Changes and undo/redo steps waiting to go to the host, oldest first. */
  const queued: (Pending | { kind: 'undo' } | { kind: 'redo' })[] = [];
  /** `flush` requests to answer once nothing the UI made is waiting for the host (003 T7). */
  const flushes: number[] = [];
  /** The text-mode sort dialog was opened from the menu: text written while it is open is the
   *  sort (003 T8). */
  let textSortPending = false;

  onMount(() => {
    let disposed = false;
    const subscription = host.onExternalChange(onHostEvent);
    // Capture phase on the window, so neither the library nor the page around it sees the keys:
    // the library would undo in its own history, and the VS Code webview would forward the key to
    // the workbench, which undoes the document as well (003 T7: two undos for one key).
    window.addEventListener('keydown', onKeydown, true);
    void host.open().then((doc) => {
      if (disposed) return;
      docVersion = doc.docVersion;
      docText = doc.text;
      format = doc.format;
      largeFile = doc.largeFile;
      badLines = findBadLines();
      // A mode not offered (text mode for a large file or JSON Lines) opens the first one offered.
      mode = modes.includes(doc.mode) ? doc.mode : modes[0];
      editor = createJSONEditor({
        target,
        props: {
          content: { text: doc.text },
          mode: mode as LibraryMode,
          readOnly,
          parser: parserFor(doc.format, doc.largeFile !== null),
          // The library hands the validator data read by this parser too; its default, JSON.parse,
          // fails on JSONC and JSON5 text in text mode and reports that as a parse error (004 T5).
          validationParser: validationParserFor(doc.format, doc.largeFile !== null),
          validator: validatorFor(validation),
          queryLanguages: QUERY_LANGUAGES,
          queryLanguageId: QUERY_LANGUAGES[0]!.id,
          onChangeQueryLanguage: (id: string) => (chosenQueryLanguageId = id),
          onRenderMenu: renderMenu,
          onRenderContextMenu: renderContextMenu,
          onChange,
          onChangeMode,
          onSelect: (next: JSONEditorSelection | undefined) => (selection = next),
        },
      });
      // Criterion 10's test hook: the editor shows the document (the engine is not loaded yet).
      performance.mark('chr:document-shown');
    });
    // Capture phase: these run before the library's own handlers and can stop them.
    target.addEventListener('keydown', interceptShortcut, true);
    target.addEventListener('click', interceptRepair, true);
    target.addEventListener('click', recordSort, true);
    return () => {
      disposed = true;
      target.removeEventListener('keydown', interceptShortcut, true);
      target.removeEventListener('click', interceptRepair, true);
      target.removeEventListener('click', recordSort, true);
      subscription.dispose();
      window.removeEventListener('keydown', onKeydown, true);
      void editor?.destroy();
    };
  });

  /** Runs a whole-document action in the host (003 T8): format, smart format (spec 010), compact or
   *  repair. */
  export function runAction(name: Exclude<DocumentAction['name'], 'sort'>): void {
    if (!editor) return;
    flushText();
    queue({ kind: 'action', action: { name } });
  }

  /** In text mode, hands typing the library has not reported yet to `onChange`, so an action
   *  queued next runs on the text as typed (`validate()` flushes the library's debounce first). */
  function flushText(): void {
    if (mode === 'text') editor?.validate();
  }

  /** The library's menus with format, compact, sort and transform routed through core. A large
   *  file's main menu has no text mode, and a locked one no such actions (spec 008 criterion 2); a
   *  JSON Lines one has Table and Tree, and no format or compact (spec 012 criterion 6). */
  function renderMenu(items: MenuItem[], context: RenderMenuContext): MenuItem[] {
    let routed = onRenderMenu(items, context);
    if (modes !== MODES && !context.modal) routed = offeredModes(routed);
    if (format === 'jsonl' && !context.modal) {
      routed = routed.filter(
        (item) =>
          !(item.type === 'button' && JSON_LINES_HIDDEN.some((c) => item.className?.includes(c))),
      );
    }
    if (locked && !context.modal) return routed.filter((item) => !isActionButton(item));
    if (context.modal || context.readOnly) return routed;
    return routed.flatMap((item): MenuItem | MenuItem[] => {
      if (item.type !== 'button') return item;
      switch (item.className) {
        case 'jse-format': {
          const formatItem = { ...item, onClick: () => runAction('format') };
          // Spec 010 criterion 7: "Smart format" between Format and Compact, in text mode only,
          // and not for JSON Lines (spec 010 §Scope).
          if (context.mode !== 'text' || format === 'jsonl') return formatItem;
          return [
            formatItem,
            {
              type: 'button',
              icon: SMART_FORMAT_ICON,
              title: 'Smart format: keep short arrays and objects on one line',
              className: SMART_FORMAT_CLASS,
              onClick: () => runAction('smartFormat'),
              disabled: item.disabled,
            },
          ];
        }
        case 'jse-compact':
          return { ...item, onClick: () => runAction('compact') };
        case 'jse-sort':
          // The library's dialog picks the order; in text mode its result arrives as new text.
          if (context.mode !== 'text') return item;
          return {
            ...item,
            onClick: (event: MouseEvent) => {
              flushText();
              textSortPending = true;
              item.onClick(event);
            },
          };
        case 'jse-transform':
          // In tree and table mode the result arrives as a patch (see `routePatch`).
          if (context.mode !== 'text') {
            return {
              ...item,
              onClick: (event: MouseEvent) => withQueryEngine(() => item.onClick(event)),
            };
          }
          return { ...item, onClick: () => withQueryEngine(transformText) };
        default:
          return item;
      }
    });
  }

  /** The context menu's Transform (tree and table mode) waits for the query engine too. */
  function renderContextMenu(items: ContextMenuItem[]): ContextMenuItem[] {
    return items.map(function route<T>(item: T): T {
      if (isContextMenuRow(item) || isContextMenuColumn(item)) {
        return { ...item, items: item.items.map(route) };
      }
      if (isMenuButton(item) && item.text === 'Transform') {
        return {
          ...item,
          onClick: (event: MouseEvent) => withQueryEngine(() => item.onClick(event)),
        };
      }
      return item;
    });
  }

  /** The library's own mode switch with the offered modes only, in `modes`' order, where the
   *  library put its group; the first and last of them round the group's corners. */
  function offeredModes(items: MenuItem[]): MenuItem[] {
    const modeOf = (item: MenuItem): Mode | undefined =>
      isMenuButton(item)
        ? MODES.find((m) => item.title?.startsWith(`Switch to ${m} mode`))
        : undefined;
    const at = items.findIndex((item) => modeOf(item) !== undefined);
    if (at < 0) return items;
    const group = modes.flatMap((m, i) => {
      const item = items.find((candidate) => modeOf(candidate) === m);
      if (!item || !isMenuButton(item)) return [];
      const className = (item.className ?? '').replace(/\s*\bjse-(first|last)\b/g, '');
      const edges = `${i === 0 ? ' jse-first' : ''}${i === modes.length - 1 ? ' jse-last' : ''}`;
      return [{ ...item, className: className + edges }];
    });
    const rest = items.filter((item) => modeOf(item) === undefined);
    return [...rest.slice(0, at), ...group, ...rest.slice(at)];
  }

  function isActionButton(item: MenuItem): boolean {
    return item.type === 'button' && ACTION_BUTTONS.some((name) => item.className?.includes(name));
  }

  /** "Open as Text" in the large-file or bad-line banner: the host's own text editor takes over. */
  function openAsText(): void {
    host.openAsText(docVersion);
  }

  /** "Repair Lines" in the bad-line banner (spec 012 criterion 8, L10): one action the host runs on
   *  the document's text; the lines it could not repair are named once its answer arrives. */
  function repairLines(): void {
    if (!editor || !badLines) return;
    queue({ kind: 'action', action: { name: 'repairLines' } });
  }

  /** The document's bad lines when it is JSON Lines (criterion 8). Core's parse is the one the
   *  library's parser reads the same text with (core keeps the last parse per format), so this
   *  costs no second parse. Large JSON Lines files are 012 T6's (spec 012 criterion 10). */
  function findBadLines(): number[] | null {
    if (format !== 'jsonl') return null;
    const errors = getAdapter('jsonl')
      .parse(docText)
      .diagnostics.filter((d) => d.severity === 'error');
    if (errors.length === 0) return null;
    // Each error spans its line (L1), in order: count the line feeds before each one.
    let line = 1;
    let lf = docText.indexOf('\n');
    return errors.map(({ offset }) => {
      while (lf >= 0 && lf < offset) {
        line += 1;
        lf = docText.indexOf('\n', lf + 1);
      }
      return line;
    });
  }

  /** After "Repair Lines": the bad lines left are the ones it could not repair (L10). */
  function nameUnrepaired(): void {
    if (!badLines) return;
    const list = badLines.length === 1 ? `line ${badLines[0]}` : `lines ${badLines.join(', ')}`;
    notice = `Repair Lines could not repair ${list}.`;
  }

  /** `count` with its noun, singular for one. */
  function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
  }

  /** Reads the bad lines of the host's text again; the tab is read-only while one is left. */
  function checkLines(): void {
    const before = readOnly;
    badLines = findBadLines();
    if (readOnly !== before) editor?.updateProps({ readOnly });
  }

  /** "Edit anyway" in the large-file banner (criterion 4): editable until the tab closes. The host
   *  hears it before any change made after it, since messages keep their order. */
  function unlock(): void {
    if (!largeFile || largeFile.unlocked) return;
    largeFile = { ...largeFile, unlocked: true };
    host.unlock(docVersion);
    editor?.updateProps({ readOnly: false });
  }

  /** Text mode's transform: the library's dialog, with its result sent as data, not as text. */
  function transformText(): void {
    if (!editor) return;
    flushText();
    editor.transform({
      rootPath: [],
      onTransform: ({ json, transformedJson }) => {
        const change = dataChange('', json, transformedJson);
        if (change) queue(change);
      },
    });
  }

  /** Text mode's format and compact shortcuts (Ctrl+I, Ctrl+Shift+I) run core's actions. */
  function interceptShortcut(event: KeyboardEvent): void {
    if (mode !== 'text' || !(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (event.key.toLowerCase() !== 'i') return;
    event.preventDefault();
    event.stopPropagation();
    runAction(event.shiftKey ? 'compact' : 'format');
  }

  /** The library's "Auto repair" buttons (text mode's parse error message and lint tooltip) run
   *  core's comment-keeping repair (UNK-018) instead of rewriting the text with jsonrepair. */
  function interceptRepair(event: MouseEvent): void {
    const button = (event.target as Element | null)?.closest('button');
    if (button?.textContent?.trim() !== 'Auto repair') return;
    event.preventDefault();
    event.stopPropagation();
    runAction('repair');
  }

  /** Queues `change` for the host; `shown` when the library already shows its result. */
  function queue(change: DocumentChange, shown = false): void {
    // A locked large file sends nothing (spec 008 criterion 2), nor JSON Lines with a bad line but
    // its repair (spec 012 criterion 8); the editor shows the document again.
    if (locked) return;
    if (badLines && !(change.kind === 'action' && change.action.name === 'repairLines')) return;
    queued.push({ change, shown });
    sendNext();
  }

  /** Whether the host's text parses in the current format. */
  function documentParses(): boolean {
    try {
      parserFor(format ?? 'json', largeFile !== null).parse(docText);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The changes for a tree or table patch. On a document that does not parse, the library shows
   * jsonrepair's reading of it, and the only edit is accepting that view ("Ok", a `replace` of the
   * root) or one made on it: either way core repairs the text first (repair on open, UNK-018). A
   * patch that replaces a whole object or array with new data (sort, transform, a paste) goes as
   * data (data-change.ts). Every other patch goes as it is.
   */
  function routePatch(redo: JsonPatchOperation[], previousJson: unknown): DocumentChange[] {
    if (!documentParses()) {
      const repair: DocumentChange = { kind: 'action', action: { name: 'repair' } };
      const accept = redo.length === 1 && redo[0]!.op === 'replace' && redo[0]!.path === '';
      return accept ? [repair] : [repair, { kind: 'patch', patch: redo }];
    }
    const only = redo.length === 1 ? redo[0]! : undefined;
    if (only?.op === 'replace' && isContainer(only.value)) {
      const before: unknown = getIn(previousJson, parseJSONPointer(only.path));
      if (isContainer(before)) {
        const sorted = exactSort(only.path, before, only.value);
        if (sorted !== undefined) {
          // The library shows its own order, which B3's may differ from: show the host's text.
          ownChanges = false;
          return sorted ? [sorted] : [];
        }
        const change = dataChange(only.path, before, only.value);
        return change ? [change] : [];
      }
    }
    return [{ kind: 'patch', patch: redo }];
  }

  /** The changes for new data at the root: a repair when the document does not parse (repair on
   *  open, UNK-018), else the data change from what the document holds (data-change.ts). */
  function replaceRoot(json: unknown): DocumentChange[] {
    if (!documentParses()) return [{ kind: 'action', action: { name: 'repair' } }];
    const change = dataChange(
      '',
      parserFor(format ?? 'json', largeFile !== null).parse(docText),
      json,
    );
    return change ? [change] : [];
  }

  /** The library's text-mode sort, read back from the text it wrote: a reordering of the root,
   *  sent as core's sort (R13), or undefined when the text is not one. */
  function sortDialogOpen(): boolean {
    return target.querySelector('dialog.jse-sort-modal[open]') !== null;
  }

  /** The sort, or null for a sort in B3's order that leaves the document as it is (015 T4). */
  function textSort(previous: Content, updated: string): DocumentChange | null | undefined {
    const parser = parserFor(format ?? 'json', largeFile !== null);
    try {
      const before: unknown =
        typeof (previous as { text?: unknown }).text === 'string'
          ? parser.parse((previous as { text: string }).text)
          : (previous as { json: unknown }).json;
      const after = parser.parse(updated);
      const sorted = exactSort('', before, after);
      if (sorted !== undefined) return sorted;
      const change = dataChange('', before, after);
      return change?.kind === 'action' ? change : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Sorts the user asked for that the library has not handed over yet (spec 015 B3, sort-order.ts),
   * by the JSON Pointer of the array. One asked for in the library's "Edit nested content" dialog
   * waits for that dialog's Apply; any other arrives at once, or is dropped.
   */
  const sortRequests = new Map<string, SortRequest & { nested: boolean }>();

  /**
   * Notes the sort a click asks the library for (capture phase, before the library's handler runs):
   * the sort dialog's Sort button (the array's path, its property and direction selects), or a
   * table column header (the column, and the direction the library turns it to). In a nested
   * dialog, paths are relative to its content, whose path the dialog shows.
   */
  function recordSort(event: MouseEvent): void {
    const button = (event.target as Element | null)?.closest('button');
    if (!button) return;
    const nested = target.querySelector<HTMLInputElement>(
      'dialog.jse-jsoneditor-modal[open] input.jse-path',
    );
    let path: JSONPath;
    let request: SortRequest;
    if (button.classList.contains('jse-column-header')) {
      if (button.classList.contains('jse-readonly')) return;
      const name = (button.getAttribute('title') ?? '').replace(/ \(Click to sort[^)]*\)$/, '');
      const sorted = button.querySelector('.jse-column-sort-icon')?.getAttribute('title') ?? '';
      path = [];
      request = {
        itemPath: (items) => columnPath(name, items, parseJSONPath),
        // The library turns an ascending column descending, and any other ascending.
        direction: sorted.includes('ascending') ? -1 : 1,
      };
    } else {
      const dialog = button.closest('.jse-sort-modal');
      if (!dialog || !button.classList.contains('jse-primary')) return;
      path = pathOfLabel(dialog.querySelector<HTMLInputElement>('input.jse-path')?.value ?? '');
      const property = selectValue(dialog, 'Property');
      const itemPath = Array.isArray(property) ? (property as JSONPath) : undefined;
      request = {
        itemPath: itemPath ? () => itemPath : onlyNestedPath,
        direction: selectValue(dialog, 'Direction') === -1 ? -1 : 1,
      };
    }
    const base = nested ? pathOfLabel(nested.value) : [];
    const pointer = compileJSONPointer([...base, ...path]);
    const entry = { ...request, nested: nested !== null };
    sortRequests.set(pointer, entry);
    if (!nested) {
      setTimeout(() => {
        if (sortRequests.get(pointer) === entry) sortRequests.delete(pointer);
      }, 0);
    }
  }

  /** A path as the library's dialogs show it (`stringifyJSONPath`, or "(document root)"). */
  function pathOfLabel(label: string): JSONPath {
    return label === '' || label === '(document root)' ? [] : parseJSONPath(label);
  }

  /** The `value` of the option chosen in the sort dialog's select on the row headed `heading`
   *  (svelte-select keeps it, as JSON, in a hidden input). */
  function selectValue(dialog: Element, heading: string): unknown {
    for (const row of dialog.querySelectorAll('tr')) {
      if (row.querySelector('th')?.textContent?.trim() !== heading) continue;
      const input = row.querySelector<HTMLInputElement>('input[type="hidden"]');
      try {
        return (JSON.parse(input?.value ?? 'null') as { value?: unknown } | null)?.value;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * Core's sort action for a sort the user asked for at `path` (recordSort), with the items of
   * `before` in B3's order rather than the library's `after` (sort-order.ts); null when that order
   * leaves them as they are. Undefined when no sort was asked for there, or `after` is not a
   * reordering of the array `before` (an edit made after a sort in a nested dialog).
   */
  function exactSort(
    path: string,
    before: unknown,
    after: unknown,
  ): DocumentChange | null | undefined {
    const request = sortRequests.get(path);
    if (!request) return undefined;
    sortRequests.delete(path);
    if (request.nested && !target.querySelector('dialog.jse-jsoneditor-modal[open]'))
      return undefined;
    if (!Array.isArray(before)) return undefined;
    const libraryOrder = reordering(before, after);
    if (!libraryOrder) return undefined;
    const order = exactOrder(before, libraryOrder, request);
    if (order.every((from, to) => from === to)) return null;
    return { kind: 'action', action: { name: 'sort', path, order } };
  }

  /**
   * Test hook (spec 003 criterion 1): sends operations down the same path as a tree or table edit,
   * as if the library had reported them. The library's own `patch()` neither reports a change nor
   * applies to a document with no value, so it is not used; the view follows the host's answer.
   * Given as JSON text, the operations are read with the editor's parser, so their big numbers are
   * the editor's (spec 015 criterion 4: a value typed with more digits than a float holds).
   */
  export function patch(given: JsonPatchOperation[] | string): void {
    if (!editor) throw new Error('The editor is not mounted yet');
    const operations =
      typeof given === 'string' ? (parserFor('json').parse(given) as JsonPatchOperation[]) : given;
    // A locked large file sends no edit (spec 008 criterion 2), nor JSON Lines with a bad line
    // (spec 012 criterion 8), and the library's `readOnly` data stays as it is.
    if (readOnly) return;
    // A tree edit is in the library's data before it is sent; `patch()` puts it there the same way.
    // Where it cannot (text mode, a document with no value, a path that does not exist), the
    // editor shows the host's answer instead.
    let shown = false;
    if (mode !== 'text') {
      try {
        editor.patch(operations);
        shown = true;
      } catch {
        // The host reports the operations' error, if they have one.
      }
    }
    queued.push({ change: { kind: 'patch', patch: operations }, shown });
    sendNext();
  }

  /** Selects the node at JSON Pointer `path` in tree mode, as a click on its row does (e2e test
   *  hooks, 009 T4). The library does not report its own `select` to `onSelect`, so the selection
   *  is kept here too. */
  export function select(path: string): void {
    const at = parseJSONPointer(path);
    selection = createMultiSelection(at, at);
    editor?.select(selection);
  }

  /**
   * What "Export to CSV…" exports (spec 009 criterion 7), as a JSON Pointer: in table mode, the
   * array the table shows, which is always the document's root (the library's table mode shows
   * the root array, and opens a nested one in a dialog of its own); in tree mode, the one value
   * selected (a value, or a row selected alone); otherwise `''`, the document's data. The host
   * checks that the value there is an array or an object.
   */
  function rowSourcePath(): string {
    if (mode !== 'tree' || !selection) return '';
    if (isValueSelection(selection)) return compileJSONPointer(selection.path);
    if (isMultiSelection(selection)) {
      const anchor = compileJSONPointer(selection.anchorPath);
      if (anchor === compileJSONPointer(selection.focusPath)) return anchor;
    }
    return '';
  }

  /** What the editor holds now, for tests. */
  export function content(): Content | undefined {
    return editor?.get();
  }

  /** Whether every change was answered and the editor shows the document, for tests. */
  export function settled(): boolean {
    return editor !== undefined && !inFlight && queued.length === 0;
  }

  function selectMode(next: Mode): void {
    if (!modes.includes(next)) return;
    mode = next;
    editor?.updateProps({ mode: next as LibraryMode });
    showDocument();
  }

  function onChangeMode(next: LibraryMode): void {
    if (!modes.includes(next as Mode)) {
      // Not offered in large-file mode (criterion 2): back to the mode the toolbar shows.
      editor?.updateProps({ mode: mode as LibraryMode });
      return;
    }
    mode = next as Mode;
    textSortPending = false;
    showDocument();
  }

  function onChange(updated: Content, previous: Content, status: OnChangeStatus): void {
    if (status.patchResult) {
      const { redo, previousJson } = status.patchResult;
      const changes = routePatch(redo as JsonPatchOperation[], previousJson);
      // Only a patch sent as the library applied it is already in what the library shows; the host
      // answers a repair, a sort or a diff with text the library has not seen.
      const asApplied =
        changes.length === 1 && changes[0]!.kind === 'patch' && changes[0]!.patch === redo;
      for (const c of changes) queue(c, asApplied);
      // Nothing to send (a sort that kept the order): show the host's text again.
      showDocument();
      return;
    }
    // The library hands content with both `text` and `json` keys, one of them undefined.
    const text = (updated as { text?: unknown }).text;
    if (typeof text !== 'string') {
      // New data for the whole document without a patch (tree mode: accepting the library's
      // repaired view with "Ok", or a paste over the root).
      for (const c of replaceRoot((updated as { json: unknown }).json)) queue(c);
      showDocument();
      return;
    }
    // The library writes the sorted text while its dialog is still open (SortModal.svelte calls
    // onSort before onClose). Text that comes once the dialog is gone is typing: the sort was
    // cancelled, or kept the order and wrote nothing.
    if (textSortPending) {
      textSortPending = false;
      const sort = sortDialogOpen() ? textSort(previous, text) : undefined;
      if (sort) {
        queue(sort);
        return;
      }
      if (sort === null) {
        // B3's order is the document's own: the library's text goes nowhere.
        showText();
        return;
      }
    }
    // Text mode (003 T6, criterion 9): the library reports typing once it pauses for
    // TEXT_DEBOUNCE_MS (text-mode.ts), and the whole text goes to the host, which writes only the
    // changed span. The text goes as typed, valid or not: an error marker shows a parse error,
    // and the document never gets a repaired text in its place. Only the newest text matters.
    const last = queued.at(-1);
    if (last && 'change' in last && last.change.kind === 'text') queued.pop();
    // Typed text is already in what the library shows.
    queue({ kind: 'text', text }, true);
  }

  function sendNext(): void {
    while (!inFlight) {
      const next = queued.shift();
      if (!next) break;
      if ('change' in next) {
        inFlight = true;
        sent = next.change;
        if (!next.shown) ownChanges = false;
        host.save(docVersion, next.change);
      } else {
        // The step changes the document to something the library does not hold.
        ownChanges = false;
        if (next.kind === 'undo') host.undo(docVersion);
        else host.redo(docVersion);
      }
    }
    answerFlushes();
  }

  /** Undo or redo in the host's history, after every change made before it (003 T7). */
  async function history(kind: 'undo' | 'redo'): Promise<void> {
    // A locked large file's document never changes from here (spec 008 criterion 2).
    if (locked) return;
    await reportTyping();
    queued.push({ kind });
    sendNext();
  }

  /**
   * The undo and redo keys VS Code binds: Ctrl+Z; Ctrl+Y and Ctrl+Shift+Z (Cmd on macOS). They never
   * reach the library or the page around it. In a field being typed in, they undo that field's
   * typing, as the browser does it; anywhere else they go to the host's history.
   */
  function onKeydown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const z = isKey(event, 'z', 'KeyZ');
    const y = isKey(event, 'y', 'KeyY');
    if (!z && !y) return;
    event.stopPropagation();
    if (isField(event.target)) return;
    event.preventDefault();
    void history(z && !event.shiftKey ? 'undo' : 'redo');
  }

  /**
   * Whether `target` is a field the user types a value into (a key or value edited inline in tree
   * or table mode, the search boxes of every mode, a modal's inputs), whose own typing the browser
   * undoes (003 T7 F1). Not tree and table mode's hidden input, which only catches keys for the
   * whole view, and not CodeMirror's text (`.cm-content`), which in text mode is the document
   * itself (UNK-032: one in a modal).
   */
  function isField(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.classList.contains('jse-hidden-input') || target.closest('.cm-content'))
      return false;
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target.isContentEditable
    );
  }

  /** `letter` as the layout types it, or its physical key where the layout types no Latin letter. */
  function isKey(event: KeyboardEvent, letter: string, code: string): boolean {
    const key = event.key.toLowerCase();
    return key === letter || (!/^[a-z]$/.test(key) && event.code === code);
  }

  /** The library's undo and redo buttons go to the host's history too; modals keep their own. */
  function onRenderMenu(items: MenuItem[], context: { modal: boolean }): MenuItem[] {
    if (context.modal) return items;
    return items.map((item) => {
      if (!isMenuButton(item)) return item;
      const kind = item.className?.includes('jse-undo')
        ? 'undo'
        : item.className?.includes('jse-redo')
          ? 'redo'
          : undefined;
      // Enabled always: the host's history, not the library's, says whether there is a step.
      return kind ? { ...item, disabled: false, onClick: () => void history(kind) } : item;
    });
  }

  /**
   * Has text mode report typing it holds back (text-mode.ts: it reports once typing pauses, or at
   * once when the editor loses focus), so it goes to the host before an undo or a save. The only
   * way the library offers is losing focus, so focus leaves and comes back; the library notices a
   * blur on a zero-delay timer, so this waits one too. Tree and table mode report every edit at
   * once.
   */
  async function reportTyping(): Promise<void> {
    const active = document.activeElement;
    if (mode !== 'text' || !(active instanceof HTMLElement) || !target.contains(active)) return;
    active.blur();
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (active.isConnected && document.activeElement === document.body) {
      active.focus({ preventScroll: true });
    }
  }

  /** Answers the host's `flush` requests once nothing the UI made waits for an answer. */
  function answerFlushes(): void {
    if (inFlight || queued.length > 0) return;
    for (const request of flushes.splice(0)) host.flushed(docVersion, request);
  }

  /**
   * The library's `validator` for a host result: a new function per result, so the library
   * validates again when one arrives. It reports the errors only while the editor shows the text
   * they describe (the same `docVersion`, no edit pending); otherwise none, until the host's
   * result for the new text arrives. Undefined when there are no errors to show.
   */
  function validatorFor(message: ValidationMessage | undefined): Validator | undefined {
    if (message?.result.kind !== 'errors' || message.result.errors.length === 0) return undefined;
    const errors: ValidationError[] = message.result.errors.map((e) => ({
      path: parseJSONPointer(e.instancePath),
      message: e.message,
      // As the library's own Ajv validator and VS Code's JSON language service report them.
      severity: ValidationSeverity.warning,
    }));
    const forVersion = message.docVersion;
    return () => (forVersion === docVersion && !inFlight && queued.length === 0 ? errors : []);
  }

  /** `bytes` in MiB with one decimal, rounded down (spec 008 criterion 3). */
  function sizeMiB(bytes: number): string {
    return (Math.floor((bytes * 10) / 2 ** 20) / 10).toFixed(1);
  }

  /** Hands the latest result to the library again, after it arrives or the shown text changes. */
  function showValidation(): void {
    editor?.updateProps({ validator: validatorFor(validation) });
  }

  function selectDialect(dialect: SchemaDialect): void {
    host.setSchemaDialect(docVersion, dialect);
  }

  /**
   * Shows the host's text, unless the editor already shows it or has unsent changes on top. In tree
   * and table mode, data the library made itself and the host answered counts as shown.
   */
  function showDocument(): void {
    if (!editor || inFlight || queued.length > 0) return;
    const shown = editor.get();
    if ('text' in shown && shown.text === docText) return;
    if ('json' in shown && ownChanges && mode !== 'text') return;
    showText();
  }

  /** Gives the library the host's text. */
  function showText(): void {
    // Text content, even in tree and table mode: the library parses it with the core parser, and
    // text mode then shows the document's own bytes, comments included (criterion 10).
    ownChanges = true;
    editor?.update({ text: docText });
  }

  function onHostEvent(event: HostEvent): void {
    switch (event.type) {
      case 'update':
        if (event.origin === 'edit') {
          // The answer to the edit in flight: the text it produced.
          inFlight = false;
          docVersion = event.docVersion;
          docText = event.text;
          notice = undefined;
          checkLines();
          if (sent?.kind === 'action' && sent.action.name === 'repairLines') nameUnrepaired();
          sendNext();
          showDocument();
          showValidation();
          return;
        }
        if (event.docVersion <= docVersion) return;
        docVersion = event.docVersion;
        docText = event.text;
        notice = undefined;
        checkLines();
        if (queued.length > 0) {
          // Made on a document that has changed since; dropped, like the edit in flight will be.
          queued.length = 0;
          notice = 'The document changed outside the editor; your latest change was not applied.';
        }
        if (!inFlight) showText();
        showValidation();
        answerFlushes();
        return;
      case 'validation':
        validation = event;
        showValidation();
        return;
      case 'setMode':
        selectMode(event.mode);
        return;
      case 'setFormat':
        format = event.format;
        checkLines();
        editor?.updateProps({
          parser: parserFor(event.format, largeFile !== null),
          validationParser: validationParserFor(event.format, largeFile !== null),
          // A new function, so the library renders its menus again for the new format's modes and
          // actions (spec 012 criterion 6).
          onRenderMenu: (items: MenuItem[], context: RenderMenuContext) =>
            renderMenu(items, context),
        });
        // JSON Lines has no text mode: its first mode instead (criterion 6).
        if (mode && !modes.includes(mode)) selectMode(modes[0]!);
        // Parse the document's text again with the new format (criterion 8); bytes are unchanged.
        if (!inFlight && queued.length === 0) showText();
        return;
      case 'error':
        notice = event.message;
        if (isEditError(event)) {
          // The edit in flight was not applied: drop what was made on top of it and show the
          // document as the host has it.
          inFlight = false;
          queued.length = 0;
          if (event.docVersion > docVersion) docVersion = event.docVersion;
          showText();
          showValidation();
          answerFlushes();
        }
        return;
      case 'flush':
        flushes.push(event.request);
        void reportTyping().then(answerFlushes);
        return;
      case 'getRowSource':
        host.rowSource(docVersion, event.request, rowSourcePath());
        return;
    }
  }
</script>

<div class="shell chr-theme">
  <div class="toolbar" role="toolbar" aria-label="Editor">
    <div class="modes" role="group" aria-label="Mode">
      {#each modes as m (m)}
        <button type="button" aria-pressed={mode === m} onclick={() => selectMode(m)}>
          {MODE_LABELS[m]}
        </button>
      {/each}
    </div>
    <div class="status">
      {#if validation && validation.result.kind !== 'none'}
        <span class="schema">
          {#if validation.dialect?.switchable}
            <select
              aria-label="Schema dialect"
              title="The schema names no dialect this editor knows; choose the one to validate with"
              value={validation.dialect.name}
              onchange={(e) => selectDialect(e.currentTarget.value as SchemaDialect)}
            >
              {#each SCHEMA_DIALECTS as d (d)}
                <option value={d}>
                  {d === validation.dialect.name && validation.dialect.assumed ? `assumed ${d}` : d}
                </option>
              {/each}
            </select>
          {:else if validation.dialect}
            <span title="The schema's dialect">{validation.dialect.name}</span>
          {/if}
          {#if validation.result.kind === 'skipped'}
            <span class="reason">Not validated: {validation.result.reason}</span>
          {/if}
        </span>
      {/if}
      {#if format}
        <span class="format" title="Detected format">{FORMAT_LABELS[format]}</span>
      {/if}
    </div>
  </div>
  {#if largeFile}
    <div class="banner" role="region" aria-label="Large file">
      <span>
        Large file ({sizeMiB(largeFile.bytes)} MiB): {locked
          ? 'read-only to stay fast.'
          : 'edits may be slow.'}
      </span>
      <button type="button" onclick={openAsText}>Open as Text</button>
      {#if locked}
        <button type="button" onclick={unlock}>Edit anyway</button>
      {/if}
    </div>
  {/if}
  {#if badLines}
    <div class="banner" role="region" aria-label="Bad lines">
      <span>
        Line {badLines[0]} is not valid JSON ({plural(badLines.length, 'bad line')}).
      </span>
      <button type="button" onclick={openAsText}>Open as Text</button>
      <button type="button" onclick={repairLines}>Repair Lines</button>
    </div>
  {/if}
  <div class="notice" role="status">{notice ?? ''}</div>
  <div class="editor" bind:this={target}></div>
</div>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--vscode-editor-background);
    color: var(--vscode-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px;
  }
  .modes {
    display: flex;
  }
  .modes button {
    font: inherit;
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground, var(--vscode-editor-background));
    border: 1px solid var(--vscode-button-border, var(--vscode-contrastBorder, transparent));
  }
  .modes button:hover {
    background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground));
  }
  .modes button[aria-pressed='true'] {
    font-weight: bold;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }
  .modes button:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 1px;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
    min-width: 0;
  }
  .schema {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .schema select {
    font: inherit;
    color: var(--vscode-dropdown-foreground);
    background: var(--vscode-dropdown-background);
    border: 1px solid var(--vscode-dropdown-border, transparent);
  }
  .schema select:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
  }
  .reason {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /*
    Text-mode lint marks (004 T5). CodeMirror draws the squiggle under an error, and the gutter icon
    beside it, as `data:` SVG images, which the webview CSP's img-src blocks (spec 003 criterion 6
    allows only the webview source). These rules, more specific than CodeMirror's theme, draw the
    same marks with CSS instead, so no image is ever requested. Colours as the library's defaults.
    The same marks show a text-mode parse error (003 T6, criterion 9). Warnings (schema errors) get
    a triangle, as CodeMirror draws them, so they read apart from errors without colour.
  */
  .shell :global(.cm-lintRange) {
    background-image: none;
    text-decoration-line: underline;
    text-decoration-style: wavy;
    text-decoration-skip-ink: none;
  }
  .shell :global(.cm-lintRange-error) {
    text-decoration-color: var(--jse-error-color, #ee5341);
  }
  .shell :global(.cm-lintRange-warning) {
    text-decoration-color: var(--jse-warning-color, #fdc539);
  }
  .shell :global(.cm-lintRange-info),
  .shell :global(.cm-lintRange-hint) {
    text-decoration-color: var(--jse-info-color, #4f91ff);
  }
  .shell :global(.cm-lint-marker) {
    content: normal;
    box-sizing: border-box;
    width: 0.7em;
    height: 0.7em;
    margin: 0.15em;
    border-radius: 50%;
  }
  .shell :global(.cm-lint-marker-error) {
    background: var(--jse-error-color, #ee5341);
  }
  .shell :global(.cm-lint-marker-warning) {
    border-radius: 0;
    clip-path: polygon(50% 0, 100% 100%, 0 100%);
    background: var(--jse-warning-color, #fdc539);
  }
  .shell :global(.cm-lint-marker-info) {
    background: var(--jse-info-color, #4f91ff);
  }
  .banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    color: var(--vscode-editorWidget-foreground, var(--vscode-foreground));
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    border: 1px solid var(--vscode-editorWidget-border, var(--vscode-contrastBorder, transparent));
  }
  .banner button {
    font: inherit;
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground, var(--vscode-editor-background));
    border: 1px solid var(--vscode-button-border, var(--vscode-contrastBorder, transparent));
  }
  .banner button:hover {
    background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground));
  }
  .banner button:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 1px;
  }
  .notice:empty {
    display: none;
  }
  .editor {
    flex: 1;
    min-height: 0;
  }
</style>
