// Runs inside VS Code (spike 011 T1, launched by run.mjs). Opens the fixtures in the spike's custom
// editor once per measurement, collects the page's messages and writes results/vscode-<version>.json.
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const EXTENSION_ID = 'christian-vrl.chr-json-editor-spike-query-engine';
const VIEW_TYPE = 'chrJsonSpike.queryEngine';
const LOAD_TIMEOUT_MS = 60_000;
const PROBE_TIMEOUT_MS = 60_000;
const BENCH_RUNS = 5;
// R2: a fast typist (150 ms a key), about 40 words a minute (300 ms, the library's debounce) and a
// slow one (450 ms), JavaScript and Lodash.
const TYPING_RUNS = ['javascript', 'lodash'].flatMap((language) =>
  [150, 300, 450].map((intervalMs) => ({ language, intervalMs })),
);

// Spec 011 criterion 9: 003 criterion 6 (packages/vscode-extension/test/e2e/suite.cjs
// assertCriterion6, as spikes/eval-location/suite.cjs copies it) with one change: script-src is the
// nonce plus 'wasm-unsafe-eval'. Returns failures instead of throwing so every run is recorded.
function criterion9Failures(policy, cspSource) {
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
  const nonces = scriptSrc.filter((s) => /^'nonce-[A-Za-z0-9+/]+={0,2}'$/.test(s));
  const rest = scriptSrc.filter((s) => !nonces.includes(s));
  if (nonces.length !== 1 || rest.length !== 1 || rest[0] !== "'wasm-unsafe-eval'")
    failures.push(`script-src is not a nonce plus 'wasm-unsafe-eval': ${scriptSrc.join(' ')}`);
  const nonce = nonces[0] ?? '';
  const allowed = [...cspSource.split(/\s+/).filter(Boolean), nonce];
  if (!same(directives.get('style-src'), allowed))
    failures.push('style-src is not the webview source and nonce');
  if (!same(directives.get('connect-src'), ["'none'"])) failures.push('connect-src is not none');
  if (/'unsafe-eval'/i.test(policy)) failures.push('unsafe-eval');
  if (/unsafe-inline|unsafe-hashes/i.test(policy)) failures.push('inline code allowed');
  for (const [directive, sources] of directives) {
    if (!directive.endsWith('-src')) continue;
    for (const source of sources) {
      if (source === "'none'" || allowed.includes(source)) continue;
      if (directive === 'script-src' && source === "'wasm-unsafe-eval'") continue;
      failures.push(`${directive} allows ${source}`);
    }
  }
  return failures;
}

