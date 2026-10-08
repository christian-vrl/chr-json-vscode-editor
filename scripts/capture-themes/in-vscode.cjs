// Runs inside VS Code, loaded through --extensionTestsPath by scripts/capture-themes.ts (003 T9).
// For each default theme (light, dark, high contrast) it switches the workbench to that theme,
// opens a webview and records the `--vscode-*` CSS variables VS Code gives the webview, so
// `pnpm test:web` can check the app-shell against the real values (spec 003 criterion 7).
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

// The default theme of each kind is the default value of its "preferred" setting, so the capture
// follows whatever this VS Code version ships instead of a hard-coded theme name.
const THEMES = [
  { file: 'dark', setting: 'preferredDarkColorTheme', kind: vscode.ColorThemeKind.Dark },
  { file: 'light', setting: 'preferredLightColorTheme', kind: vscode.ColorThemeKind.Light },
  {
    file: 'hc',
    setting: 'preferredHighContrastColorTheme',
    kind: vscode.ColorThemeKind.HighContrast,
  },
];

async function waitFor(what, predicate, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`capture-themes: timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// Reports the variables once VS Code has set them; the extension asks again after each wait so
// the answer reflects the current theme.
const WEBVIEW_SCRIPT = `
const vscode = acquireVsCodeApi();
function variables() {
  const found = {};
  for (const element of [document.documentElement, document.body]) {
    for (let i = 0; i < element.style.length; i++) {
      const name = element.style[i];
      if (name.startsWith('--vscode-')) found[name] = element.style.getPropertyValue(name).trim();
    }
  }
  return found;
}
window.addEventListener('message', () => {
  vscode.postMessage({
    variables: variables(),
    bodyClass: document.body.className,
    dataset: { ...document.body.dataset },
  });
});
`;

function webviewHtml(nonce) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'">
</head><body><script nonce="${nonce}">${WEBVIEW_SCRIPT}</script></body></html>`;
}

async function captureWebview() {
  const panel = vscode.window.createWebviewPanel('chrCaptureThemes', 'Capture themes', 1, {
    enableScripts: true,
  });
  try {
    panel.webview.html = webviewHtml(String(Date.now()));
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const answer = new Promise((resolve) => {
        const sub = panel.webview.onDidReceiveMessage((message) => {
          sub.dispose();
          resolve(message);
        });
        setTimeout(() => {
          sub.dispose();
          resolve(undefined);
        }, 500);
      });
      await panel.webview.postMessage('capture');
      const message = await answer;
      if (message && Object.keys(message.variables).length > 0) return message;
    }
    throw new Error('capture-themes: the webview never reported --vscode-* variables');
  } finally {
    panel.dispose();
  }
}

exports.run = async function run() {
  const outDir = process.env.CHR_THEMES_OUT;
  if (!outDir) throw new Error('capture-themes: CHR_THEMES_OUT is not set');
  const workbench = vscode.workspace.getConfiguration('workbench');
  for (const { file, setting, kind } of THEMES) {
    const theme = workbench.inspect(setting)?.defaultValue;
    if (typeof theme !== 'string') throw new Error(`capture-themes: no default for ${setting}`);
    await vscode.workspace
      .getConfiguration('workbench')
      .update('colorTheme', theme, vscode.ConfigurationTarget.Global);
    await waitFor(`${theme} to become active`, () => vscode.window.activeColorTheme.kind === kind);
    const captured = await captureWebview();
    const variables = Object.fromEntries(
      Object.entries(captured.variables).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    const record = {
      source: 'scripts/capture-themes.ts',
      vscode: vscode.version,
      theme,
      bodyClass: captured.bodyClass,
      dataset: captured.dataset,
      variables,
    };
    fs.writeFileSync(path.join(outDir, `${file}.json`), `${JSON.stringify(record, null, 2)}\n`);
    console.log(
      `capture-themes: ${file}.json <- ${theme} (${Object.keys(variables).length} variables)`,
    );
  }
};
