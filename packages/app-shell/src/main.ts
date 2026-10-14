// Standalone page entry for the Vite build (003 T2), served to `pnpm test:web`: the editor UI over
// a DevHostAdapter holding a sample document. `?mode=text|table` picks the starting mode, `?text=`
// the document, and `?largeFile=<bytes>` opens it in large-file mode (spec 008) as the extension
// host would for a text of that size, unlocked too with `&unlocked=1`. `?format=jsonl` opens a JSON
// Lines document (spec 012), the sample's records one per line unless `?text=` gives one, in Table
// mode unless `?mode=` names another. `?settings=` is a JSON object of page settings (spec 019, the
// `EditorSettings` keys), each one left out at its default. Transform's JavaScript and
// Lodash engine (spec 011) is a separate Vite chunk, loaded when the dialog first opens.
import './page.css';
import { mountApp } from './app.js';
import { DevHostAdapter } from './dev-host-adapter.js';
import type { AppHandle } from './mount.js';
import { FORMATS, MODES, type EditorSettings, type Format, type Mode } from './protocol.js';

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

/** The sample's records as JSON Lines. */
const SAMPLE_LINES = `{"name":"Ada","language":"Analytical Engine","year":1843}
{"name":"Grace","language":"COBOL","year":1959}
{"name":"Barbara","language":"CLU","year":1974}
`;

const params = new URLSearchParams(location.search);
const format: Format = FORMATS.includes(params.get('format') as Format)
  ? (params.get('format') as Format)
  : 'json';
const requested = params.get('mode');
const mode: Mode = MODES.includes(requested as Mode)
  ? (requested as Mode)
  : format === 'jsonl'
    ? 'table'
    : 'tree';
const largeFile = params.has('largeFile')
  ? { bytes: Number(params.get('largeFile')), unlocked: params.get('unlocked') === '1' }
  : null;
const settings = params.has('settings')
  ? (JSON.parse(params.get('settings')!) as Partial<EditorSettings>)
  : undefined;
const host = new DevHostAdapter({
  text: params.get('text') ?? (format === 'jsonl' ? SAMPLE_LINES : SAMPLE),
  format,
  mode,
  settings,
  largeFile,
});
window.devHost = host;

const app = document.querySelector<HTMLElement>('#app');
if (app) {
  window.devApp = mountApp(app, host, {
    loadQueryEngine: () => import('./query/engine.js'),
  });
}
