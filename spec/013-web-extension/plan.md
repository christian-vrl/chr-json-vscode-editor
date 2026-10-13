# PLAN 013 — Web extension (vscode.dev and github.dev)

> Derives from spec `013`. Constraints from `governance/constitution.md`
> (D3 observable behavior, D4 reversibility).

## Approach
One `.vsix`, two entry points (ADR-013). esbuild builds the host code twice from the same sources:
`dist/extension.js` (CommonJS, `platform: 'node'`, as today) from `src/extension.ts`, and
`dist/web/extension.js` (CommonJS, `platform: 'browser'`, `vscode` external, `target` the web
host's Chromium) from `src/web/extension.ts`. Both entries call one shared `activateShared(context,
platform)`; the Node entry passes a `platform` object with the Node-only services (today: the Git
HEAD reader); the browser entry passes none and sets the context key `chrJsonEditor.webHost` first
thing in `activate`. The
webview bundles (`dist/webview.js`, the compare page) are already browser code and are shared as is.

Node built-ins leave the shared code:
- **Nonce:** `crypto.getRandomValues` (Web Crypto; Node 22 and the web host both have it) replaces
  `randomBytes` in `src/webviewHtml.ts`.
- **Paths:** `uri.path` is always `/`-separated, so `basename`, `extname` and `dirname` on it become
  a small `src/uriPath.ts` (or `vscode.Uri.joinPath(uri, '..')`); no `path-browserify` dependency.
- **Git HEAD:** `src/gitHeadVscode.ts` moves to `src/node/`; the compare commands get the reader from
  `platform` and, without it, show the desktop-only message (spec criterion 8).

Schema files on virtual schemes change `core`'s association: relative paths resolve against the
document's (or settings folder's) scheme and authority, not only `file:`; `http(s):` stays remote.
An absolute `$schema` path (`/x`) names a file from the root of the document's own scheme and
authority, as VS Code's JSON service resolves it (013 T4); on `file:` it stays `file:///x`.
`readSchemaFile` reads any non-remote URI through `workspace.fs`.

Tests (ADR-013):
- **CI route:** `pnpm test:e2e:web` → `test/web/run.mjs` unzips the `.vsix` built by
  `CHR_TEST_HOOKS=1 pnpm package` into a temp folder and calls `@vscode/test-web`'s `runTests` with
  that folder as `extensionDevelopmentPath`, `quality: 'stable'`, `browserType: 'chromium'`,
  headless, `folderPath` = a fresh copy of `test/web/fixtures/`, and `extensionTestsPath` = the web
  suite: Mocha tests bundled by esbuild into one browser file (`dist-test/web/suite.js`, not
  shipped). A `ci.yml` job runs it with the downloaded web build cached by version, like the e2e job.
- **Local route:** with `VSCODE_EXECUTABLE_PATH`, `run.mjs` instead calls `@vscode/test-electron`'s
  `runTests` with `--extensionDevelopmentKind=web` and the same suite bundle, on a `file:` copy of
  the fixtures.
- **Network check:** the CI route uses Playwright's request events (test-web's `--browserOption` /
  a small wrapper over its Playwright page) to record every request from the worker and webview
  frames, and fails on any origin other than the test server's; a test hook that fetches
  `https://example.com` from the worker is the expected-failure fixture.
- **Coverage map:** `test/web/coverage.json` plus a unit test reading `package.json`'s
  `contributes.commands` and the suite's test titles.

## Constraints / invariants
- Offline (AGENTS rule 3): no request from our code in either host; `check:offline` scans
  `dist/web/`; no allowlist entry is added.
- Desktop behavior and its e2e expectations do not change (criterion 12).
- Licenses (AGENTS rule 4): `@vscode/test-web` (MIT) and its dependencies are dev-only and do not
  ship; no runtime dependency is added.
- ADR-010 (Ajv in the extension host) and ADR-011 (queries in the page) hold on the web unchanged.
- `@vscode/test-web` pulls `@playwright/browser-chromium`, whose install script downloads Chromium:
  keep `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` where the root Playwright already provides one, and pin
  exact versions.
- Shared ledgers per AGENTS rule 9.

## Steps (each with a gate)
| Step | Goal | Evidence to produce | Gate |
|---|---|---|---|
| A | Browser entry activates; both test routes run | `dist/web/extension.js`; `test/web/run.mjs`; criterion 3 smoke on one `.json` fixture; trust state of vscode.dev and github.dev workspaces recorded in `test/web/README.md` | criteria 1, 3 (one fixture) green on both routes; criterion 13 README written |
| B | Shared host code Node-free | `src/node/`, lint rule + fixture, `chrJsonEditor.webHost` with `isWeb` on desktop-only menus, desktop-only message | criteria 2, 8 green; desktop `pnpm test:e2e` green |
| C | Schema files on virtual schemes | core association change + unit tests; `readSchemaFile` | criterion 6 green; every existing association test unchanged |
| D | Web suite and coverage | the web suite, `coverage.json`, the unit test, the network check and its probe | criteria 3–5, 7, 9, 11 green in CI |
| E | Large files on the web | `bench/web-ceiling.md`; UNK-054 resolved | criterion 10 green; UNK-054 resolved per its rule |
| F | README | web section per UNK-052 | criterion 14 |

## Risks and mitigations
| Risk | Mitigation |
|---|---|
| R1 test-web's web build download is unreachable from cloud sandboxes, so Implementers can't run the CI route locally | Local route through desktop VS Code's web host (criterion 13); its README names what only CI covers; Implementers read the CI job's result before asking for review |
| R2 Desktop VS Code may not run `--extensionTestsPath` in the web host | T1 checks; if not, the local route runs the smoke only and CI is the gate |
| R3 Large documents may exhaust the browser tab (both the worker and the webview hold the text) | UNK-054's evidence rule; large-file mode (008) already avoids the full parse |
| R4 Later specs add Node-only code or commands without web cases | The lint rule (criterion 2) and the coverage map (criterion 7) fail their PRs; the web e2e job runs on every PR |
| R5 vscode.dev or github.dev start workspaces in Restricted Mode, where the extension is off | T1 records it; an owner UNKNOWN before T5 if so (spec §Where we differ) |
| R6 Spec 011's QuickJS WebAssembly in a vscode.dev webview (served through the webview service worker) | covered by criterion 7 once 011 is on `main`: its query command gets a web e2e test |
| R7 Later host PRs (008 T3, 009–012 tasks) touch `extension.ts` while T2 moves code | T2 updates from `main` before merge; the lint rule catches new Node imports |

## Definition of Done
1. Criteria 1–14 green (13 on the local route in a sandbox, the rest in CI).
2. UNK-052, UNK-053 and UNK-054 resolved; ADR-013 confirmed.
3. INDEX row 013 and `AGENTS.md` §Canonical stack list `pnpm test:e2e:web` and `@vscode/test-web`.
