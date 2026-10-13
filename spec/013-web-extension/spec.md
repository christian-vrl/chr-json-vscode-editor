# SPEC 013 — Web extension (vscode.dev and github.dev)

> **Status:** `approved (owner: Chris, thread decision card cmsg_01Wz9SKzwQD2da69nuNGPcidQbVdJVVfHtwPqHyhUJuvE4, 2026-10-11)`
> Criteria 1, 8 and 11 were reworded in review after that approval; the owner kept the new wording
> (Keep/Revert card cmsg_01Wz9SKzwQD2da69nuNGPcidV4NLoW5PjyW1XF61ZfWRec, 2026-10-12 11:52Z, "Keep").
> The spec is the source of truth. Plan and tasks derive from it. Desired behavior changed?
> Change the spec first, not the code.

## Problem / motivation
CHR JSON Editor runs only in desktop VS Code (and in remote windows, whose extension host is Node).
vscode.dev and github.dev run VS Code in the browser, where extensions run in a web worker with no
Node: an extension must declare a `browser` entry point, or it does not load there at all. Our
package declares only `main` (`packages/vscode-extension/package.json`), so today nobody can use the
editor in vscode.dev or github.dev. The feature map lists the web build as P1
(`spec/INDEX.md` P1 row 013). jsoneditoronline.org is itself a web page, so users who already edit
JSON in a browser are the ones this reaches.

## Goal
Installing CHR JSON Editor in vscode.dev or github.dev gives the same editor as on desktop, from the
same `.vsix`, with every command working except the ones UNK-053 makes desktop-only, and with our
code making no network request.

## Terms
- **Web host:** VS Code's web worker extension host: the one vscode.dev and github.dev use, and the
  one desktop VS Code runs when started with `--extensionDevelopmentKind=web`.
- **Browser entry:** `dist/web/extension.js`, named by `"browser"` in the extension's
  `package.json`. **Node entry:** today's `dist/extension.js`, named by `"main"`.
- **Virtual scheme:** any URI scheme other than `file` that a workspace lives on:
  `vscode-vfs` in github.dev, `vscode-test-web` in the test harness, and whatever vscode.dev uses for
  a local folder opened through the browser.
- **Threshold** and **ceiling:** spec 008's 5 MiB (5,242,880 bytes of UTF-8 text) and VS Code's
  sync limit (spec 008 §Acceptance criterion). "Size" is the UTF-8 length of the document's text
  when the tab opens or the command runs, as in specs 008, 010 and 011.

## Acceptance criterion (falsifiable)
"Web e2e" means `pnpm test:e2e:web` (ADR-013): the packaged extension, loaded from the files of the
release `.vsix` built with test hooks, in `@vscode/test-web` on VS Code stable in headless Chromium,
with the fixture folder mounted on a virtual scheme.

1. **One package, two entries:** the `.vsix` from `pnpm package` has `"main": "./dist/extension.js"`
   and `"browser": "./dist/web/extension.js"`, and both files. A unit test over the built browser
   entry finds no `require(` call other than `require("vscode")`. `package.json` declares
   `"capabilities": { "virtualWorkspaces": true }`. Those two are the only manifest fields added for
   the web: commands, menus, `customEditors` and activation are one list for both hosts (desktop-only
   commands are hidden by `when` clauses, criterion 8); `engines.vscode` stays `^1.136.2`.
2. **No Node in shared host code:** an ESLint rule fails on any import of a Node built-in
   (`node:*`, `fs`, `path`, `crypto`, `child_process`, `os` and the rest of `module.builtinModules`)
   in `packages/vscode-extension/src/**` outside `src/node/**`, and a lint fixture shows it failing.
   Only `src/node/**` holds Node-only code, and only the Node entry imports it.
3. **Opens (web e2e):** "Open With → CHR JSON Editor" on the `.json`, `.jsonc` and `.json5` fixtures
   of spec 003 opens the editor, and the webview's data (test hook) equals the document's parse.
   The extension activates with no error in the web host's log.
4. **Edits, save, undo (web e2e):** spec 003 criteria 2–5 hold on the virtual scheme: a `patch`
   sent through the test hook leaves the document text byte-equal to the expected file; the
   document is dirty; save writes exactly those bytes (read back with `workspace.fs.readFile`); one
   undo restores the previous text exactly; an external `WorkspaceEdit` shows in the webview with
   nothing echoed back.
5. **Schema validation (web e2e):** on spec 004's fixtures copied to the virtual scheme, a document
   whose `$schema` is a relative path and a document matched by a workspace `json.schemas` setting
   get the same errors (JSON pointer and keyword) as the desktop e2e expects. Ajv runs in the web
   host as ADR-010 says; a `$schema` or setting naming an `http:` or `https:` URL is still never
   fetched and shows the desktop message.
6. **Schema files on virtual schemes (core unit):** a relative `$schema`, or a `json.schemas` `url`
   relative to a workspace folder, resolves against the document's or folder's own scheme and
   authority, so `vscode-vfs://github/o/r/data/a.json` with `"$schema": "./s.json"` resolves to
   `vscode-vfs://github/o/r/data/s.json`, and is read through `workspace.fs` (or the open document)
   like a `file:` schema. Results for `file:` documents are unchanged: every existing association
   test passes unmodified. `http:` and `https:` stay remote.
