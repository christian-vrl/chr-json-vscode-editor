// Standalone CSV page entry (csv.html, 009 T3), served to `pnpm test:web`: the CSV panel page over a
// DevCsvHostAdapter. A test sets `window.chrCsvInput` before the page loads; otherwise it exports a
// small sample.
import './page.css';
import { mountCsv } from './csv.js';
import { DevCsvHostAdapter, type DevCsvInput } from './dev-csv-host-adapter.js';

declare global {
  interface Window {
    /** What the page converts, set by a test before the page loads. */
    chrCsvInput?: DevCsvInput;
    /** The page's host, for tests and local poking; only the standalone page sets it. */
    devCsvHost?: DevCsvHostAdapter;
  }
}

const SAMPLE: DevCsvInput = {
  mode: 'export',
  name: 'people.json',
  data: [
    { name: 'Ada', address: { city: 'London' }, tags: ['math'] },
    { name: 'Grace', address: { city: 'New York' }, tags: ['navy', 'COBOL'] },
  ],
};

const host = new DevCsvHostAdapter(window.chrCsvInput ?? SAMPLE);
window.devCsvHost = host;

const app = document.querySelector<HTMLElement>('#app');
if (app) mountCsv(app, host);
