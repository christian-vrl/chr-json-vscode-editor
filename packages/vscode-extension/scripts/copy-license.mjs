// vsce packs the LICENSE beside package.json and stops to ask when it is missing, so `pnpm package`
// copies the repository's single LICENSE here first (the copy is git-ignored).
import { copyFileSync } from 'node:fs';

copyFileSync(new URL('../../../LICENSE', import.meta.url), new URL('../LICENSE', import.meta.url));
