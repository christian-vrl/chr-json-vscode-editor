// Standalone page entry for the Vite build (003 T2), served to `pnpm test:web`: the editor UI over
// a DevHostAdapter holding a sample document. `?mode=text|table` picks the starting mode, `?text=`
// the document, and `?largeFile=<bytes>` opens it in large-file mode (spec 008) as the extension
// host would for a text of that size, unlocked too with `&unlocked=1`.
import './page.css';
import { mountApp } from './app.js';
import { DevHostAdapter } from './dev-host-adapter.js';
import type { AppHandle } from './mount.js';
import { MODES, type Mode } from './protocol.js';

const SAMPLE = `[
  { "name": "Ada", "language": "Analytical Engine", "year": 1843 },
  { "name": "Grace", "language": "COBOL", "year": 1959 },
  { "name": "Barbara", "language": "CLU", "year": 1974 }
]
`;

declare global {
  interface Window {
    /** The page's host, for tests and local poking; only the standalone page sets it. */
    devHost?: DevHostAdapter;
    /** The mounted editor UI, for tests; only the standalone page sets it. */
    devApp?: AppHandle;
  }
}

const requested = new URLSearchParams(location.search).get('mode');
const mode: Mode = MODES.includes(requested as Mode) ? (requested as Mode) : 'tree';
const params = new URLSearchParams(location.search);
const largeFile = params.has('largeFile')
  ? { bytes: Number(params.get('largeFile')), unlocked: params.get('unlocked') === '1' }
  : null;
const host = new DevHostAdapter({
  text: params.get('text') ?? SAMPLE,
  format: 'json',
  mode,
  largeFile,
});
window.devHost = host;

const app = document.querySelector<HTMLElement>('#app');
if (app) window.devApp = mountApp(app, host);
