// Runs inside VS Code (spike 015 T1, launched by run.mjs). Opens the criterion 4 fixture in the
// spike's editor and runs the library probes, reads the system clipboard after the copy probe,
// then benches each text in a fresh editor. Writes results/vscode-<version>.json.
const assert = require('node:assert/strict');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const EXTENSION_ID = 'christian-vrl.chr-json-editor-spike-lossless-numbers';
const VIEW_TYPE = 'chrJsonSpike.losslessNumbers';

exports.run = async function run() {
  const fixtureDir = process.env.SPIKE_FIXTURE_DIR;
  const resultsDir = process.env.SPIKE_RESULTS_DIR;
  const probeFixture = process.env.SPIKE_PROBE_FIXTURE;
  assert.ok(fixtureDir && resultsDir && probeFixture, 'run through run.mjs');
  const texts = JSON.parse(readFileSync(path.join(fixtureDir, 'texts.json'), 'utf8'));

  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `${EXTENSION_ID} not loaded`);
  const api = await extension.activate();

  async function open(file) {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    const session = api.nextSession();
    await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), VIEW_TYPE);
    const opened = await session;
    const ready = await opened.next('pageReady', 60_000);
    return { session: opened, ready };
  }

  const out = { vscode: vscode.version, probes: null, clipboard: null, bench: {} };

  {
    const { session, ready } = await open(probeFixture);
    out.page = ready.info;
    await vscode.env.clipboard.writeText('(spike: clipboard not written)');
    await session.post({ type: 'probes', text: session.documentText });
    const result = await session.next('probesResult', 120_000);
    out.probes = result.results;
    out.probesPage = result.info;
    out.clipboard = await vscode.env.clipboard.readText();
    for (const probe of result.results) {
      console.log(`probe ${probe.id}: ${Math.round(probe.ms)} ms ${probe.error ?? ''}`);
    }
  }

  for (const text of process.env.SPIKE_PROBES_ONLY ? [] : texts) {
    const { session } = await open(path.join(fixtureDir, `${text.id}.json`));
    const body = session.documentText;
    assert.equal(body.length, text.bytes, `${text.id}: VS Code handed a different text`);
    await session.post({
      type: 'bench',
      id: text.id,
      bigNumbers: text.bigNumbers,
      runs: text.runs,
      text: body,
    });
    const result = await session.next('benchResult', 1_200_000);
    out.bench[text.id] = result.results;
    console.log(`bench ${text.id}: done`);
  }

  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(
    path.join(resultsDir, `vscode-${vscode.version}.json`),
    JSON.stringify(out, null, 2) + '\n',
  );
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
};
