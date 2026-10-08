// Sample page entry for the Vite build (001 T6), served to `pnpm test:web`. Spec 003 replaces it
// with the editor UI.
import { packageName } from './index.js';

const app = document.querySelector<HTMLElement>('#app');
if (app) app.textContent = packageName;
