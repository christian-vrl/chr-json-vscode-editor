# SPEC 003 — VS Code custom editor

> **Status:** `approved (owner: Chris, thread message cmsg_01Wz9SKzwQD2da69nuNGPcidEGps3h6QkUAkZLe48ZhPH2, 2026-10-08)`
> The spec is the source of truth. Plan and tasks derive from it. Desired behavior changed?
> Change the spec first, not the code.

## Problem / motivation
No VS Code extension offers tree, text and table modes over one live document with repair, query
and style-preserving edits (`docs/research/feature-map.md` §Existing VS Code extensions). This spec
delivers the editor for `.json`, `.jsonc` and `.json5`.

## Goal
Opening a JSON, JSONC or JSON5 file with "CHR JSON Editor" shows it in tree, text or table mode,
and every edit there is a normal edit of the VS Code document (save, undo, dirty marker, Git diff),
with comments and style kept.

## Acceptance criterion (falsifiable)
`pnpm test:e2e` drives the webview through a test-only message hook (compiled out of release builds):
1. For the first 10 golden cases per format in sorted path order, opening `input.*` in the custom
   editor and applying `patch.json` through the webview leaves `TextDocument.getText()` byte-equal to `expected.*`.
2. An external `WorkspaceEdit` appears in the webview's data, and no edit is echoed back (document version unchanged after 500 ms).
3. After a webview edit `document.isDirty === true`; after `workbench.action.files.save` the file bytes on disk equal the document text and `isDirty === false`; `undo` restores the previous text exactly.
4. Switching tree → text → table → tree leaves the document bytes unchanged.
5. Each of format, compact, sort keys, search/replace, repair, and transform with JSONQuery, JMESPath and JSONPath, run on `tests/e2e/fixtures/<feature>/input.json`, produces `expected.json` byte-for-byte.
6. The webview HTML's CSP has `default-src 'none'`, `script-src` with a nonce only, `style-src` limited to the webview source and nonce, `connect-src 'none'`, and no `unsafe-eval`; `pnpm check:offline` passes.
7. With CSS variables from `tests/themes/{light,dark,hc}.json` (captured from VS Code's default themes by `scripts/capture-themes.ts`), the app-shell passes axe-core's `color-contrast` rule (`pnpm test:web`).
8. A status-bar item shows the detected format; choosing another format re-parses without changing bytes.
9. Typing in text mode updates the document within one debounce interval; invalid text shows an error marker and does not overwrite the document with repaired content.
10. Opening a `.jsonc` or `.json5` file with comments in any mode loses no comments (the library's `parser` prop uses `core`). Format, compact, sort and transform on `tests/e2e/fixtures/comments/*` keep every comment not attached to a removed member (002 R12–R14); comments attached to removed members go with them, with no confirmation (UNK-015).

## Scope
- **In:** custom editor, commands ("Open in CHR JSON Editor", "Reopen as Text", "Repair JSON" for the text editor), sync, modes, the features in criterion 5, theming, format badge, large-file measurement.
- **Out:** schema validation (004), JavaScript/Lodash queries (011), compare (007), CSV (009), web build (013).

## Current evidence (D2 — path + lines / section)
- ADR-001, ADR-002, ADR-003, ADR-006.
- `vanilla-jsoneditor@3.13.0/index.d.ts:499-501` exposes `parser` and `validationParser` props; default parsing is `JSON.parse` (reviewer report 2026-10-08).
- `onChange` returns `patchResult` with `redo` patch (`index.d.ts:302-305`); HYPOTHESIS that it is set for text-mode edits — T5/T6 verify.

## UNKNOWNS (record in UNKNOWNS.md; escalate, do not decide)
| ID | Unknown | Blocks | Options (awaiting human) |
|---|---|---|---|
| UNK-004 | Default editor or "Open With" | T3 | see ledger |
| UNK-010 | Svelte 5 vs plain TS shell | T2 | see ledger |
| UNK-015 | Whole-document actions on files with comments | T8 | resolved: keep comments (002 R12–R14) |
| UNK-018 | Comment-keeping repair | T8 | delegated (002 T11) |
| UNK-014 | Large-file ceiling | spec 008 | delegated (T11 evidence) |

## Gate (this spec's Definition of Done)
- [x] Acceptance criterion defined and falsifiable
- [ ] Result-affecting UNKNOWNS resolved
- [x] Human approval recorded (G0); owner try-out G1 passed
