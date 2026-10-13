// Expected-failure fixture for spec 013 criterion 2 (013 T2): every import below must fail ESLint's
// shared-host-code rule (eslint.config.mjs `sharedHostCode`) when linted as a file under
// packages/vscode-extension/src/. packages/vscode-extension/test/unit/nodeImports.test.ts lints it
// there and expects one error per line marked `// error`.
import { randomBytes } from 'node:crypto'; // error
import * as path from 'path'; // error
import { readFile } from 'fs/promises'; // error
import type { Stats } from 'fs'; // error
export { fileURLToPath } from 'node:url'; // error

export async function uses(stats: Stats): Promise<unknown[]> {
  const os = await import('os'); // error
  const process = await import('node:process'); // error
  const childProcess: unknown = require('child_process'); // error
  return [randomBytes, path, readFile, stats, os, process, childProcess];
}
