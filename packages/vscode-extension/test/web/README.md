# Web e2e (`pnpm test:e2e:web`, spec 013)

The suite in `suite/` runs in VS Code's web worker extension host, the one vscode.dev and
github.dev use, against the extension loaded from the files of the `.vsix` that
`CHR_TEST_HOOKS=1 pnpm package` wrote. `run.mjs` unzips it, bundles the suite with esbuild
(`dist-test/web/suite.js`) and copies the bundle into the unzipped extension folder, then picks a
route:

| Route | When | VS Code | Workspace |
|---|---|---|---|
| CI | default (the `ci.yml` job `e2e-web`) | VS Code stable's web build (downloaded by `@vscode/test-web` from update.code.visualstudio.com into `.vscode-test-web/`), served by `@vscode/test-web` and opened by `run.mjs` in headless Playwright Chromium | a copy of the fixtures mounted on the virtual scheme `vscode-test-web://mount/` |
| Local | `VSCODE_EXECUTABLE_PATH` is set | that desktop VS Code, started with `--extensionDevelopmentKind=web` (no download; run under `xvfb-run` on Linux) | a `file:` copy of the fixtures |

Cloud sandboxes can't reach the web build's download host, so Implementers run the local route
and read the CI job's result before asking for review (spec 013 plan R1). `CHR_WEB_E2E_COMMIT=<c>`
makes the CI route use a web build already in `.vscode-test-web/vscode-web-stable-<c>/` without
asking for the latest one; `CHR_WEB_E2E_VERBOSE=1` prints the page's console and every request the
network check counted.

## The suite (013 T4)

`run.mjs` copies into the workspace `tests/e2e/fixtures/` (as `fixtures/`), `tests/compare/`,
`tests/csv/`, the first ten golden patch cases of each format (as the desktop e2e picks them) and a
`.vscode/settings.json` whose `json.schemas` and `json5.schemas` select `fixtures/inline/people.*`
with urls relative to the folder. Each test edits copies under `work/`. One file per area:

| File | Spec 013 criterion |
|---|---|
| `smoke.ts` | 3: activation in the worker, the three formats open with their data |
| `palette.ts` | 8: the command palette lists no desktop-only command (CI route: through the page) |
| `desktopOnly.ts` | 8: Compare with HEAD run by id shows the desktop-only message |
| `editing.ts` | 4: golden patches byte for byte, save read back, undo/redo, external edits, Change Format |
| `actions.ts` | 4, 7: mode switches, spec 003's actions, Repair JSON, Open in / Reopen as Text |
| `validation.ts` | 5, 6: relative `$schema`, folder `json.schemas`, `https:` never loaded, absolute `$schema` |
| `convert.ts`, `compare.ts`, `csv.ts`, `query.ts` | 7, 9: each command's own spec cases (plan R6 for queries) |

`coverage.json` maps every command to the test that runs it or to "desktop-only" (criterion 7);
`test/unit/webCoverage.test.ts` checks it against `package.json` and the suite's `it` titles. A
spec that adds a command adds its web test and its row.

**Network check (criterion 11, CI route).** `run.mjs` records every request Playwright sees from
the worker extension host (its iframe and the worker) and from the frames of webviews
(`/webview/browser/pre/`), and fails the run if one goes to any origin but the test server's,
`http://localhost:3000`. Requests from VS Code's own workbench frames are not counted; the webview service worker's are
not either (it serves the webview's files from the server). `run.mjs --probe` runs
`suite/probe.ts` instead: a fetch of `https://example.com` from the worker, which must fail the
check (the `ci.yml` step expects exit 1 and the request named), and the same fetch from the CHR
JSON Editor's webview, which its CSP refuses. The built-in JSON Language Features extension
shares the worker and downloads `https` schemas by default (it fetched `https://example.com/s.json`
for `remote-schema.json` in the first CI run), so the workspace sets
`"json.schemaDownload.enable": false`.

**Palette check (criterion 8, CI route).** `palette.ts` logs a request; `run.mjs` sees it in the
console it relays, opens the palette in the page (F1), types the filter, and writes the rows'
labels to a file in the mounted folder, which the test fetches from the test server.

## What only the CI route covers

The local route runs the same suite in the same kind of extension host (a web worker with no Node),
but inside desktop VS Code. Only the CI route covers:

- **The browser workbench:** VS Code's `isWeb` context key is false on the local route (spec 013
  criterion 8), and webviews are served through Electron, not a browser. So on the local route a
  desktop-only command ("Compare with HEAD") shows in the palette and menus until the browser entry
  activates and sets `chrJsonEditor.webHost`; in a browser `isWeb` hides it from the start. Run by
  id, it shows the desktop-only message on both routes (`suite/desktopOnly.ts`).
- **The webview service worker:** in a browser, VS Code serves webview resources through a service
  worker; desktop serves them from `vscode-file:`/`vscode-resource:`.
- **The virtual scheme:** the local route's workspace is `file:`, so scheme-specific code (spec 013
  criterion 6, schema files on `vscode-vfs:` or `vscode-test-web:`) is only tested in CI.
- **Network origins** (spec 013 criterion 11) and **the command palette** (criterion 8): only the
  CI route has a Playwright page whose requests can be recorded and whose palette can be read. On
  the local route `palette.ts` checks only the `when` clause.
- **Absolute `$schema` paths** (`validation.ts`): on the virtual scheme `/x` is the mounted folder's
  root; on the local route's `file:` folder it is the file system's root, as on desktop.

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

## Known exposures (013 T2)

- **VS Code stable is downloaded at run time.** The CI route asks `@vscode/test-web` for
  `quality: 'stable'` (spec 013's "VS Code stable"), and the `ci.yml` cache key is the stable
  version read live from update.code.visualstudio.com, so a new stable release can turn the job red
  with no change here. The desktop `test:e2e` job has the same exposure. When the job turns red with
  no code change, compare the version in its cache key with the last green run's first.
- **Restricted Mode fails the suite.** If a later `@vscode/test-web` starts the workspace untrusted,
  the extension is off and the smoke test fails with "the test workspace starts in Restricted Mode";
  it never skips.
