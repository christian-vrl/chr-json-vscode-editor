// Mounts the CSV panel page (Csv.svelte, 009 T3) into a page for a given CsvHostAdapter: the
// standalone CSV page here, the VS Code CSV panel's webview in 009 T4. The library build
// (vite.lib.config.mts) exports this file as `@chr-json-editor/app-shell/csv`, typed by
// ./csv-ui.d.ts.
import { mount, unmount } from 'svelte';
import Csv from './Csv.svelte';
import type { MountCsv } from './csv-mount.js';

export type { MountCsv } from './csv-mount.js';

export const mountCsv: MountCsv = (target, host) => {
  const page = mount(Csv, { target, props: { host } });
  return { dispose: () => void unmount(page) };
};
