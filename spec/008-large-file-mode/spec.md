# SPEC 008 — Large-file mode

> **Status:** `approved (owner: Chris, thread decision card cmsg_01Wz9SKzwQD2da69nuNGPcidVvbZY2s6tJFXBpsm5byWKw, 2026-10-09)`
> The spec is the source of truth. Plan and tasks derive from it. Desired behavior changed?
> Change the spec first, not the code.

## Problem / motivation
Above 5 MiB the full editor is slow: on the CI runner the first-edit median is 515–588 ms at
5–10 MiB, the first and second edits take 3.7–4.4 s at 50 MiB, and a cold first edit at 5 MiB misses
500 ms every time (`bench/vscode-open.md`, UNK-014). Memory grows faster than the file: one core parse of a 50 MiB file keeps about 2 GB of heap
alive (`bench/RESULTS.md` §Memory), and the extension host keeps that parse for the badge,
validation and the next edit. The owner set the limit of the full editor at 5 MiB (UNK-014). Users
still need to open, read and search files above it, up to VS Code's own 50 MB limit for extensions
(feature map P1 "Large-file mode … open read-only above a threshold").

## Goal
A JSON, JSONC or JSON5 document above 5 MiB opens in CHR JSON Editor in a lighter large-file mode
(tree and table, read-only per UNK-040) that uses much less memory and parses faster, with one click
to VS Code's text editor; files up to 5 MiB behave exactly as today; files VS Code will not hand to
extensions get a clear message instead of a failed open.

## Acceptance criterion (falsifiable)
"Size" is the UTF-8 byte length of the document's text when the tab opens. "Threshold" is
5 MiB = 5,242,880 bytes (UNK-014). "Ceiling" is VS Code's sync limit for extensions: 50 × 2^20 =
52,428,800 (measured by T4 on VS Code 1.141.0: VS Code hands a document to extensions when its text
is at most 52,428,800 UTF-16 code units, `TextModel._MODEL_SYNC_LIMIT`; a file of 52,428,800 ASCII
bytes opens, 52,428,801 does not, and a UTF-8 BOM in front of 52,428,800 opens because VS Code
leaves the BOM out of the text). Criterion 9 uses the file's size on disk
(a UTF-8 BOM included), because the command runs before VS Code loads the document; every other
criterion uses the text size.

1. **Threshold (e2e):** a document of exactly 5,242,880 bytes opens in the normal editor (spec 003);
   one of 5,242,881 bytes opens in large-file mode. The mode is chosen when the tab opens and kept
   for the tab's lifetime, whatever later edits do to the size; reopening the file chooses again.
   Files up to the threshold behave exactly as spec 003 says, and the 003/004 e2e suites stay green.
2. **Read-only (e2e, per UNK-040):** in large-file mode the tree and table modes show the document's
   data with the library's `readOnly` on. A `patch` sent through the test hook sends no `edit` message
   and the document version is unchanged after 500 ms. The mode buttons offer Tree and Table only; the
   whole-document actions (format, compact, sort, repair, transform) are not offered; search,
   expand/collapse, select and copy work.
3. **Banner (e2e, web):** a banner above the editor reads "Large file (`<size>` MiB): read-only to
   stay fast." (size with one decimal, rounded down) with two buttons. "Open as Text" runs "Reopen as
   Text": the tab is replaced by VS Code's text editor on the same document, bytes unchanged.
   "Edit anyway" unlocks the tab (criterion 4).
4. **Edit anyway (e2e):** after "Edit anyway" the banner reads "Large file (`<size>` MiB): edits may
   be slow." with "Open as Text" only, and the tab edits like spec 003: on a 6 MiB fixture, one `patch`
   leaves the document text byte-equal to the expected file, the document is dirty, save writes those
   bytes, and one undo restores the previous text exactly. The tab stays unlocked until it closes;
   reopening the file is read-only again. Text mode stays unavailable; "Open as Text" is the way to
   edit text.
5. **Live (e2e):** an external `WorkspaceEdit` on a large-file document, locked or unlocked, appears
   in the webview's data (spec 003 criterion 2), and nothing is echoed back.