const round = (x) => Math.round(x * 10) / 10;
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
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
  const fixtures = JSON.parse(readFileSync(path.join(fixtureDir, 'fixtures.json'), 'utf8'));
  const reference = JSON.parse(readFileSync(path.join(fixtureDir, 'node-reference.json'), 'utf8'));
  const docUri = (id) => vscode.Uri.file(path.join(fixtureDir, `${id}.json`));

  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `${EXTENSION_ID} not loaded`);
  const api = await extension.activate();

  async function open(policy, task, fixture) {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    api.prepare(policy, task);
    await vscode.commands.executeCommand('vscode.openWith', docUri(fixture), VIEW_TYPE);
    return api.session();
  }
  const pageSummary = (info, cspSource, policy) => ({
    policy: info.policy,
    criterion9Failures: policy === 'wasm' ? criterion9Failures(info.policy, cspSource) : null,
    cspViolations: info.violations,
    userAgent: info.userAgent,
  });

  // R7 and R1: each loading route under the criterion 9 policy, and route (c) under 003's policy.
  const loading = {};
  for (const [policy, route] of [
    ['wasm', 'a'],
    ['wasm', 'b'],
    ['wasm', 'c'],
    ['unchanged', 'c'],
  ]) {
    const session = await open(policy, { kind: 'load', route }, '1mib');
    const result = await session.next('loadResult', LOAD_TIMEOUT_MS);
    loading[`${policy}:${route}`] = {
      loaded: result.loaded,
      error: result.error,
      loadMs: round(result.loadMs),
      check: result.check,
      ...pageSummary(result.info, session.cspSource, policy),
    };
    console.log(`load ${policy}:${route}: loaded=${result.loaded} ${result.error ?? ''}`);
  }

  // Criteria 4 and 5: one probe at a time, then a round trip to the page (the page responds).
  const probes = {};
  let probesPage;
  {
    const session = await open('wasm', { kind: 'probes' }, '1mib');
    const ready = await session.next('probesReady', LOAD_TIMEOUT_MS);
    let lastInfo;
    for (let index = 0; index < ready.count; index++) {
      await session.post({ type: 'probe', index });
      const result = await session.next('probeResult', PROBE_TIMEOUT_MS);
      lastInfo = result.info;
      const t0 = performance.now();
      await session.post({ type: 'ping' });
      await session.next('pong', PROBE_TIMEOUT_MS);
      probes[result.id] = {
        ms: round(result.ms),
        value: result.value,
        error: result.error ?? null,
        engineError: result.engineError ?? null,
        next: result.next,
        roundTripAfterMs: round(performance.now() - t0),
      };
      console.log(`probe ${result.id}: ${round(result.ms)} ms ${result.error ?? ''}`);
    }
    probesPage = pageSummary(lastInfo ?? ready.info, session.cspSource, 'wasm');
  }

  // Criterion 12's queries at 1 and 5 MiB, beside the Node reference.
  const bench = {};
  let benchPage;
  for (const fixture of ['1mib', '5mib']) {
    const session = await open('wasm', { kind: 'bench', runs: BENCH_RUNS }, fixture);
    bench[fixture] = {};
    for (let i = 0; i < 2; i++) {
      const result = await session.next('benchResult', 5 * 60_000);
      const ref = reference.results[fixture][result.id];
      const pick = (key) => stats(result.runs.map((r) => r[key]));
      bench[fixture][result.id] = {
        language: result.language,
        totalMs: pick('totalMs'),
        parts: {
          setupMs: pick('setupMs').median,
          lodashMs: pick('lodashMs').median,
          inputMs: pick('inputMs').median,
          queryMs: pick('queryMs').median,
          outputMs: pick('outputMs').median,
        },
        referenceMs: stats(ref.ms),
        sameResultAsReference:
          result.resultHash === ref.resultHash && result.resultLength === ref.resultLength,
      };
      console.log(`bench ${fixture} ${result.id}: ${bench[fixture][result.id].totalMs.median} ms`);
    }
    const done = await session.next('done', 60_000);
    benchPage = pageSummary(done.info, session.cspSource, 'wasm');
  }

  // R2: typing into the real Transform dialog on the 5 MiB fixture.
  const typing = {};
  let typingPage;
  {
    const session = await open('wasm', { kind: 'typing', runs: TYPING_RUNS }, '5mib');
    const done = await session.next('done', 10 * 60_000);
    for (const message of session.messages) {
      if (message.type === 'typingError')
        typing[`${message.language}:${message.intervalMs}`] = { error: message.error };
      if (message.type !== 'typingResult') continue;
      typing[`${message.language}:${message.intervalMs}`] = {
        typedCharacters: message.typed.length,
        typingMs: round(message.keyAt.at(-1)),
        previewRuns: message.runs.length,
        runs: message.runs.map((r) => ({
          at: round(r.at),
          ms: round(r.ms),
          queryLength: r.queryLength,
        })),
        longestKeyGapMs: round(message.longestKeyGapMs),
        finalPreviewMatches: message.finalPreviewMatches,
        previewText: message.previewText,
      };
      console.log(
        `typing ${message.language} ${message.intervalMs} ms: ${message.runs.length} runs, longest gap ${round(message.longestKeyGapMs)} ms`,
      );
    }
    typingPage = pageSummary(done.info, session.cspSource, 'wasm');
  }
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');

  mkdirSync(resultsDir, { recursive: true });
  const file = path.join(resultsDir, `vscode-${vscode.version}.json`);
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        spike: '011-T1',
        vscode: vscode.version,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        platform: `${process.platform}-${process.arch}`,
        fixtures,
        referenceNode: reference.node,
        loading,
        probes,
        probesPage,
        bench,
        benchPage,
        typing,
        typingPage,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`wrote ${file}`);
};
