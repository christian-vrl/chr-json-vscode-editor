# Web e2e (`pnpm test:e2e:web`, spec 013)

The suite in `suite/` runs in VS Code's web worker extension host, the one vscode.dev and
github.dev use, against the extension loaded from the files of the `.vsix` that
`CHR_TEST_HOOKS=1 pnpm package` wrote. `run.mjs` unzips it, bundles the suite with esbuild
(`dist-test/web/suite.js`) and copies the bundle into the unzipped extension folder, then picks a
route:

| Route | When | VS Code | Workspace |
|---|---|---|---|
| CI | default (the `ci.yml` job `e2e-web`) | VS Code stable's web build in headless Playwright Chromium, through `@vscode/test-web` (downloaded from update.code.visualstudio.com into `.vscode-test-web/`) | a copy of the fixtures mounted on the virtual scheme `vscode-test-web://mount/` |
| Local | `VSCODE_EXECUTABLE_PATH` is set | that desktop VS Code, started with `--extensionDevelopmentKind=web` (no download; run under `xvfb-run` on Linux) | a `file:` copy of the fixtures |

Cloud sandboxes can't reach the web build's download host, so Implementers run the local route
and read the CI job's result before asking for review (spec 013 plan R1).

## What only the CI route covers

The local route runs the same suite in the same kind of extension host (a web worker with no Node),
but inside desktop VS Code. Only the CI route covers:

- **The browser workbench:** VS Code's `isWeb` context key is false on the local route (spec 013
  criterion 8), and webviews are served through Electron, not a browser.
- **The webview service worker:** in a browser, VS Code serves webview resources through a service
  worker; desktop serves them from `vscode-file:`/`vscode-resource:`.
- **The virtual scheme:** the local route's workspace is `file:`, so scheme-specific code (spec 013
  criterion 6, schema files on `vscode-vfs:` or `vscode-test-web:`) is only tested in CI.
- **Network origins** (spec 013 criterion 11, 013 T4): only the CI route has a Playwright page whose
  requests can be recorded.

## Findings (013 T1, 2026-10-12)

- **Desktop runs the suite in the web host (plan R2): yes, with one condition.** VS Code 1.141.0
  runs `--extensionTestsPath` in the extension host of the development extension whose folder holds
  the test file, and in the desktop's Node host otherwise (`findTestExtensionHost` in
  `out/vs/workbench/workbench.desktop.main.js`). The first run, with the suite outside the
  extension's folder, ran Mocha in the Node host and failed there; `run.mjs` therefore copies the
  bundle into the extension folder. The smoke test checks it runs with no `process` global.
- **Workspace trust.** VS Code's browser workbench turns Workspace Trust off unless the page that
  embeds it passes `enableWorkspaceTrust` (`get disableWorkspaceTrust() { return
  !this.options.enableWorkspaceTrust; }` in `src/vs/workbench/services/environment/browser/
  environmentService.ts` on VS Code's `main`, read 2026-10-12). `@vscode/test-web` 0.0.81 does not
  pass it (no `WorkspaceTrust` in its `out/`), so the CI route's workspace is trusted, and the smoke
  test fails if it is not. The local route passes `--disable-workspace-trust`. **Not verified:**
  whether vscode.dev and github.dev pass `enableWorkspaceTrust`. That needs the real sites in a
  browser, which neither a cloud sandbox nor CI can open (spec 013 §Where we differ: if either starts
  in Restricted Mode, an owner UNKNOWN is raised before T5).
