// Standalone compare page entry (compare.html, 007 T3), served to `pnpm test:web`: the compare page
// over a DevCompareHostAdapter. A test sets `window.chrCompareDocuments` before the page loads;
// otherwise it compares two small samples.
import './page.css';
import { mountCompare } from './compare.js';
import { DevCompareHostAdapter, type DevCompareDocument } from './dev-compare-host-adapter.js';

declare global {
  interface Window {
    /** The two documents to compare, set by a test before the page loads. */
    chrCompareDocuments?: { left: DevCompareDocument; right: DevCompareDocument };
    /** The page's host, for tests and local poking; only the standalone page sets it. */
    devCompareHost?: DevCompareHostAdapter;
  }
}

const SAMPLE_LEFT = `{
  "name": "Ada",
  "languages": ["Analytical Engine", "Note G"],
  "born": 1815
}
`;
const SAMPLE_RIGHT = `{
  // key order and comments are not differences
  "born": 1815,
  "name": "Ada Lovelace",
  "languages": ["Analytical Engine", "Bernoulli numbers", "Note G"],
}
`;

const documents = window.chrCompareDocuments ?? {
  left: { name: 'left.json', text: SAMPLE_LEFT, format: 'json' },
  right: { name: 'right.jsonc', text: SAMPLE_RIGHT, format: 'jsonc' },
};
const host = new DevCompareHostAdapter(documents.left, documents.right);
window.devCompareHost = host;

const app = document.querySelector<HTMLElement>('#app');
if (app) mountCompare(app, host);
