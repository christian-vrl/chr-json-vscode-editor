<!--
  The compare page (spec 007 criterion 3, 007 T3). Two read-only vanilla-jsoneditor instances in
  tree mode, left and right, over the data the CompareHostAdapter sends; the host parses both sides
  and runs core's `compare`, so this component only shows the result (plan 007 §Approach). Panels
  are read-only with copy buttons (UNK-036): edits are made in the normal editor and come back as
  an update (criterion 7).

  Each difference's path gets class `chr-diff-added`, `chr-diff-removed` or `chr-diff-changed` on
  the side or sides where its value exists, and every ancestor of a marked node `chr-diff-inside`,
  through the library's `onClassName` (looked up in a Map built once per result, plan 007 R4). The
  toolbar counts the differences, steps through them in list order with Next and Previous, and
  copies the current one into either side through the host.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import {
    createJSONEditor,
    createValueSelection,
    getFocusPath,
    type JsonEditor,
    type JSONEditorSelection,
    type MenuItem,
    type OnClassName,
    Mode as LibraryMode,
    SelectionType,
  } from 'vanilla-jsoneditor';
  import { compileJSONPointer, parseJSONPointer } from 'immutable-json-patch';
  import { copyDifference } from '@chr-json-editor/core';
  import type {
    CompareHostAdapter,
    CompareSide,
    CompareState,
    Difference,
  } from './compare-host-adapter.js';
  import './theme.css';

  let { host }: { host: CompareHostAdapter } = $props();

  const SIDES: readonly CompareSide[] = ['left', 'right'];
  const SIDE_LABELS: Record<CompareSide, string> = { left: 'Left', right: 'Right' };

  /** Raw, not a deep proxy: its differences go back to the host, which clones them. */
  let compareState = $state.raw<CompareState | undefined>();
  /** Index of the selected difference in `compareState.differences`. */
  let current = $state<number | undefined>();
  const targets: Record<CompareSide, HTMLDivElement | undefined> = {
    left: undefined,
    right: undefined,
  };
  const editors: Partial<Record<CompareSide, JsonEditor>> = {};
  /** Per side, the class for each marked JSON Pointer. */
  let marks: Record<CompareSide, Map<string, string>> = { left: new Map(), right: new Map() };

  const differences = $derived(compareState?.differences ?? []);
  const compared = $derived(
    compareState?.left.content.kind === 'data' && compareState.right.content.kind === 'data',
  );
  const counter = $derived.by(() => {
    if (!compareState) return '';
    if (!compared) return 'Not compared: a side does not parse';
    if (differences.length === 0) return 'No differences in the data';
    const total = `${differences.length} ${differences.length === 1 ? 'difference' : 'differences'}`;
    return current === undefined ? total : `Difference ${current + 1} of ${total}`;
  });

  onMount(() => {
    let disposed = false;
    const subscription = host.onUpdate(onUpdate);
    void host.open().then((opened) => {
      if (!disposed) onUpdate(opened);
    });
    return () => {
      disposed = true;
      subscription.dispose();
      for (const side of SIDES) void editors[side]?.destroy();
    };
  });

  /** The library's menu without the mode switch: the compare shows trees only (spec 007 §Scope). */
  function treeOnly(items: MenuItem[]): MenuItem[] {
    return items.filter(
      (item) => !(item.type === 'button' && item.className?.includes('jse-group-button')),
    );
  }

  function onUpdate(next: CompareState): void {
    if (compareState && next.version <= compareState.version) return;
    compareState = next;
    marks = {
      left: marksFor(next.differences, 'left'),
      right: marksFor(next.differences, 'right'),
    };
    for (const side of SIDES) {
      const content = next[side].content;
      const json = content.kind === 'data' ? content.data : null;
      const editor = editors[side];
      if (!editor) {
        const target = targets[side];
        if (target) editors[side] = createEditor(side, target, json);
        continue;
      }
      // A new function, so the library asks for every node's class again, unchanged nodes too.
      editor.updateProps({ onClassName: classNameFor(side) });
      if (content.kind === 'data') editor.update({ json });
    }
    // The same position after a copy is the next difference, so copies can run one after another.
    if (current !== undefined) {
      current = differences.length === 0 ? undefined : Math.min(current, differences.length - 1);
      if (current !== undefined) void show(current);
    }
  }

  function createEditor(side: CompareSide, target: HTMLElement, json: unknown): JsonEditor {
    return createJSONEditor({
      target,
      props: {
        content: { json },
        mode: LibraryMode.tree,
        readOnly: true,
        ariaLabel: `${SIDE_LABELS[side]} document`,
        // Given with the first content: a class prop set later reaches only nodes rendered later.
        onClassName: classNameFor(side),
        onRenderMenu: treeOnly,
        onSelect: (selection: JSONEditorSelection | undefined) => onSelect(side, selection),
      },
    });
  }

  /** The library's `onClassName` for `side`, read from the latest marks. */
  function classNameFor(side: CompareSide): OnClassName {
    return (path) => marks[side].get(compileJSONPointer(path));
  }

  /** Every path on `side` that a difference marks, and every ancestor of one. */
  function marksFor(list: Difference[], side: CompareSide): Map<string, string> {
    const result = new Map<string, string>();
    const add = (pointer: string, className: string) => {
      const existing = result.get(pointer);
      if (existing === undefined) result.set(pointer, className);
      else if (!existing.split(' ').includes(className))
        result.set(pointer, `${existing} ${className}`);
    };
    for (const d of list) {
      const pointer = side === 'left' ? d.leftPath : d.rightPath;
      if (pointer === undefined) continue;
      add(pointer, `chr-diff-${d.kind}`);
      const path = parseJSONPointer(pointer);
      for (let n = path.length - 1; n >= 0; n--)
        add(compileJSONPointer(path.slice(0, n)), 'chr-diff-inside');
    }
    return result;
  }

  function step(delta: 1 | -1): void {
    const n = differences.length;
    if (n === 0) return;
    if (current === undefined) current = delta === 1 ? 0 : n - 1;
    else current = (current + delta + n) % n;
    void show(current);
  }

  /** Where difference `d` is on `side`: its own path, or, on the side that lacks it, the container
   *  a copy would add it to (core's `copyDifference`, so the same alignment the copy would use). */
  function locate(d: Difference, side: CompareSide): { path: string; exists: boolean } | undefined {
    const own = side === 'left' ? d.leftPath : d.rightPath;
    if (own !== undefined) return { path: own, exists: true };
    const state = compareState;
    const other: CompareSide = side === 'left' ? 'right' : 'left';
    const source = state?.[other].content;
    const target = state?.[side].content;
    if (source?.kind !== 'data' || target?.kind !== 'data') return undefined;
    try {
      const [op] = copyDifference(source.data, target.data, d, other);
      if (!op) return undefined;
      return { path: compileJSONPointer(parseJSONPointer(op.path).slice(0, -1)), exists: false };
    } catch {
      return undefined;
    }
  }

  /** Selects difference `index` where it exists and scrolls both sides to it, expanding the way. */
  async function show(index: number): Promise<void> {
    const d = differences[index];
    if (!d) return;
    await Promise.all(
      SIDES.map(async (side) => {
        const editor = editors[side];
        const place = locate(d, side);
        if (!editor || !place) return;
        const path = parseJSONPointer(place.path);
        // `scrollTo` does not expand collapsed ancestors; `expand` opens the path and those above it.
        if (path.length > 0) editor.expand(path.slice(0, -1));
        editor.select(place.exists ? createValueSelection(path) : undefined);
        await editor.scrollTo(path);
      }),
    );
  }

  /** Clicking a marked node makes its difference the current one. */
  function onSelect(side: CompareSide, selection: JSONEditorSelection | undefined): void {
    if (!selection || selection.type === SelectionType.text) return;
    const pointer = compileJSONPointer(getFocusPath(selection));
    const index = differences.findIndex(
      (d) => (side === 'left' ? d.leftPath : d.rightPath) === pointer,
    );
    if (index < 0 || index === current) return;
    current = index;
    void show(index);
  }

  function copyTo(to: CompareSide): void {
    const d = current === undefined ? undefined : differences[current];
    if (!compareState || !d) return;
    host.copy(compareState.version, d, to);
  }

  function canCopyTo(side: CompareSide): boolean {
    return compared && current !== undefined && compareState?.[side].writable === true;
  }
