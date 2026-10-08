<!-- Snapshot of the Claude Doc "CHR JSON Editor: Architecture Proposal" (https://claude.ai/code/artifact/c244d9b1-b920-41b7-b4eb-8525604fbf53), revision 25, exported 2026-10-08 for 001 T1.
     Rationale and research only. The "Roadmap and open decisions" table predates the owner's answers;
     the outcomes are in spec/UNKNOWNS.md and spec/DECISIONS.md.
     The spec/ files win wherever this snapshot differs from them. -->

# CHR JSON Editor: Architecture Proposal

Oct 8, 2026 · @Christian

## Summary

Build one TypeScript monorepo with a host-agnostic editor core on top of `vanilla-jsoneditor` (ISC), shipped twice: as a VS Code custom editor and as an offline Chrome extension. Every asset is bundled, nothing is fetched at runtime, and a strict Content Security Policy enforces that.

- **Editor engine:** `vanilla-jsoneditor` 3.13, the framework-agnostic build of the same open-source editor (by Jos de Jong) that powers jsoneditoronline.org. It already gives tree, text and table modes, repair, sort, transform/query, and JSON Schema validation.
- **Our own code:** what the site does around the editor: two-panel layout, compare/diff, CSV conversion, JSONC/JSON5 handling, local file open/save in place of cloud documents.
- **Hosts:** VS Code via `CustomTextEditorProvider` (VS Code owns the file, undo and save); Chrome via a Manifest V3 extension page, so it installs from the Chrome Web Store and runs with no network.
- **License:** MIT for our code, a THIRD\_PARTY\_LICENSES file listing bundled licenses, and a credit line naming jsoneditoronline.org as inspiration, with no use of its name or logo as branding.
- **Method:** the repo follows your SDD starter kit: specs with falsifiable gates, an independent reviewer for every task, and you only at three gates (see Roadmap).

## Feature inventory

About two thirds of the site's features come from the editor library; the rest is ours to build, and cloud features become local files.

| Site feature | Source in our build | Offline notes |
| --- | --- | --- |
| Tree, text and table modes | `vanilla-jsoneditor` | Built in |
| Format, compact, smart formatting | `vanilla-jsoneditor` | Built in |
| Auto-repair of broken JSON | `jsonrepair` (inside the library) | Built in |
| Sort, filter, search and replace, undo/redo | `vanilla-jsoneditor` | Undo is delegated to VS Code in that host |
| Transform/query: JSON Query, JSONPath, JMESPath | `vanilla-jsoneditor` | Pure functions, no eval |
| Transform/query: JavaScript and Lodash | `vanilla-jsoneditor` | Uses `new Function`; needs an eval-allowed sandbox in Chrome |
| JSON Schema validation | Ajv via `createAjvValidator` | Ajv compiles schemas with `new Function`; same sandbox rule. Remote `$ref` loading disabled |
| Two panels side by side, copy left/right | Ours (`app-shell`) |  |
| Compare two documents (data-level diff) | Ours (`core/diff`) |  |
| CSV to JSON and JSON to CSV | Ours (`core/convert`) |  |
| Load from URL | Dropped by default | The only feature that needs network; optional, off by default |
| Cloud save, share links, public documents | Replaced by local files | Open/save from disk; VS Code workspace files |
| Large files (library handles up to 512 MB) | `vanilla-jsoneditor` | VS Code message passing limits apply; see Architecture |

Sources: [svelte-jsoneditor README](https://github.com/josdejong/svelte-jsoneditor) and [JSON Editor Online on Toolradar](https://toolradar.com/tools/json-editor-online) (jsoneditoronline.org itself refused automated access). Eval use was confirmed by inspecting the published `vanilla-jsoneditor@3.13.0` bundle.

## Architecture

The same UI bundle runs inside a VS Code webview and a Chrome extension page; each host only supplies a small adapter for files and settings.

_Diagram (2 hosts, 1 shared bundle, 1 core) lives in the Claude Doc linked at the top of this file._

In VS Code the file stays a normal `TextDocument`: the webview sends edits back as text, so dirty markers, undo, Git diff and other extensions keep working. Documents above a size threshold (default 50 MB, to measure in M1) open in text mode first to keep message passing fast.

## Tech stack

TypeScript everywhere, Vite for the webview and Chrome bundles, esbuild for the extension host, and only permissively licensed runtime dependencies.

| Concern | Choice | License | Why |
| --- | --- | --- | --- |
| Editor UI | `vanilla-jsoneditor` 3.13 | ISC | Same engine as the site; no framework lock-in, so the shell can stay plain TS or use Svelte 5 |
| JSONC parsing and edits | `jsonc-parser` 3.3 (Microsoft) | MIT | Same parser VS Code uses; can apply edits while keeping comments |
| JSON5 parsing | `json5` 2.2 | MIT | Reference implementation |
| Big numbers without precision loss | `lossless-json` 4.3 | MIT | Same author; plugs into the editor's parser option |
| CSV | `papaparse` (to confirm) | MIT | Streams large files; or a small own parser if we want zero extra deps |
| Diff | `jsondiffpatch` or own structural diff (open decision) | MIT | Data-level compare like the site |
| Shell UI | Plain TS + CSS, or Svelte 5 (open decision) | MIT | Svelte is already inside the editor bundle, so it adds little weight |
| Build | pnpm workspaces, Vite, esbuild | MIT | One `pnpm build` produces the `.vsix` and the Chrome `.zip` |
| Tests | Vitest for core, `@vscode/test-electron` for the extension, Playwright (preinstalled Chromium) for the Chrome app | MIT / Apache-2.0 | Golden-master tests per the SDD method |
| Packaging | `@vscode/vsce`, plus Open VSX publishing for VSCodium users | MIT / EPL-2.0 (tool only, not shipped) |  |

**Edits keep comments, quoting and trailing commas.** The visual editor works on plain data, so tree and table edits are never saved by re-serializing the whole file. Instead `core/formats` diffs old and new data and applies the change as minimal text edits on a concrete syntax tree, leaving untouched bytes as they were. For JSONC that is `jsonc-parser`'s `modify`/`applyEdits`. For JSON5 (single quotes, unquoted keys, hex numbers) `jsonc-parser` cannot tokenize the syntax and `json5` keeps no source positions, so we need a format-preserving JSON5 CST: evaluate existing packages in spike 002-T4, else write our own in `core` (proposed default). New nodes inherit the file's style: quote type, indentation, trailing commas on or off.

**JSON, JSONC and JSON5 are all first-class (P0).** Each gets its own file association (`.json`, `.jsonc`, `.json5`, plus VS Code's `jsonc` language id for files like `tsconfig.json`), a format badge in the toolbar, and a parse/serialize adapter in `core/formats` behind one `FormatAdapter` interface. Converting between the three is a toolbar action. Targets: JSON per RFC 8259, JSON5 1.0, and the jsonc.org draft for JSONC; that draft leaves trailing commas open, so we accept them on read and keep whatever the file already does. No newer JSON format exists to add (checked in the feature map doc's "Formats and current specs" section). Golden tests cover all three from spec 002.

**Schema and query targets.** Ajv validates JSON Schema 2020-12 (via its `Ajv2020` class) and draft-07, picked from the schema's `$schema`. The editor's built-in JSONPath uses an older syntax; an RFC 9535-compliant JSONPath is a P2 item, added as an extra query language.

## Repo layout

One pnpm monorepo; the two host packages are thin, and anything a user can see or do lives in `core` or `app-shell`.

```
chr-json-vscode-editor/
├── AGENTS.md, CLAUDE.md          SDD starter kit adapters (bootstrap.sh)
├── governance/                   constitution + SDD method, unchanged from the kit
├── spec/
│   ├── DECISIONS.md              ADRs, seeded from the open decisions below
│   ├── UNKNOWNS.md
│   └── INDEX.md, 001..005/       spec.md, plan.md, tasks.md
├── packages/
│   ├── core/                     pure TS, no DOM: parse/serialize (JSON, JSONC, JSON5),
│   │                             diff, CSV convert, format detection
│   ├── app-shell/                the UI: two panels, toolbar, compare view, dialogs;
│   │                             wraps vanilla-jsoneditor; talks to a HostAdapter interface
│   ├── sandbox/                  eval-allowed page for JS/Lodash queries and Ajv
│   ├── vscode-extension/         extension host: CustomTextEditorProvider, commands,
│   │                             settings, VscodeHostAdapter, webview CSP
│   └── chrome-app/               MV3 manifest, extension page, ChromeHostAdapter
│                                 (File System Access API), service worker
├── tests/golden/                 sample files + expected outputs shared by all packages
├── LICENSE, THIRD_PARTY_LICENSES.md
└── .github/workflows/            build, test, offline check, package .vsix and .zip
```

`HostAdapter` is the single seam between UI and host: `open()`, `save(text)`, `onExternalChange()`, `getSettings()`, `showMessage()`. Each host implements it once; nothing else in `app-shell` knows which host it runs in.

## Offline guarantees

"Offline" is enforced by policy and checked in CI, not just promised.

1. **Everything bundled.** Fonts, icons (the library already bundles Font Awesome SVGs) and styles ship inside the `.vsix` and Chrome `.zip`. No CDN imports; the library's `standalone.js` CDN path is never used.
2. **CSP with no network origins.** VS Code webview: `default-src 'none'; script-src ${webview.cspSource} 'nonce-…'; style-src ${webview.cspSource}; img-src ${webview.cspSource} data:; connect-src 'none'`. Chrome extension page: MV3 default CSP plus `connect-src 'none'`.
3. **Eval kept in a box.** JavaScript/Lodash queries and Ajv schema compilation need `new Function`. MV3 forbids `unsafe-eval` on extension pages but allows it on a manifest-declared sandbox page, so those run in `packages/sandbox` via `postMessage`. In VS Code a spike picks between the same sandbox iframe and running Ajv in the extension host; the main webview CSP never gets eval.
4. **No remote schemas.** Ajv is created without `loadSchema`; a `$ref` to a URL shows a clear "remote refs are not loaded offline" error. Local schema files can be picked instead.
5. **No telemetry.** No analytics SDK; the extension does not call `vscode.env.createTelemetryLogger`.
6. **Manifest minimalism.** Chrome: no `host_permissions`, no `permissions` beyond `storage`. VS Code: `"extensionKind": ["ui", "workspace"]` and a browser entry so it also runs in vscode.dev with no server.
7. **CI offline test.** Playwright opens the Chrome build and the VS Code webview with network blocked and fails the build on any request that is not `vscode-webview://` or `chrome-extension://`. A static check also greps bundles for `http://` and `https://` URLs and fails on unknown ones.

## Licensing and attribution

The editor library's ISC license allows free redistribution in both products, provided its copyright notice ships with them; our own code goes out under MIT.

| Item | License | What we must do |
| --- | --- | --- |
| Our code | MIT (proposed) | `LICENSE` at repo root and in both packages |
| `vanilla-jsoneditor`, `jsonrepair`, `immutable-json-patch`, `lossless-json` (Jos de Jong) | ISC / MIT | Keep copyright + license text in `THIRD_PARTY_LICENSES.md`, shipped inside the `.vsix` and `.zip` |
| `jsonc-parser`, `json5`, Ajv, CodeMirror 6, Svelte | MIT | Same file, generated at build time by a license checker |
| Font Awesome free icons (bundled by the editor) | CC BY 4.0 (icons), MIT (code) | Attribution line in `THIRD_PARTY_LICENSES.md` |

A CI step fails the build if any runtime dependency carries a license outside MIT, ISC, BSD, Apache-2.0 or CC BY.

**Crediting the inspiration.** README, marketplace page and the About dialog carry: "Inspired by [JSON Editor Online](https://jsoneditoronline.org) by Jos de Jong. Built on his open-source svelte-jsoneditor (ISC). Not affiliated with or endorsed by jsoneditoronline.org." We do not reuse the site's name, logo or colours as our branding, which keeps us clear of trademark confusion. The library README asks commercial users to help fund maintenance; since we are free, a "Support the original author" link to his sponsor page is a good-faith gesture.

## Roadmap and open decisions

The plan now follows your SDD kit: five v1 specs with falsifiable gates, written as repo-ready files in the project's shared folder under `sdd/`, so threads can run tasks without asking you between gates.

_Diagram (5 v1 specs, 3 human gates) lives in the Claude Doc; `spec/INDEX.md` holds the same plan as text._

Within the parallel block, 003 needs 002's JSON/JSONC adapter before its sync step, and 004 needs 003's app shell. Each task's gate is a command or test CI can check, and a reviewer thread that did not write the code signs it, as `multi-llm-workflow.md` requires.

| File in `sdd/` | What it holds |
| --- | --- |
| `AGENTS.md` | Filled project context (Layer 2), including what agents may do without asking and what stays yours |
| `spec/INDEX.md` | Every spec with priority, dependencies, what runs in parallel, and the three gates |
| `spec/001` to `spec/005` | `spec.md`, `plan.md`, `tasks.md` per the kit templates; 42 tasks, each with a binary gate |
| `spec/DECISIONS.md` | ADR-001 to ADR-008, proposed until you confirm |
| `spec/UNKNOWNS.md` | 17 open questions: 13 are yours, each with a recommended option, and 4 are settled by measured evidence |
| `skills/sdd-task-runner`, `skills/gate-review` | How an implementer thread runs a task and how a separate reviewer thread signs its gate |

The decisions below are tracked as rows in `spec/UNKNOWNS.md`.

| Decision | Recommended | Alternative |
| --- | --- | --- |
| License for our code | MIT | Apache-2.0 (adds patent grant, more boilerplate) |
| Chrome packaging | MV3 extension page | Installable PWA (needs hosting a site once; offline after first load) |
| Open as default editor for `.json` | No; offered via "Open With" and a setting | Yes, replace the text editor by default |
| Shell UI framework | Svelte 5 | Plain TypeScript |
| Diff engine | `jsondiffpatch` | Own structural diff |
| Load-from-URL feature | Left out | Opt-in setting, off by default |
| Product name | "CHR JSON Editor" (working title) | Your pick |
| Repository | GitHub, public, under your account | Private until M4 |
