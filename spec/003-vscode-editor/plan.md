# PLAN 003 — VS Code custom editor

> Derives from spec `003`. Constraints from `governance/constitution.md`
> (D3 observable behavior, D4 reversibility).

## Approach
Build `app-shell` first as a standalone page testable in Playwright, behind a `HostAdapter` with a
versioned message protocol. Then wrap it in a `CustomTextEditorProvider`. Data flow: webview edit →
JSON Patch → host → `core.applyPatch` → `WorkspaceEdit`; document change → host → webview `update`.
Every message carries the document version so echoes are dropped. The library parses through
`core` (its `parser` prop), so comments never reach `JSON.parse`.

## Constraints / invariants
- Only the extension host applies `WorkspaceEdit`s; the webview never writes the file.
- `core.applyPatch` runs only in the extension host, so formatting rules run in one place; the webview uses `core` only to parse.
- No `unsafe-eval` in the main webview CSP; JS/Lodash query languages are not registered (spec 011).
- No overwrite without snapshot/backup (D4).

## Steps (each with a gate)
| Step | Goal | Evidence to produce | Gate |
|---|---|---|---|
| A | Shell + protocol | `HostAdapter`, message types, web tests | modes switch offline in Chromium |
| B | Provider + CSP | provider, CSP test | criterion 6; e2e opens all formats |
| C | Sync | e2e golden subset | criteria 1–3, 9, 10 |
| D | Features | fixtures per feature | criteria 4–5 |
| E | Theming + badge | axe runs, status-bar test | criteria 7–8 |
| F | Measure | `bench/vscode-open.md` | numbers committed |
| G | Owner try-out | preview `.vsix` from CI | G1 |

## Risks and mitigations
| Risk | Mitigation |
|---|---|
| R1 Library undo conflicts with VS Code undo | intercept undo/redo in the webview, forward to VS Code, re-sync on document change |
| R2 Text-mode typing floods messages | debounce; in text mode the document text is authoritative |
| R3 `patchResult` absent in text mode | diff old/new text in the host instead (T6) |
| R4 Big files | measure in F; spec 008 sets thresholds |

## Definition of Done
1. Criteria 1–10 green in CI. 2. G1 passed.
