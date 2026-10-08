<!--
  The editor UI (003 T2, UNK-010: Svelte 5). A toolbar with the mode switch and the format badge
  around one vanilla-jsoneditor instance; every document change goes to the HostAdapter and every
  host event comes from it, so this component never knows which host it runs in (ADR-002).

  vanilla-jsoneditor bundles its own Svelte runtime, so it is mounted through its plain
  `createJSONEditor` API rather than used as a component of this app (UNK-027).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import {
    createJSONEditor,
    type Content,
    type JsonEditor,
    type Mode as LibraryMode,
    type OnChangeStatus,
  } from 'vanilla-jsoneditor';
  import type { HostAdapter, HostEvent } from './host-adapter.js';
  import { parserFor } from './parser.js';
  import {
    isEditError,
    MODES,
    type DocumentChange,
    type Format,
    type JsonPatchOperation,
    type Mode,
  } from './protocol.js';

  let { host }: { host: HostAdapter } = $props();

  const MODE_LABELS: Record<Mode, string> = { tree: 'Tree', text: 'Text', table: 'Table' };
  const FORMAT_LABELS: Record<Format, string> = { json: 'JSON', jsonc: 'JSONC', json5: 'JSON5' };

  let mode = $state<Mode | undefined>();
  let format = $state<Format | undefined>();
  let notice = $state<string | undefined>();
  let target: HTMLDivElement;
  let editor: JsonEditor | undefined;

  // Sync (003 T5). The host owns the document: the UI sends each change as an `edit` made on
  // `docVersion` and the host answers every edit, in order, with an `update` (origin `edit`) or an
  // edit error. Only one edit is in flight, so each is made on the version the host holds; changes
  // made meanwhile wait in `queued`. The library never reports a programmatic `update` as a change,
  // so text from the host is never echoed back. Typing the library has not reported yet is not in
  // `editor.get()`, so a host answer arriving meanwhile leaves the newer keystrokes in place.
  /** The version and text of the document as the host last sent them. */
  let docVersion = 0;
  let docText = '';
  let inFlight = false;
  const queued: DocumentChange[] = [];

  onMount(() => {
    let disposed = false;
    const subscription = host.onExternalChange(onHostEvent);
    void host.open().then((doc) => {
      if (disposed) return;
      docVersion = doc.docVersion;
      docText = doc.text;
      format = doc.format;
      mode = doc.mode;
      editor = createJSONEditor({
        target,
        props: {
          content: { text: doc.text },
          mode: doc.mode as LibraryMode,
          parser: parserFor(doc.format),
          onChange,
          onChangeMode: (next: LibraryMode) => (mode = next as Mode),
        },
      });
    });
    return () => {
      disposed = true;
      subscription.dispose();
      void editor?.destroy();
    };
  });

  /**
   * Test hook (spec 003 criterion 1): sends operations down the same path as a tree or table edit,
   * as if the library had reported them. The library's own `patch()` neither reports a change nor
   * applies to a document with no value, so it is not used; the view follows the host's answer.
   */
  export function patch(operations: JsonPatchOperation[]): void {
    if (!editor) throw new Error('The editor is not mounted yet');
    queued.push({ kind: 'patch', patch: operations });
    sendNext();
  }

  /** What the editor holds now, for tests. */
  export function content(): Content | undefined {
    return editor?.get();
  }

  function selectMode(next: Mode): void {
    mode = next;
    editor?.updateProps({ mode: next as LibraryMode });
  }

  function onChange(updated: Content, _previous: Content, status: OnChangeStatus): void {
    let change: DocumentChange;
    if (status.patchResult) {
      change = { kind: 'patch', patch: status.patchResult.redo as JsonPatchOperation[] };
    } else if ('text' in updated) {
      // Text mode (003 T6, criterion 9): the library reports typing once it pauses for
      // TEXT_DEBOUNCE_MS (text-mode.ts), and the whole text goes to the host, which writes only the
      // changed span. The text goes as typed, valid or not: an error marker shows a parse error,
      // and the document never gets a repaired text in its place. Only the newest text matters.
      const last = queued.at(-1);
      if (last?.kind === 'text') queued.pop();
      change = { kind: 'text', text: updated.text };
    } else {
      // Not produced by any edit the library makes today.
      host.showMessage({
        docVersion,
        code: 'unsupported-change',
        message: 'Change without a patch',
      });
      return;
    }
    queued.push(change);
    sendNext();
  }

  function sendNext(): void {
    if (inFlight) return;
    const change = queued.shift();
    if (!change) return;
    inFlight = true;
    host.save(docVersion, change);
  }

  /** Shows the host's text, unless the editor already shows it or has unsent changes on top. */
  function showDocument(): void {
    if (!editor || inFlight || queued.length > 0) return;
    const shown = editor.get();
    if ('text' in shown && shown.text === docText) return;
    // Text content, even in tree and table mode: the library parses it with the core parser, and
    // text mode then shows the document's own bytes, comments included (criterion 10).
    editor.update({ text: docText });
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
          sendNext();
          showDocument();
          return;
        }
        if (event.docVersion <= docVersion) return;
        docVersion = event.docVersion;
        docText = event.text;
        notice = undefined;
        if (queued.length > 0) {
          // Made on a document that has changed since; dropped, like the edit in flight will be.
          queued.length = 0;
          notice = 'The document changed outside the editor; your latest change was not applied.';
        }
        if (!inFlight) editor?.update({ text: docText });
        return;
      case 'setMode':
        selectMode(event.mode);
        return;
      case 'setFormat':
        format = event.format;
        editor?.updateProps({ parser: parserFor(event.format) });
        // Parse the document's text again with the new format (criterion 8); bytes are unchanged.
        if (!inFlight && queued.length === 0) editor?.update({ text: docText });
        return;
      case 'error':
        notice = event.message;
        if (isEditError(event)) {
          // The edit in flight was not applied: drop what was made on top of it and show the
          // document as the host has it.
          inFlight = false;
          queued.length = 0;
          if (event.docVersion > docVersion) docVersion = event.docVersion;
          editor?.update({ text: docText });
        }
        return;
    }
  }
