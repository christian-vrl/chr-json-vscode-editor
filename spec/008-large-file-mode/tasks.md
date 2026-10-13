# TASKS 008 — Large-file mode

> Derives from the plan. `[ ]` pending · `[~]` awaiting human gate · `[x]` done.
> No gate is crossed with open UNKNOWNS that affect the result.

## Phase A — Core (risk-free / additive)
- [x] **T1** (Large) `parseData(format, text)` in `packages/core/src/formats/parse-data.ts`, exported
  from `@chr-json-editor/core`; fast-check suite for criterion 6 (seed committed, 10 000 runs per
  format) plus every golden input; `parseData` time and retained-heap columns in the core bench and
  `bench/RESULTS.md` regenerated. — needs: 002 T8 (core bench) — *gate: criterion 6 suite green;
  criterion 7 holds in the committed `bench/RESULTS.md`*

## Phase B — UI and host (risk-free / additive)
- [x] **T2** Large-file state in `app-shell`: `readOnly`, Tree and Table only, whole-document actions
  hidden, the banner with "Open as Text" and "Edit anyway" (locked and unlocked texts), the
  `openAsText` and `unlock` messages (protocol bump), a dev-host switch; web tests. Needs UNK-040
  resolved. `parallel` with T1 — needs: 003 T8 — *gate: criteria 2 and 3 (banner texts, read-only
  probe) and the banner part of criterion 12 green in `pnpm test:web`*
- [x] **T3** Host wiring in `packages/vscode-extension`: size at open and the threshold, `largeFile`
  in `init`, unlock and open-as-text handlers, the host rejecting edits from a locked tab, `parseData`
  in the format badge, validation and the webview parser for large JSONC and JSON5, a test hook
  reporting core's cached parses; e2e fixtures generated at 5,242,880, 5,242,881 and 6 MiB. — needs:
  008 T1, T2 — *gate: criteria 1–5 and 8 green in `pnpm test:e2e`; `pnpm check:offline` green*
- [x] **T4** Ceiling: measure VS Code's sync limit with files just below and above 50 × 2^20 bytes on
  stable and correct the spec's HYPOTHESIS if needed; `workspace.fs.stat` check and message with
  "Open as Text" in "Open in CHR JSON Editor". `parallel` with T1–T3 — needs: 003 T3 — *gate:
  criterion 9 green in `pnpm test:e2e`*

## Phase C — Limits (risk-free / additive)
- [x] **T5** Benchmark large-file mode (open and host busy time, plus one unlocked edit at 50 MiB for
  plan risk R5) for json, jsonc and json5 at 6, 10 and 50 MiB on the CI runner; commit
  `bench/large-file.md`; resolve UNK-041 per its rule and implement criterion 10's paused validation.
  — needs: 008 T3 — *gate: `bench/large-file.md` committed and criterion 11 holds in it; criterion 10
  e2e green; UNK-041 resolved per the delegation rule*

## Off the critical path
- T4 found the ceiling counts the text, not the bytes on disk. Criterion 9 compares the size on
  disk, so a file above 52,428,800 bytes whose text still fits (a BOM, or multi-byte UTF-8, or a
  UTF-16 file) gets the ceiling message although VS Code would hand it over; opening it with "Open
  With…" still works. Counting the text first would mean reading up to the whole file in the
  command; not worth it unless someone hits it.
- T4's e2e checks that a file at the ceiling opens in CHR JSON Editor; T3 added the assertion that
  it opens in large-file mode to `ceiling.cjs`.
- T3: a locked tab's badge, validation and `$schema` read the text with `parseData`, so the badge
  shows valid or error and no longer counts strict-JSON warnings there. The three reads share one
  `parseData` result for two seconds (`largeFile.ts` `dataOf`) instead of parsing three times; T5's
  host-busy numbers measure this. After "Edit anyway" the tab takes the normal path (full parse,
  cached) like spec 003.
- A threshold setting belongs to 019 (Settings). A host answer by text delta (UNK-014 idea) would
  speed unlocked edits and spec 003's normal edits alike; it is a later spec if wanted. Compare of
  large files is 007's UNK-037.
- T5 (`bench/large-file.md`, run 38169445043): criterion 11 holds (first render minus webview
  ready at 50 MiB: 990 / 1,575 / 1,012 ms for JSON / JSONC / JSON5); UNK-041 resolved to 10 MiB.
  Plan R5: "Edit anyway" at 50 MiB works but the first edit takes 4.5–10 s and leaves 2.2–2.6 GB of
  host heap; no UNKNOWN, since nothing failed and spec 008 already says edits may be slow. Plan R6:
  webview heap 95–127 MiB at 50 MiB.
- Seen in T5's numbers, not changed: the format badge takes about 2 s of host time on open for JSON
  at 50 MiB (1.2 s JSONC, 0.7 s JSON5), well above `parseData` alone (224 ms for JSON); validation
  runs twice on open (when the schema is bound and when the webview is ready) and the second run
  parses again once `dataOf`'s 2 s are over. Both are host time on open with no bound in the spec.
- T5 re-parses the badge after "Edit anyway" and drops `dataOf`'s kept result when a tab closes
  (008 T3 review findings 1 and 2). Left as they are: `dataOf` keeps one slot, so two large
  documents read in turn parse each time (finding 3); the `send` test hook exists only in test
  builds (finding 4).
- UNK-064: on the CI runner criterion 7 missed for json5 at 10 MiB (50.2%); Chris chose "Speed it
  up" and T1 was reopened. `parseJson5Data` now runs a data-only walk (`json5-parser.ts`
  `DataParser`) that gives up on any syntax error or rare construct and hands the text to the full
  grammar, so data and errors stay the same. `bench/RESULTS.md` (run 38247455427): json5 10 MiB 37%
  (192 ÷ 526 ms), 50 MiB 17%.