6. **Data-only parse (core, unit + fast-check, seed committed, 10 000 runs per format):**
   `parseData(format, text)` in `packages/core` returns `{ data }` when `getAdapter(format).parse(text)`
   has no `error` diagnostic, with `data` equal to that parse's `data` under `isDeepStrictEqual`
   (`__proto__` keys and `-0` included), and `{ error: { message, offset } }` with the parse's first
   error's message and offset otherwise. Checked on every golden input and on generated texts per
   format (valid documents and single-character mutations of them). It never adds an entry to core's
   parse cache (`releaseParse`'s cache).
7. **Lighter parse (core bench):** in `bench/RESULTS.md`, regenerated in one run, `parseData` for
   `jsonc` and `json5` at 10 and 50 MiB has a median time at most half of `parse`'s and a retained heap
   at most half of `parse`'s, in the same run.
8. **No full parse kept (e2e test hook):** while a locked large-file tab is open, core's parse cache
   holds no parse of its text, after open, after the format badge is computed and after validation;
   the format badge still shows the detected format and its diagnostics outcome (valid or error), and
   choosing another format re-parses with `parseData` without changing bytes (spec 003 criterion 8).
   The webview parses large JSONC and JSON5 with `parseData` (strict JSON keeps `JSON.parse`).
9. **Over the ceiling (e2e):** "Open in CHR JSON Editor" on a file whose size on disk is above the
   ceiling does not call `vscode.openWith`; it shows "`<name>` is `<size>` MiB. VS Code does not pass
   files above 50 MB to extensions, so CHR JSON Editor can't open it." with an "Open as Text" button
   that opens the file in VS Code's text editor. A file at the ceiling still opens, in large-file mode.
10. **Validation (per UNK-041, e2e):** up to UNK-041's size, schema validation of a large-file document
    runs as spec 004 says. Above it, validation does not run on open or on change; a status-bar item
    reads "Schema validation paused: large file" and clicking it validates once with `parseData`'s
    data and shows the result as spec 004 does.
11. **Speed (bench):** `bench/large-file.md`, written by a script from one CI run, gives medians of 3
    for json, jsonc and json5 at 6, 10 and 50 MiB in large-file mode: webview ready, first render, and
    the time the extension host is busy on open (badge and validation). At 50 MiB, first render minus
    webview ready (the part our code adds) is under 5 s for each format.
12. **CSP, offline, theme:** the webview CSP is unchanged (spec 003 criterion 6); `pnpm check:offline`
    passes; the banner passes axe-core's `color-contrast` rule with `tests/themes/{light,dark,hc}.json`
    in `pnpm test:web`.

## Scope
- **In:** the threshold and mode choice, read-only tree and table, the banner with "Open as Text"
  and "Edit anyway", `parseData` in `core`, host and webview use of it, the ceiling message in our
  command, paused validation above UNK-041's size, the large-file benchmark.
- **Out:** files above VS Code's sync limit in the custom editor (VS Code never hands them over;
  feature map's "tested to 100 MB" and "streaming load" cannot be met inside VS Code's custom editor
  API), text mode inside the webview for large files (VS Code's text editor does this better), a
  setting for the threshold (019 may add one), a host answer by text delta (UNK-014 idea, only
  helps unlocked edits), compare of large files (007 UNK-037), the vscode.dev build (013), the Chrome
  app (020).

## Current evidence (D2 — path + lines / section)
- Requirement: `docs/research/feature-map.md` §Prioritized feature list (P1 "Large-file mode: tested
  to 100 MB, open read-only above a threshold, streaming load") and §Risks ("Large files … test 50 MB
  and 200 MB files early"); UNK-014 resolution (threshold 5 MiB, owner).
- Timings: `bench/vscode-open.md` (run 37874204494): first edit 515 / 588 / 3,737 ms and second edit
  370 / 553 / 4,351 ms at 5 / 10 / 50 MiB; webview ready 11,323 ms and first render 13,087 ms at 50 MiB,
  so VS Code itself takes most of the open; 100 MiB never opens ("Files above 50MB cannot be
  synchronized with extensions", run 37844893412).
- Memory and parse cost: `bench/RESULTS.md` §Results and §Memory (run 37867109909): json / jsonc /
  json5 `parse` at 50 MiB 6,394 / 6,194 / 6,225 ms, retained heap 2,061 / 2,007 / 1,760 MiB.
- Where the host parses: `packages/vscode-extension/src/formatBadge.ts:59-66` (`reparse` →
  `adapter.parse`), `packages/vscode-extension/src/schemaBinding.ts:145` (`parse(text).data` for
  validation), `packages/vscode-extension/src/documentSync.ts:94` (`applyPatch` for edits); cache
  release in `packages/vscode-extension/src/parseRelease.ts`.
- Where the webview parses: `packages/app-shell/src/parser.ts:35-52` (strict JSON through `JSON.parse`,
  everything else through core's full `parse`).
- Library hooks: `vanilla-jsoneditor@3.13.0/index.d.ts:486` (`readOnly`), `:503`
  (`maxDocumentSizeTextMode`, default 10 MiB: text mode shows its own "Open anyway" warning above it).
- "Reopen as Text": `chrJsonEditor.reopenAsText`, `packages/vscode-extension/src/commands.ts:23`.
- CSP and offline: ADR-006, spec 003 criterion 6; theme capture: spec 003 criterion 7.

## UNKNOWNS (record in UNKNOWNS.md; escalate, do not decide)
| ID | Unknown | Blocks | Options (awaiting human) |
|---|---|---|---|
| UNK-014 | Large-file threshold | criterion 1 | resolved (owner): 5 MiB |
| UNK-040 | What large-file mode does | criteria 2–4; T2, T3 | resolved (owner): read-only with "Edit anyway" |
| UNK-041 | Largest large-file size at which schema validation still runs on open and change | criterion 10; T5 | resolved (delegated, T5 evidence): 10 MiB |
| UNK-064 | Criterion 7 misses on the CI runner for json5 at 10 MiB (50.2%) | criterion 7 | owner, open |

## Gate (this spec's Definition of Done)
- [x] Acceptance criterion defined and falsifiable
- [ ] Result-affecting UNKNOWNS resolved
- [x] Human approval recorded
