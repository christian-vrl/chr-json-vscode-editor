// Spike for UNK-027 (003 T2): what the Svelte shell adds to the standalone page's bundle.
// Builds the real page (vite.config.mts) and a baseline page that only calls vanilla-jsoneditor's
// createJSONEditor, into temporary directories, and prints each one's JavaScript size, raw and
// gzip (zlib level 9). Run from the repo root: node packages/app-shell/spikes/measure-bundle.mjs
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'unk-027-'));

function jsSize(outDir) {
  const dir = path.join(outDir, 'assets');
  let raw = 0;
  let gzip = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const bytes = readFileSync(path.join(dir, file));
    raw += bytes.length;
    gzip += gzipSync(bytes, { level: 9 }).length;
  }
  return { raw, gzip };
}

const kB = (n) => `${(n / 1000).toFixed(2)} kB`;

try {
  const shellOut = path.join(work, 'shell');
  await build({ root: pkg, logLevel: 'error', build: { outDir: shellOut, emptyOutDir: true } });

  // Baseline: same library, no Svelte shell, no DevHostAdapter.
  const baseRoot = path.join(pkg, '.unk-027-baseline');
  const baseOut = path.join(work, 'baseline');
  try {
    rmSync(baseRoot, { recursive: true, force: true });
    mkdirSync(baseRoot);
    writeFileSync(
      path.join(baseRoot, 'index.html'),
      '<!doctype html><div id="app"></div><script type="module" src="./main.js"></script>',
    );
    writeFileSync(
      path.join(baseRoot, 'main.js'),
      "import { createJSONEditor } from 'vanilla-jsoneditor';\n" +
        "createJSONEditor({ target: document.querySelector('#app'), props: { content: { text: '[]' } } });\n",
    );
    await build({
      root: baseRoot,
      configFile: false,
      logLevel: 'error',
      build: { outDir: baseOut, emptyOutDir: true },
    });
  } finally {
    rmSync(baseRoot, { recursive: true, force: true });
  }

  const shell = jsSize(shellOut);
  const base = jsSize(baseOut);
  console.log(`standalone page (Svelte shell): ${kB(shell.raw)} / ${kB(shell.gzip)} gzip`);
  console.log(`createJSONEditor alone:         ${kB(base.raw)} / ${kB(base.gzip)} gzip`);
  console.log(
    `shell overhead:                 ${kB(shell.raw - base.raw)} / ${kB(shell.gzip - base.gzip)} gzip`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