7. **Commands (unit + web e2e):** `packages/vscode-extension/test/web/coverage.json` maps every
   command in `contributes.commands` either to the name of a web e2e test that runs it, or to
   `"desktop-only"` with a reason. A unit test fails when a command is missing from the map, when a
   named test does not exist in the web suite, or when the desktop-only list is not exactly the one
   UNK-053 sets (★: `chrJsonEditor.compareWithHead`). Each web e2e test runs its command on a
   fixture and checks the result its own spec's e2e checks on desktop.
8. **Desktop-only commands (web e2e + desktop e2e):** per UNK-053 ★, a desktop-only command is not
   in the command palette, editor title or explorer menus in the web host, and running it by id
   shows "`<command title>` is available in VS Code desktop." with no other effect. Its `when`
   clauses add `!isWeb && !chrJsonEditor.webHost`: VS Code's `isWeb` hides it in a browser workbench
   before the extension activates, and `chrJsonEditor.webHost`, which only the browser entry sets to
   `true` (first thing in `activate`), hides it in desktop VS Code's web host, where `isWeb` is
   false. Nothing has to be set for the command to show on desktop, so it shows there before
   activation too. The web e2e checks the palette right after the suite's first activation; on
   desktop the command and its menus are as spec 007 says, and the 007 e2e stays green.
9. **Compare With (web e2e):** "Compare With…" and "Compare Selected" on two files on the virtual
   scheme open the compare panel with the differences of `tests/compare/` fixtures, and copying one
   difference across is one undoable edit, as spec 007 criteria 4 and 6 say.
10. **Large files (web e2e):** a document of 5,242,881 bytes opens in large-file mode with spec 008's
    banner, and one of 5,242,880 bytes does not. The largest size that opens in the web host is the
    one UNK-054 records; above it the open command shows spec 008 criterion 9's message.
11. **No network from our code (web e2e, CI route):** the allowed set is exactly one origin, the
    `@vscode/test-web` server's (scheme, host and port), which serves the workbench, the extension's
    files and the mounted folder. Every request Playwright records during the suite from the web
    worker extension host or from a frame of one of our webviews (the custom editor and the compare
    panel, found by their `asWebviewUri` resource paths) has that origin; requests from VS Code's own
    workbench frames are not counted. A test-only probe that fetches `https://example.com` from the
    worker makes the check fail, and one from the webview is blocked by its CSP (`connect-src
    'none'`). `pnpm check:offline`
    scans `dist/web/` (it scans all of `packages/*/dist`) and stays green.
12. **Desktop unchanged:** `pnpm test:e2e` (desktop, Node entry) and the `vscode-matrix` workflow
    stay green with no expected value changed. The `.vsix` grows only by the browser entry, whose
    size `bench/RESULTS.md` or the PR records.
13. **Local route:** with `VSCODE_EXECUTABLE_PATH` set, `pnpm test:e2e:web` runs the same test
    bundle in desktop VS Code started with `--extensionDevelopmentKind=web` (no download).
    `packages/vscode-extension/test/web/README.md` names the criteria only the CI route covers
    (browser workbench, webview service worker, virtual scheme).
14. **README:** the README says the editor works in vscode.dev and github.dev, lists the
    desktop-only commands from criterion 7, and carries UNK-052's wording on the network (★: "The
    extension itself never makes a network request. In vscode.dev and github.dev, VS Code loads the
    extension and your files over the internet."). `pnpm check:readme` (spec 005) greps for that
    sentence once spec 005 T1 has made the check real.

## Where we differ from desktop
- "Compare with HEAD" is desktop-only (UNK-053 ★): VS Code's Git extension (`vscode.git`), which
  reads HEAD on desktop (UNK-038), does not exist in the web host, and github.dev's GitHub
  Repositories extension has no public API for committed content.
- Ceiling: VS Code's sync limit on desktop; in the web host the size UNK-054 records, if lower.
- Restricted Mode: unchanged. The manifest declares no `untrustedWorkspaces`, so VS Code keeps the
  extension off in an untrusted workspace on both platforms. T1 records whether vscode.dev and
  github.dev workspaces start trusted; if one does not, an owner UNKNOWN is raised before T5.

## Scope
- **In:** the browser entry and its build; moving Node-only host code behind `src/node/`; the
  `chrJsonEditor.webHost` context key and the desktop-only message; schema files on virtual
  schemes; the web e2e harness (CI and local route), the command coverage map and the web suite;
  the no-network check in the web host; the large-file ceiling in the web host; the README section.
- **Out:** Restricted Mode support (see above); reading Git HEAD in github.dev; publishing (spec
  005; the same `.vsix` goes to both registries, and a web-capable `.vsix` needs no extra step);
  the Chrome app (spec 020), which builds its own host on `app-shell`; features of specs not yet on
  `main` when a task runs, which keep the web suite green and add their own coverage entries under
  criterion 7.

