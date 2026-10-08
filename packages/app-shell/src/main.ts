// Standalone page entry for the Vite build (003 T2), served to `pnpm test:web`: the editor UI over
// a DevHostAdapter holding a sample document. `?mode=text|table` picks the starting mode.
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
const host = new DevHostAdapter({ text: params.get('text') ?? SAMPLE, format: 'json', mode });
window.devHost = host;

const app = document.querySelector<HTMLElement>('#app');
if (app) window.devApp = mountApp(app, host);
