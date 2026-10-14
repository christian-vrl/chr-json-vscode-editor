<!--
  The CSV panel page (spec 009 criterion 6, 009 T3; UNK-044 "Preview panel"). One page for both
  directions, chosen by the source the CsvHostAdapter sends: export shows the options of §Options
  that apply to export and the CSV text of the first 100 rows; import shows those of import and the
  JSON of the first 100 rows in a read-only vanilla-jsoneditor table. The preview runs core's
  `jsonToCsv` or `csvToJson` here on what the host sent (at most 100 rows, csv-preview.ts), again on
  every option change, so it follows a change at once. Warnings are listed under the preview; an
  error replaces it with its message and line and disables every button, since each one writes or
  copies. A button asks the host to run the full conversion and write (ADR-003); an error the host
  finds past the preview (a quote left open after row 100) is shown the same way until an option
  changes.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import {
    createJSONEditor,
    type JsonEditor,
    type MenuItem,
    Mode as LibraryMode,
  } from 'vanilla-jsoneditor';
  import { csvToJson, detectDelimiter, jsonToCsv, nearestNumbers } from '@chr-json-editor/core';
  import {
    CSV_EXPORT_DEFAULTS,
    CSV_IMPORT_DEFAULTS,
    type CsvDelimiter,
    type CsvExportOptions,
    type CsvHostAdapter,
    type CsvImportOptions,
    type CsvPanelMessage,
    type CsvRequest,
    type CsvSource,
  } from './csv-host-adapter.js';
  import { CSV_PREVIEW_ROWS } from './csv-preview.js';
  import './theme.css';

  let { host }: { host: CsvHostAdapter } = $props();

  const DELIMITERS: readonly { value: CsvDelimiter; label: string }[] = [
    { value: ',', label: 'Comma (,)' },
    { value: ';', label: 'Semicolon (;)' },
    { value: '\t', label: 'Tab' },
    { value: '|', label: 'Pipe (|)' },
  ];
  const delimiterLabel = (d: CsvDelimiter) => DELIMITERS.find((x) => x.value === d)!.label;

  let source = $state.raw<CsvSource | undefined>();
  let exportOptions = $state<CsvExportOptions>({ ...CSV_EXPORT_DEFAULTS });
  let importOptions = $state<CsvImportOptions>({ ...CSV_IMPORT_DEFAULTS });
  /** A request is running: no second write until it answers. */
  let busy = $state(false);
  /** An error the host's full conversion gave, and the options it ran with. */
  let runError = $state.raw<{ error: CsvPanelMessage; options: string } | undefined>();

  type Preview =
    | { kind: 'csv'; text: string; columns: number; warnings: CsvPanelMessage[] }
    | { kind: 'rows'; rows: unknown[]; warnings: CsvPanelMessage[] }
    | { kind: 'error'; error: CsvPanelMessage };

  const options = $derived(source?.mode === 'import' ? importOptions : exportOptions);
  const optionsKey = $derived(JSON.stringify(options));

  const preview = $derived.by((): Preview | undefined => {
    if (!source) return undefined;
    if (source.mode === 'export') {
      const result = jsonToCsv(source.preview, exportOptions);
      if ('error' in result) return { kind: 'error', error: result.error };
      const text = result.text.startsWith('﻿') ? result.text.slice(1) : result.text;
      return {
        kind: 'csv',
        text,
        columns: columnCount(text, exportOptions.delimiter),
        warnings: [],
      };
    }
    const result = csvToJson(source.preview, importOptions);
    if ('error' in result) return { kind: 'error', error: result.error };
    return {
      kind: 'rows',
      // Import keeps big numbers exact (spec 015 B9); the preview table shows their nearest numbers
      // until the page's parser writes big numbers (015 T4), as the editor does.
      rows: nearestNumbers(result.data.slice(0, CSV_PREVIEW_ROWS)) as unknown[],
      warnings: result.warnings,
    };
  });

  const error = $derived(
    preview?.kind === 'error'
      ? preview.error
      : runError?.options === optionsKey
        ? runError.error
        : undefined,
  );
  const disabled = $derived(!source || busy || error !== undefined);

  const heading = $derived.by(() => {
    if (!source) return '';
    if (source.mode === 'import') return `Import ${source.name}`;
    return source.pointer === ''
      ? `Export ${source.name} to CSV`
      : `Export ${source.pointer} of ${source.name} to CSV`;
  });

  const summary = $derived.by(() => {
    if (!source || !preview || preview.kind === 'error') return '';
    if (preview.kind === 'csv' && source.mode === 'export') {
      const columns = plural(preview.columns, 'column');
      const bom = exportOptions.bom ? ', UTF-8 BOM' : '';
      return source.rowCount > CSV_PREVIEW_ROWS
        ? `First ${CSV_PREVIEW_ROWS} of ${plural(source.rowCount, 'row')}, ${columns}${bom}`
        : `${plural(source.rowCount, 'row')}, ${columns}${bom}`;
    }
    if (preview.kind === 'rows' && source.mode === 'import') {
      const shown = preview.rows.length;
      return source.complete && shown < CSV_PREVIEW_ROWS
        ? plural(shown, 'row')
        : `First ${plural(shown, 'row')}`;
    }
    return '';
  });

  const detected = $derived(
    source?.mode === 'import' ? delimiterLabel(detectDelimiter(source.preview)) : '',
  );

  let tableTarget = $state<HTMLDivElement | undefined>();
  let table: JsonEditor | undefined;

  onMount(() => {
    let disposed = false;
    void host.open().then((opened) => {
      if (!disposed) source = opened;
    });
    const changes = host.onDidChangeSource?.((changed) => (source = changed));
    return () => {
      disposed = true;
      changes?.dispose();
      void table?.destroy();
    };
  });

  // The import preview's table: made once its element exists, then given each new set of rows.
  $effect(() => {
    if (preview?.kind !== 'rows' || !tableTarget) return;
    const json = preview.rows;
    if (!table) table = createTable(tableTarget, json);
    else void table.update({ json });
  });

  function createTable(target: HTMLElement, json: unknown): JsonEditor {
    return createJSONEditor({
      target,
      props: {
        content: { json },
        mode: LibraryMode.table,
        readOnly: true,
        ariaLabel: 'JSON preview',
        onRenderMenu: tableOnly,
      },
    });
  }

  /** The library's menu without the mode switch: the import preview is a table only. */
  function tableOnly(items: MenuItem[]): MenuItem[] {
    return items.filter(
      (item) => !(item.type === 'button' && item.className?.includes('jse-group-button')),
    );
  }

  /** Columns of a CSV text `jsonToCsv` wrote: the fields of its first record. */
  function columnCount(text: string, delimiter: CsvDelimiter): number {
    if (text === '') return 0;
    const result = csvToJson(text, { delimiter, header: false, nestedObjects: false });
    if ('error' in result) return 0;
    const first = result.data[0];
    return first ? Object.keys(first).length : 0;
  }

  function plural(n: number, word: string): string {
    return `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
  }

  function messageText(m: CsvPanelMessage): string {
    return m.line === undefined ? m.message : `Line ${m.line}: ${m.message}`;
  }

  async function run(action: CsvRequest['action']): Promise<void> {
    if (disabled || !source) return;
    const request: CsvRequest =
      action === 'save' || action === 'copy'
        ? { action, options: { ...exportOptions } }
        : { action, options: { ...importOptions } };
    const key = optionsKey;
    busy = true;
    try {
      const outcome = await host.run(request);
      runError = 'error' in outcome ? { error: outcome.error, options: key } : undefined;
    } finally {
      busy = false;
    }
  }
</script>

<div class="csv chr-theme">
  <h1 class="heading">{heading}</h1>
  {#if source}
    <form class="options" aria-label="CSV options" onsubmit={(e) => e.preventDefault()}>
      {#if source.mode === 'export'}
        <label>
          Delimiter
          <select bind:value={exportOptions.delimiter}>
            {#each DELIMITERS as d (d.value)}
              <option value={d.value}>{d.label}</option>
            {/each}
          </select>
        </label>
        <label><input type="checkbox" bind:checked={exportOptions.header} /> Header row</label>
        <label>
          <input type="checkbox" bind:checked={exportOptions.flattenObjects} /> Flatten nested objects
        </label>
        <label>
          <input type="checkbox" bind:checked={exportOptions.flattenArrays} /> Flatten nested arrays
        </label>
        <label
          ><input type="checkbox" bind:checked={exportOptions.bom} /> UTF-8 BOM (for Excel)</label
        >
      {:else}
        <label>
          Delimiter
          <select bind:value={importOptions.delimiter}>
            <option value="detect">Detect ({detected})</option>
            {#each DELIMITERS as d (d.value)}
              <option value={d.value}>{d.label}</option>
            {/each}
          </select>
        </label>
        <label><input type="checkbox" bind:checked={importOptions.header} /> Header row</label>
        <label>
          <input type="checkbox" bind:checked={importOptions.nestedObjects} /> Nested objects from field
          names
        </label>
      {/if}
    </form>
    <div class="actions" role="toolbar" aria-label="CSV actions">
      {#if source.mode === 'export'}
        <button type="button" class="primary" {disabled} onclick={() => run('save')}>
          Save CSV…
        </button>
        <button type="button" {disabled} onclick={() => run('copy')}>Copy CSV</button>
      {:else}
        <button type="button" class="primary" {disabled} onclick={() => run('createFile')}>
          Create JSON File
        </button>
        {#if source.canReplace}
          <button type="button" {disabled} onclick={() => run('replaceData')}>
            Replace Document Data
          </button>
        {/if}
      {/if}
      <span class="summary" role="status">{summary}</span>
    </div>
  {/if}
  <section class="preview" aria-label="Preview">
    {#if error}
      <div class="error" role="alert">{messageText(error)}</div>
    {/if}
    {#if preview?.kind === 'csv'}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex: the preview scrolls; keyboard users need focus to scroll it -->
      <pre
        class="csv-text"
        class:hidden={error !== undefined}
        tabindex="0"
        aria-label="CSV preview">{preview.text}</pre>
    {/if}
    {#if source?.mode === 'import'}
      <div
        class="table"
        class:hidden={error !== undefined || preview?.kind !== 'rows'}
        bind:this={tableTarget}
      ></div>
    {/if}
    {#if !error && preview && preview.kind !== 'error' && preview.warnings.length > 0}
      <ul class="warnings" aria-label="Warnings">
        {#each preview.warnings as w, i (i)}
          <li>{messageText(w)}</li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .csv {
    display: flex;
    flex-direction: column;
    gap: 6px;
    box-sizing: border-box;
    height: 100%;
    padding: 6px;
    background: var(--vscode-editor-background);
    color: var(--vscode-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
  }
  .heading {
    margin: 0;
    font-size: inherit;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .options {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 16px;
  }
  .options label {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  select {
    font: inherit;
    color: var(--vscode-dropdown-foreground);
    background: var(--vscode-dropdown-background);
    border: 1px solid var(--vscode-dropdown-border, var(--vscode-contrastBorder, transparent));
  }
  input[type='checkbox'] {
    accent-color: var(--vscode-button-background);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .summary {
    margin-left: auto;
  }
  button {
    font: inherit;
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground, var(--vscode-editor-background));
    border: 1px solid var(--vscode-button-border, var(--vscode-contrastBorder, transparent));
    padding: 2px 8px;
  }
  button.primary {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }
  button:hover:enabled {
    background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground));
  }
  button.primary:hover:enabled {
    background: var(--vscode-button-hoverBackground);
  }
  button:disabled {
    opacity: 0.5;
  }
  button:focus-visible,
  select:focus-visible,
  input:focus-visible,
  .csv-text:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 1px;
  }
  .preview {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 6px;
    min-height: 0;
  }
  .csv-text {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 4px;
    overflow: auto;
    color: var(--vscode-editor-foreground);
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border, transparent));
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--vscode-editor-font-size);
    tab-size: 8;
  }
  .table {
    flex: 1;
    min-height: 0;
  }
  .hidden {
    display: none;
  }
  .error {
    padding: 4px;
    color: var(--vscode-editor-foreground);
    background: var(--vscode-inputValidation-errorBackground);
    border: 1px solid var(--vscode-inputValidation-errorBorder, transparent);
  }
  .warnings {
    max-height: 30%;
    margin: 0;
    padding: 4px 4px 4px 24px;
    overflow: auto;
    color: var(--vscode-editor-foreground);
    background: var(--vscode-inputValidation-warningBackground);
    border: 1px solid var(--vscode-inputValidation-warningBorder, transparent);
  }
</style>
