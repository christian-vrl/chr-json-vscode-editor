// Mounts the editor UI into a page for a given host. Each host's entry point (the standalone page
// here, the VS Code webview in 003 T4, the Chrome app later) calls this with its own HostAdapter.
import { mount, unmount } from 'svelte';
import App from './App.svelte';
import type { Disposable, HostAdapter } from './host-adapter.js';

export function mountApp(target: HTMLElement, host: HostAdapter): Disposable {
  const app = mount(App, { target, props: { host } });
  return { dispose: () => void unmount(app) };
}
