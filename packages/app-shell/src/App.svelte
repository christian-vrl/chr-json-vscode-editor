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
  import {
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
  /** The version of the last document text the host sent; edits are made against it. */
  let docVersion = 0;
  /** What the editor shows, kept so a host echo of the UI's own edit is not pushed back in. */
  let content: Content = { text: '' };

  onMount(() => {
    let disposed = false;
    const subscription = host.onExternalChange(onHostEvent);
    void host.open().then((doc) => {
      if (disposed) return;
      docVersion = doc.docVersion;
      format = doc.format;
      mode = doc.mode;
      content = { text: doc.text };
      editor = createJSONEditor({
        target,
        props: {
          content,
          mode: doc.mode as LibraryMode,
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

  function selectMode(next: Mode): void {
    mode = next;
    editor?.updateProps({ mode: next as LibraryMode });
  }

  function onChange(updated: Content, _previous: Content, status: OnChangeStatus): void {
    content = updated;
    let change: DocumentChange;
    if (status.patchResult) {
      change = { kind: 'patch', patch: status.patchResult.redo as JsonPatchOperation[] };
    } else if ('text' in updated) {
      change = { kind: 'text', text: updated.text };
    } else {
      // Not produced by any edit the library makes today; 003 T5/T6 own the sync rules.
      host.showMessage({
        docVersion,
        code: 'unsupported-change',
        message: 'Change without a patch',
      });
      return;
    }
    host.save(docVersion, change);
  }

  function onHostEvent(event: HostEvent): void {
    switch (event.type) {
      case 'update':
        if (event.docVersion <= docVersion) return;
        docVersion = event.docVersion;
        notice = undefined;
        if (!showsText(content, event.text)) {
          content = { text: event.text };
          editor?.set(content);
        }
        return;
      case 'setMode':
        selectMode(event.mode);
        return;
      case 'setFormat':
        format = event.format;
        return;
      case 'error':
        notice = event.message;
        return;
    }
  }

  /**
   * Whether the editor already shows `text`, so the host's answer to the UI's own edit is dropped.
   * Tree and table edits hold data, not text, so data is compared. 003 T5 replaces this with
   * `core` parsing and the document-version rule.
   */
  function showsText(shown: Content, text: string): boolean {
    if ('text' in shown) return shown.text === text;
    try {
      return JSON.stringify(JSON.parse(text)) === JSON.stringify(shown.json);
    } catch {
      return false;
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
  .notice:empty {
    display: none;
  }
  .editor {
    flex: 1;
    min-height: 0;
  }
</style>
