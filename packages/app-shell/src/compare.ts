// Mounts the compare page (Compare.svelte, 007 T3) into a page for a given CompareHostAdapter: the
// standalone compare page here, the VS Code compare panel's webview in 007 T4. The library build
// (vite.lib.config.mts) exports this file as `@chr-json-editor/app-shell/compare`, typed by
// ./compare-ui.d.ts.
import { mount, unmount } from 'svelte';
import Compare from './Compare.svelte';
import type { MountCompare, ParseCompareText } from './compare-mount.js';
import { parserFor } from './parser.js';

export type { MountCompare, ParseCompareText } from './compare-mount.js';

export const mountCompare: MountCompare = (target, host) => {
  const page = mount(Compare, { target, props: { host } });
  return { dispose: () => void unmount(page) };
};

/** Parses a side's text the way the editor does (parser.ts): the VS Code panel's host sends text,
 *  which keeps JSON5's `NaN`, `Infinity` and `-0` that a JSON message would lose (007 T4). */
export const parseCompareText: ParseCompareText = (text, format) => parserFor(format).parse(text);
