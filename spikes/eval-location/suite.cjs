// Runs inside VS Code (spike 004 T1, launched by run.mjs). Opens the benchmark document once per
// variant in the spike's custom editor, collects each webview's measurement and writes
// results/vscode-<version>.json.
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const EXTENSION_ID = 'christian-vrl.chr-json-editor-spike-eval-location';
const VIEW_TYPE = 'chrJsonSpike.evalLocation';
const VARIANTS = [
  'main-frame',
  'iframe-src-unchanged-csp',
  'iframe-src',
  'iframe-src-unsandboxed',
  'iframe-srcdoc',
  'iframe-blob',
  'host',
];
const RESULT_TIMEOUT_MS = 120_000;

// Spec 003 criterion 6, the CSP half of packages/vscode-extension/test/e2e/suite.cjs
// assertCriterion6 (same rules, returning failures instead of throwing so every variant is recorded).
function criterion6Failures(policy, cspSource) {
  const failures = [];
  const directives = new Map();
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (!name) continue;
    if (directives.has(name.toLowerCase())) failures.push(`duplicate ${name}`);
    directives.set(name.toLowerCase(), sources);
  }
  const same = (a, b) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...b].sort());
  if (!same(directives.get('default-src'), ["'none'"])) failures.push('default-src is not none');
  const scriptSrc = directives.get('script-src') ?? [];
  const nonceMatch =
    scriptSrc.length === 1 && /^'nonce-([A-Za-z0-9+/]+={0,2})'$/.exec(scriptSrc[0]);
  if (!nonceMatch) failures.push(`script-src is not a nonce only: ${scriptSrc.join(' ')}`);
  const nonce = nonceMatch ? nonceMatch[1] : '';
  const allowed = [...cspSource.split(/\s+/).filter(Boolean), `'nonce-${nonce}'`];
  if (!same(directives.get('style-src'), allowed))
    failures.push('style-src is not the webview source and nonce');
  if (!same(directives.get('connect-src'), ["'none'"])) failures.push('connect-src is not none');
  if (/unsafe-eval/i.test(policy)) failures.push('unsafe-eval');
  if (/unsafe-inline|unsafe-hashes/i.test(policy)) failures.push('inline code allowed');
  for (const [directive, sources] of directives) {
    if (!directive.endsWith('-src')) continue;
    for (const source of sources) {
      if (source !== "'none'" && !allowed.includes(source))
        failures.push(`${directive} allows ${source}`);
    }
  }
  return failures;
}

function stats(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const round = (x) => Math.round(x * 10) / 10;
  return {
    median: round(sorted[Math.floor(sorted.length / 2)]),
    min: round(sorted[0]),
    max: round(sorted.at(-1)),
    runs: values.map(round),
  };
}

exports.run = async function run() {
  const fixtureDir = process.env.SPIKE_FIXTURE_DIR;
  const resultsDir = process.env.SPIKE_RESULTS_DIR;
  assert.ok(fixtureDir && resultsDir, 'run through run.mjs');
  const fixture = JSON.parse(readFileSync(path.join(fixtureDir, 'fixture.json'), 'utf8'));
  const reference = JSON.parse(readFileSync(path.join(fixtureDir, 'node-reference.json'), 'utf8'));
  const docUri = vscode.Uri.file(path.join(fixtureDir, 'doc.json'));

  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `${EXTENSION_ID} not loaded`);
  const api = await extension.activate();

  const variants = {};
  for (const variant of VARIANTS) {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    api.setVariant(variant, fixture.schema);
    await vscode.commands.executeCommand('vscode.openWith', docUri, VIEW_TYPE);
    const result = await Promise.race([
      api.result(variant),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${variant}: no result`)), RESULT_TIMEOUT_MS),
      ),
    ]);
    const errorsMatch =
      result.errors !== null && JSON.stringify(result.errors) === JSON.stringify(reference.errors);
    variants[variant] = {
      validates: !result.error && errorsMatch,
      error: result.error ?? null,
      errorCount: result.errors ? result.errors.length : null,
      errorsMatchNodeReference: errorsMatch,
      policy: result.policy,
      cspSource: result.cspSource,
      criterion6Failures: criterion6Failures(result.policy, result.cspSource),
      cspViolations: result.violations,
      frameProbe: result.frameProbe ?? null,
      frameLoadMs:
        result.frameLoadMs === undefined ? null : Math.round(result.frameLoadMs * 10) / 10,
      compileMs: result.compileMs === null ? null : Math.round(result.compileMs * 10) / 10,
      totalMs: stats(result.totalMs),
      validateMs: stats(result.validateMs),
      userAgent: result.userAgent,
    };
    console.log(`${variant}: validates=${variants[variant].validates} ${result.error ?? ''}`);
  }
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');

  mkdirSync(resultsDir, { recursive: true });
  const file = path.join(resultsDir, `vscode-${vscode.version}.json`);
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        spike: '004-T1',
        vscode: vscode.version,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        platform: `${process.platform}-${process.arch}`,
        fixture: {
          bytes: fixture.bytes,
          items: fixture.items,
          rules: fixture.rules,
          sha256: fixture.sha256,
        },
        nodeReference: { errorCount: reference.errors.length },
        variants,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`wrote ${file}`);
};
