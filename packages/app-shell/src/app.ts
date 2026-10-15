// Mounts the editor UI into a page for a given host. Each host's entry point (the standalone page
// here, the VS Code webview, the Chrome app later) calls this with its own HostAdapter. The
// library build (vite.lib.config.mts) exports it as `@chr-json-editor/app-shell/ui`.
import { mount, unmount } from 'svelte';
import App from './App.svelte';
import type { AppHandle, MountApp } from './mount.js';

/** What App.svelte exports (typed here for tools that do not read .svelte files). */
type AppExports = Pick<AppHandle, 'patch' | 'content' | 'settled' | 'select' | 'cursor'>;

export const mountApp: MountApp = (target, host, options = {}) => {
  const app = mount(App, {
    target,
    props: { host, loadQueryEngine: options.loadQueryEngine },
  }) as AppExports;
  return {
    patch: (operations) => app.patch(operations),
    content: () => app.content(),
    settled: () => app.settled(),
    select: (path) => app.select(path),
    cursor: (offset) => app.cursor(offset),
    dispose: () => void unmount(app),
  };
};
