# TASKS 003 — VS Code custom editor

> Derives from the plan. `[ ]` pending · `[~]` awaiting human gate · `[x]` done.
> No gate is crossed with open UNKNOWNS that affect the result.

## Phase A — Shell (risk-free / additive)
- [ ] **T1** `HostAdapter` interface and versioned message protocol (`init`, `update`, `edit`, `setMode`, `setFormat`, `error`), each carrying `docVersion`. — needs: 001 T4 — *gate: `pnpm test:unit` protocol round-trip tests green*
- [ ] **T2** `app-shell` mounting `vanilla-jsoneditor` (UNK-010), mode switch, toolbar, `DevHostAdapter` for the standalone page. — needs: 001 T6 — *gate: `pnpm test:web` loads the page with other origins blocked and switches tree/text/table*

## Phase B — Provider (risk-free / additive)
- [ ] **T3** `CustomTextEditorProvider` for `*.json`, `*.jsonc`, `*.json5` with `priority` per UNK-004; commands "Open in CHR JSON Editor" and "Reopen as Text". — needs: 001 T5 — *gate: e2e opens one fixture per format in the custom editor*
- [ ] **T4** Webview HTML with nonce CSP (criterion 6) and `localResourceRoots` limited to the extension's `dist`. — *gate: e2e test parses the CSP and asserts criterion 6*

## Phase C — Sync
- [ ] **T5** Webview→document via `core.applyPatch` → `WorkspaceEdit`; document→webview with echo suppression; library `parser` prop backed by `core` (criterion 10). — needs: 002 T6 (json, jsonc cases); 002 T5 for json5 cases — *gate: criteria 1, 2, 10 green*
- [ ] **T6** Text mode: debounced text diff becomes a `WorkspaceEdit`; invalid text shows the error state. — *gate: criterion 9 green*
- [ ] **T7** Undo/redo/save routed to VS Code. — *gate: criterion 3 green*

## Phase D — Features (risk-free / additive)
- [ ] **T8** Wire format, compact, sort, search/replace, repair-on-open and transform (JSONQuery, JMESPath, JSONPath labelled "JSONPath (Goessner)"; JS/Lodash not registered); whole-document actions routed through `core` (002 R12–R14, UNK-018 for repair); "Repair JSON" command for the text editor. — needs: 002 T9, T10 — *gate: criteria 4, 5, 10 green*
- [ ] **T9** Theme mapping `--jse-*` → `--vscode-*`; `scripts/capture-themes.ts` and `tests/themes/*.json`. `parallel` — *gate: criterion 7 green*
- [ ] **T10** Status-bar format badge and picker. `parallel` — *gate: criterion 8 green*
- [ ] **T11** Benchmark open, first render and one edit at 1, 10, 50, 100 MB on the CI runner; commit `bench/vscode-open.md` (evidence for UNK-014). `parallel` — *gate: file committed with numbers*

## Phase E — Owner try-out (requires approval)
- [~] **T12** Owner installs the `.vsix` artifact from the latest `main` CI run and tries it. — *gate: owner replies "G1 pass"*

## Off the critical path
- Settings (019), web build (013).
