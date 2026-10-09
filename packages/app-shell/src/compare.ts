// Mounts the compare page (Compare.svelte, 007 T3) into a page for a given CompareHostAdapter: the
// standalone compare page here, the VS Code compare panel's webview in 007 T4.
import { mount, unmount } from 'svelte';
import Compare from './Compare.svelte';
import type { CompareHostAdapter } from './compare-host-adapter.js';
import type { Disposable } from './host-adapter.js';

export type MountCompare = (target: HTMLElement, host: CompareHostAdapter) => Disposable;

export const mountCompare: MountCompare = (target, host) => {
  const page = mount(Compare, { target, props: { host } });
  return { dispose: () => void unmount(page) };
};