## Current evidence (D2 — path + lines / section)
- Manifest: `packages/vscode-extension/package.json` has `"main": "./dist/extension.js"`, no
  `"browser"`, no `"capabilities"`; `engines.vscode` `^1.136.2` (UNK-016).
- Build: `packages/vscode-extension/esbuild.mjs` bundles `src/extension.ts` as CommonJS for
  `platform: 'node'` with `vscode` external, and the webview as one IIFE for the browser.
- Node imports in host code on `main` @ 7a6fdfb: bundling `src/extension.ts` with esbuild for
  `platform: 'browser'` (`format: 'cjs'`, `vscode` external, sandbox check 2026-10-11) fails on
  exactly three imports: `node:crypto` in `src/webviewHtml.ts:5` (`randomBytes` for the CSP nonce),
  `node:path` in `src/gitHeadVscode.ts:7` (`dirname` of the file path for the Git API) and
  `node:path` in `src/compareCommands.ts:11` (007 T4, PR #69: `path.posix.basename`, `extname`,
  `dirname` on `uri.path`). Ajv, `ajv-formats`, `ajv-draft-04`, `jsonc-parser` and `core` bundle
  for the browser with no error. File access already goes through `vscode.workspace.fs`
  (`src/editorProvider.ts:529`, `src/convertCommand.ts:154,183,198`).
- Web host behavior (sandbox check 2026-10-11, VS Code 1.141.0 `.deb` from packages.microsoft.com,
  a probe extension with only a `browser` entry, started with `--extensionDevelopmentKind=web`):
  `new Function('return 40+2')()` returns 42; `require('fs')` throws "Cannot load module 'fs'";
  `process` and `Buffer` are undefined; `crypto.getRandomValues` exists; `WorkerGlobalScope` exists;
  `vscode.extensions.getExtension('vscode.git')` is undefined; `vscode.env.uiKind` is 1 (Desktop),
  so VS Code's `isWeb` context key, which follows the workbench and not the extension host
  (inferred, not checked), would not hide a command on this route; criterion 8 adds our own key.
- Web host CSP: VS Code 1.141.0's
  `out/vs/workbench/services/extensions/worker/webWorkerExtensionHostIframe.html` sets
  `script-src 'self' 'unsafe-eval' … blob:`, so Ajv's code generation can run there (ADR-010 holds
  in the web host). Its `connect-src` allows `https:`, so nothing in VS Code stops a web extension's
  own requests: criterion 11 checks ours.
- HEAD reading: `src/gitHeadVscode.ts:52` uses `vscode.git` (UNK-038); `:63` already returns
  "not in a repository" for a non-`file` URI.
- Schema association: `packages/core/src/schema/association.ts:96` returns no schema for a relative
  `$schema` when the document is not `file:`, and `:180` treats every non-`file:` settings URL as
  remote; `src/editorProvider.ts:523-533` (`readSchemaFile`) reads only `file:` URIs.
- Test harness: npm `@vscode/test-web@0.0.81` (MIT, 2026-06-23) runs a VS Code web build in
  Playwright Chromium with `extensionDevelopmentPath`, `extensionTestsPath`, `folderPath` (mounted on
  `vscode-test-web://mount/`) and `quality: 'stable'`; it downloads the web build from
  update.code.visualstudio.com, which CI reaches (`ci.yml` e2e job) and cloud sandboxes do not
  (curl 2026-10-11: no connection). Desktop VS Code 1.141.0 accepts `--extensionDevelopmentKind=web`
  (`out/mainImpl.js`), the local route.
- HYPOTHESIS (T1 checks): VS Code's `capabilities.virtualWorkspaces` default would already allow
  the extension in github.dev; we declare it anyway. HYPOTHESIS (T1 checks): desktop VS Code runs
  `--extensionTestsPath` in the web host when started with `--extensionDevelopmentKind=web`; if not,
  the local route runs criterion 3 only and says so in its README.
- Specs 008–012: large-file mode (008, merged spec; tasks in flight), CSV (009), smart format (010),
  JS queries in a sealed QuickJS engine in the page (011, ADR-011, which names spec 013 as reusing
  the engine), JSON Lines (012). None of them uses a Node API in its design.

## UNKNOWNS (record in UNKNOWNS.md; escalate, do not decide)
| ID | Unknown | Blocks | Options (awaiting human) |
|---|---|---|---|
| UNK-052 | What the README and listing say about the network on the web | criterion 14; T6 | ★ Ship, with the sentence in criterion 14 · Don't ship a web build (desktop only) — resolved: ★ |
| UNK-053 | What "Compare with HEAD" does in the browser | criteria 7, 8; T2 | ★ Desktop-only: hidden on the web, a message if run · Shown, with the message only — resolved: ★ |
| UNK-054 | Largest document that opens in the web host | criterion 10; T5 | delegated (T5 evidence) |

## Gate (this spec's Definition of Done)
- [x] Acceptance criterion defined and falsifiable
- [x] Result-affecting UNKNOWNS resolved (UNK-052, UNK-053 by the owner on 2026-10-12; UNK-054 is
  delegated and decided by T5's evidence)
- [x] Human approval recorded
