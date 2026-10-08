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
  .shell {
    display: flex;
    flex-direction: column;
    height: 100%;
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
  .modes button[aria-pressed='true'] {
    font-weight: bold;
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
