// Builds spike 004 T1 into dist/: the extension host bundle, the editor page script, and the
// child-frame page (sandbox.html + sandbox.js) that option A loads. Dev-only; nothing ships.
import { writeFileSync } from 'node:fs';
import { build } from 'esbuild';

const common = { bundle: true, logLevel: 'warning', sourcemap: false, minify: false };

await build({
  ...common,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  external: ['vscode'],
});

await build({
  ...common,
  entryPoints: ['src/node-reference.ts'],
  outfile: 'dist/node-reference.mjs',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  // ajv is CommonJS; give the ESM bundle a require for it.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});

for (const name of ['page', 'sandbox', 'mv3-page']) {
  await build({
    ...common,
    entryPoints: [`src/${name}.ts`],
    outfile: `dist/${name}.js`,
    format: 'iife',
    platform: 'browser',
    target: 'chrome128',
  });
}

// The frame's own policy: eval allowed, its script only from the webview resource origin (the frame
// has an opaque origin, so 'self' would not match), nothing else, no network.
export const SANDBOX_CSP =
  "default-src 'none'; script-src https://*.vscode-cdn.net 'unsafe-eval'; connect-src 'none'";

writeFileSync(
  'dist/sandbox.html',
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">
<title>CHR JSON Editor sandbox</title>
</head>
<body>
<script src="sandbox.js"></script>
</body>
</html>
`,
);
console.log('spike built into dist/');