</script>

<div class="compare chr-theme">
  <div class="toolbar" role="toolbar" aria-label="Compare">
    <button type="button" disabled={differences.length === 0} onclick={() => step(-1)}>
      Previous
    </button>
    <button type="button" disabled={differences.length === 0} onclick={() => step(1)}>
      Next
    </button>
    <span class="counter" role="status">{counter}</span>
    <span class="copy">
      <button type="button" disabled={!canCopyTo('left')} onclick={() => copyTo('left')}>
        Copy to left
      </button>
      <button type="button" disabled={!canCopyTo('right')} onclick={() => copyTo('right')}>
        Copy to right
      </button>
    </span>
  </div>
  <div class="panels">
    {#each SIDES as side (side)}
      {@const sideState = compareState?.[side]}
      <section class="side {side}" aria-label="{SIDE_LABELS[side]}: {sideState?.name ?? ''}">
        <h2 class="name">{sideState?.name ?? ''}</h2>
        {#if sideState?.content.kind === 'error'}
          <div class="parse-error" role="alert">{sideState.content.message}</div>
        {/if}
        <div
          class="editor"
          class:hidden={sideState?.content.kind === 'error'}
          bind:this={targets[side]}
        ></div>
      </section>
    {/each}
  </div>
</div>

<style>
  /*
    Difference colours (spec 007 criterion 9) come from VS Code's diffEditor.* theme variables, as
    its own diff editor uses them: the removed colours on the left, the inserted colours on the
    right. Added and removed values get the text colours and a solid outline, changed values the
    lighter line colours and a dashed outline, so the kinds read apart without colour too. Text
    inside a difference takes the editor's foreground, which keeps 4.5:1 on those tints. High
    contrast themes define only the borders, so the outline carries them there. On a page with no
    --vscode-* variables (the standalone page) the fallbacks are VS Code's light theme's own values.
  */
  .compare {
    --chr-diff-left-strong: var(--vscode-diffEditor-removedTextBackground, rgba(173, 7, 7, 0.15));
    --chr-diff-left-weak: var(--vscode-diffEditor-removedLineBackground, rgba(255, 0, 0, 0.2));
    --chr-diff-left-border: var(--vscode-diffEditor-removedTextBorder, transparent);
    --chr-diff-right-strong: var(
      --vscode-diffEditor-insertedTextBackground,
      rgba(88, 124, 12, 0.15)
    );
    --chr-diff-right-weak: var(--vscode-diffEditor-insertedLineBackground, rgba(155, 185, 85, 0.2));
    --chr-diff-right-border: var(--vscode-diffEditor-insertedTextBorder, transparent);

    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--vscode-editor-background);
    color: var(--vscode-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
  }
  /* High contrast themes have borders only: no fallback tint under the outline. */
  :global(body.vscode-high-contrast) .compare,
  :global(body.vscode-high-contrast-light) .compare {
    --chr-diff-left-strong: transparent;
    --chr-diff-left-weak: transparent;
    --chr-diff-right-strong: transparent;
    --chr-diff-right-weak: transparent;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px;
  }
  .copy {
    display: flex;
    gap: 4px;
    margin-left: auto;
  }
  .toolbar button {
    font: inherit;
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground, var(--vscode-editor-background));
    border: 1px solid var(--vscode-button-border, var(--vscode-contrastBorder, transparent));
  }
  .toolbar button:hover:enabled {
    background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground));
  }
  .toolbar button:disabled {
    opacity: 0.5;
  }
  .toolbar button:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 1px;
  }
  .panels {
    display: flex;
    flex: 1;
    gap: 4px;
    min-height: 0;
  }
  .side {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }
  .name {
    margin: 0;
    padding: 2px 4px;
    font-size: inherit;
    font-weight: normal;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .parse-error {
    padding: 4px;
    color: var(--vscode-editor-foreground);
    background: var(--vscode-inputValidation-errorBackground);
    border: 1px solid var(--vscode-inputValidation-errorBorder, transparent);
  }
  .editor {
    flex: 1;
    min-height: 0;
  }
  .editor.hidden {
    display: none;
  }

  .left :global(.jse-json-node.chr-diff-removed),
  .right :global(.jse-json-node.chr-diff-added) {
    outline: 1px solid var(--chr-diff-side-border);
    outline-offset: -1px;
    background: var(--chr-diff-side-strong);
  }
  .left :global(.jse-json-node.chr-diff-changed),
  .right :global(.jse-json-node.chr-diff-changed) {
    outline: 1px dashed var(--chr-diff-side-border);
    outline-offset: -1px;
    background: var(--chr-diff-side-weak);
  }
  /* Text over a difference colour takes the editor's foreground: the syntax colours fall below
     axe's 4.5:1 on the tinted backgrounds (criterion 9). */
  .side :global(.jse-json-node:is(.chr-diff-added, .chr-diff-removed, .chr-diff-changed)) {
    --jse-key-color: var(--vscode-editor-foreground);
    --jse-value-color-number: var(--vscode-editor-foreground);
    --jse-value-color-boolean: var(--vscode-editor-foreground);
    --jse-value-color-null: var(--vscode-editor-foreground);
    --jse-value-color-string: var(--vscode-editor-foreground);
    --jse-value-color-url: var(--vscode-editor-foreground);
  }
  /* An ancestor of a difference: a bar beside its own line only, not over its whole contents. */
  .side :global(.jse-json-node.chr-diff-inside > .jse-header-outer) {
    box-shadow: inset 3px 0 0 var(--chr-diff-side-mark);
  }
  .left {
    --chr-diff-side-strong: var(--chr-diff-left-strong);
    --chr-diff-side-weak: var(--chr-diff-left-weak);
    --chr-diff-side-border: var(--chr-diff-left-border);
    --chr-diff-side-mark: var(--vscode-diffEditor-removedTextBorder, var(--chr-diff-left-strong));
  }
  .right {
    --chr-diff-side-strong: var(--chr-diff-right-strong);
    --chr-diff-side-weak: var(--chr-diff-right-weak);
    --chr-diff-side-border: var(--chr-diff-right-border);
    --chr-diff-side-mark: var(--vscode-diffEditor-insertedTextBorder, var(--chr-diff-right-strong));
  }
</style>