</script>

<div class="shell">
  <div class="toolbar" role="toolbar" aria-label="Editor">
    <div class="modes" role="group" aria-label="Mode">
      {#each MODES as m (m)}
        <button type="button" aria-pressed={mode === m} onclick={() => selectMode(m)}>
          {MODE_LABELS[m]}
        </button>
      {/each}
    </div>
    {#if format}
      <span class="format" title="Detected format">{FORMAT_LABELS[format]}</span>
    {/if}
  </div>
  <div class="notice" role="status">{notice ?? ''}</div>
  <div class="editor" bind:this={target}></div>
</div>

<style>
  /*
    Theme (003 T9): every --jse-* colour and font the library reads comes from the --vscode-*
    variable VS Code gives the webview under the active theme. Where a theme leaves a colour out
    (high contrast leaves out many backgrounds), the chain falls back to another --vscode-*
    variable, never to a literal. So on a page with no --vscode-* variables at all (the standalone
    page, the Chrome app) each --jse-* variable is invalid, and the library keeps its own default.
  */
  .shell {
    --jse-font-family: var(--vscode-font-family);
    --jse-font-size: var(--vscode-font-size);
    --jse-font-size-main-menu: var(--vscode-font-size);
    --jse-font-family-mono: var(--vscode-editor-font-family);
    --jse-font-size-mono: var(--vscode-editor-font-size);

    --jse-theme-color: var(--vscode-button-background);
    --jse-theme-color-highlight: var(--vscode-button-hoverBackground);
    --jse-menu-color: var(--vscode-button-foreground);
    --jse-modal-editor-theme-color: var(--vscode-button-background);
    --jse-modal-editor-theme-color-highlight: var(--vscode-button-hoverBackground);
    --jse-background-color: var(--vscode-editor-background);
    --jse-text-color: var(--vscode-editor-foreground);
    --jse-text-readonly: var(--vscode-descriptionForeground);
    --jse-main-border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
    --jse-error-color: var(--vscode-errorForeground);
    --jse-warning-color: var(--vscode-editorWarning-foreground);
    --jse-info-color: var(--vscode-editorInfo-foreground);

    /* modals and tooltips */
    --jse-modal-background: var(--vscode-editorWidget-background);
    --jse-modal-code-background: var(--vscode-textCodeBlock-background);
    --jse-tooltip-color: var(--vscode-editorHoverWidget-foreground);
    --jse-tooltip-background: var(--vscode-editorHoverWidget-background);
    --jse-tooltip-border: 1px solid var(--vscode-editorHoverWidget-border);
    --jse-tooltip-action-button-color: var(--vscode-button-foreground);
    --jse-tooltip-action-button-background: var(--vscode-button-background);

    /* panels: gutter, navigation bar, search box, status bar */
    --jse-panel-background: var(--vscode-editorWidget-background);
    --jse-panel-color: var(--vscode-editorWidget-foreground);
    --jse-panel-color-readonly: var(--vscode-descriptionForeground);
    --jse-panel-border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
    --jse-panel-button-color-highlight: var(--vscode-editorWidget-foreground);
    --jse-panel-button-background-highlight: var(
      --vscode-toolbar-hoverBackground,
      var(--vscode-list-hoverBackground)
    );
    --jse-navigation-bar-background: var(--vscode-breadcrumb-background);
    --jse-navigation-bar-background-highlight: var(--vscode-list-hoverBackground);
    --jse-navigation-bar-dropdown-color: var(--vscode-breadcrumb-foreground);

    /* context menu */
    --jse-context-menu-background: var(--vscode-menu-background);
    --jse-context-menu-background-highlight: var(
      --vscode-menu-selectionBackground,
      var(--vscode-list-hoverBackground)
    );
    --jse-context-menu-color: var(--vscode-menu-foreground);
    --jse-context-menu-color-disabled: var(--vscode-disabledForeground);
    --jse-context-menu-separator-color: var(--vscode-menu-separatorBackground);
    --jse-context-menu-pointer-hover-background: var(
      --vscode-toolbar-hoverBackground,
      var(--vscode-list-hoverBackground)
    );

    /* contents: keys and values, in the colours VS Code's debug views use for them */
    --jse-key-color: var(--vscode-debugTokenExpression-name);
    --jse-value-color-number: var(--vscode-debugTokenExpression-number);
    --jse-value-color-boolean: var(--vscode-debugTokenExpression-boolean);
    --jse-value-color-null: var(--vscode-debugTokenExpression-boolean);
    --jse-value-color-string: var(--vscode-debugTokenExpression-string);
    --jse-value-color-url: var(--vscode-textLink-foreground);
    --jse-delimiter-color: var(--vscode-descriptionForeground);
    --jse-edit-outline: 2px solid var(--vscode-focusBorder);

    /* contents: selected, hovered, current line, search matches */
    --jse-selection-background-color: var(
      --vscode-list-inactiveSelectionBackground,
      var(--vscode-list-hoverBackground)
    );
    --jse-selection-background-inactive-color: var(
      --vscode-list-inactiveSelectionBackground,
      var(--vscode-list-hoverBackground)
    );
    --jse-hover-background-color: var(--vscode-list-hoverBackground);
    --jse-active-line-background-color: var(
      --vscode-editor-lineHighlightBackground,
      var(--vscode-editor-background)
    );
    --jse-search-match-background-color: var(
      --vscode-editor-findMatchHighlightBackground,
      var(--vscode-editor-background)
    );
    --jse-search-match-color: var(
      --vscode-editor-findMatchHighlightBackground,
      var(--vscode-editor-background)
    );
    --jse-search-match-outline: 1px solid
      var(--vscode-editor-findMatchHighlightBorder, var(--vscode-focusBorder));
    --jse-search-match-active-color: var(
      --vscode-editor-findMatchBackground,
      var(--vscode-editor-background)
    );
    --jse-search-match-active-outline: 1px solid
      var(--vscode-editor-findMatchBorder, var(--vscode-focusBorder));

    /* contents: collapsed array sections, inline tags, table */
    --jse-collapsed-items-background-color: var(--vscode-editorWidget-background);
    --jse-collapsed-items-selected-background-color: var(--vscode-list-hoverBackground);
    --jse-collapsed-items-link-color: var(--vscode-textLink-foreground);
    --jse-collapsed-items-link-color-highlight: var(--vscode-textLink-activeForeground);
    /* the library dims read-only tags (the item count) to opacity 0.7: badge colours fail contrast then */
    --jse-tag-background: var(--vscode-editorWidget-background);
    --jse-tag-color: var(--vscode-editorWidget-foreground);
    --jse-table-header-background: var(--vscode-editorWidget-background);
    --jse-table-header-background-highlight: var(--vscode-list-hoverBackground);
    --jse-table-row-odd-background: var(
      --vscode-tree-tableOddRowsBackground,
      var(--vscode-editor-background)
    );

    /* messages above the contents (parse errors, repair) */
    --jse-message-error-background: var(--vscode-inputValidation-errorBackground);
    --jse-message-error-color: var(--vscode-editor-foreground);
    --jse-message-warning-background: var(--vscode-inputValidation-warningBackground);
    --jse-message-warning-color: var(--vscode-editor-foreground);
    --jse-message-info-background: var(--vscode-inputValidation-infoBackground);
    --jse-message-info-color: var(--vscode-editor-foreground);
    --jse-message-action-background: var(--vscode-button-secondaryBackground);
    --jse-message-action-background-highlight: var(--vscode-button-secondaryHoverBackground);

    /* controls: inputs, buttons, links, dropdowns, colour picker */
    --jse-input-background: var(--vscode-input-background);
    --jse-input-color: var(--vscode-input-foreground);
    --jse-input-border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    --jse-input-border-focus: 1px solid var(--vscode-focusBorder);
    --jse-button-background: var(
      --vscode-button-secondaryBackground,
      var(--vscode-editor-background)
    );
    --jse-button-background-highlight: var(
      --vscode-button-secondaryHoverBackground,
      var(--vscode-list-hoverBackground)
    );
    --jse-button-color: var(--vscode-button-secondaryForeground);
    --jse-button-primary-background: var(--vscode-button-background);
    --jse-button-primary-background-highlight: var(--vscode-button-hoverBackground);
    --jse-button-primary-color: var(--vscode-button-foreground);
    --jse-button-secondary-background: var(
      --vscode-button-secondaryBackground,
      var(--vscode-editor-background)
    );
    --jse-button-secondary-background-highlight: var(
      --vscode-button-secondaryHoverBackground,
      var(--vscode-list-hoverBackground)
    );
    --jse-button-secondary-color: var(--vscode-button-secondaryForeground);
    --jse-a-color: var(--vscode-textLink-foreground);
    --jse-a-color-highlight: var(--vscode-textLink-activeForeground);
    --jse-svelte-select-background: var(--vscode-dropdown-background);
    --jse-svelte-select-border: 1px solid var(--vscode-dropdown-border);
    --list-background: var(--vscode-dropdown-background);
    --item-hover-bg: var(--vscode-list-hoverBackground);
    --input-color: var(--vscode-dropdown-foreground);
    --jse-color-picker-background: var(--vscode-editorWidget-background);

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
  .format {
    margin-left: auto;
  }
  /*
    Text-mode error markers (003 T6, criterion 9). CodeMirror's lint theme draws the squiggle under
    a parse error and the gutter marker as `data:` SVG images (@codemirror/lint 6.9.7, dist/index.js
    `baseTheme`), which the webview CSP blocks (no img-src, criterion 6): the error would show no
    marker. These rules draw both with CSS instead, in the theme's colours.
  */
  .shell :global(.cm-lintRange-error),
  .shell :global(.cm-lintRange-warning),
  .shell :global(.cm-lintRange-info),
  .shell :global(.cm-lintRange-hint) {
    background-image: none;
    text-decoration: underline wavy var(--marker-color);
    text-decoration-skip-ink: none;
  }
  .shell :global(.cm-lintRange-error),
  .shell :global(.cm-lint-marker-error) {
    --marker-color: var(--jse-error-color, #f43);
  }
  .shell :global(.cm-lintRange-warning),
  .shell :global(.cm-lint-marker-warning) {
    --marker-color: var(--jse-warning-color, #fd7);
  }
  .shell :global(.cm-lintRange-info),
  .shell :global(.cm-lintRange-hint),
  .shell :global(.cm-lint-marker-info) {
    --marker-color: var(--jse-info-color, #77e);
  }
  .shell :global(.cm-lint-marker) {
    content: normal;
    box-sizing: border-box;
    width: 0.8em;
    height: 0.8em;
    margin: 0.1em;
    background: var(--marker-color);
  }
  .shell :global(.cm-lint-marker-error) {
    border-radius: 50%;
  }
  .shell :global(.cm-lint-marker-warning) {
    clip-path: polygon(50% 0, 100% 100%, 0 100%);
  }
  .notice:empty {
    display: none;
  }
  .editor {
    flex: 1;
    min-height: 0;
  }
</style>
