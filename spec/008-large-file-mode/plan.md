# PLAN 008 — Large-file mode

> Derives from spec `008`. Constraints from `governance/constitution.md`
> (D3 observable behavior, D4 reversibility).

## Approach
Core first. `parseData(format, text)` reads only the data: no tree, tokens, style or warnings, and
nothing cached. For `json` and for any text that is strict JSON it uses `JSON.parse`, as
`app-shell/src/parser.ts` already does; for `jsonc` and `json5` it walks the text once, building
values directly. It must agree with `getAdapter(format).parse(text)` on data and on whether there is an
error, which the property suite checks against the full parse on the golden corpus and generated texts.
The core bench gets a `parseData` column next to `parse`.

The webview gets a large-file state from the host in `init` (`largeFile: { bytes, unlocked }`, a
protocol bump): `readOnly` on the library, mode buttons limited to Tree and Table, whole-document
actions hidden, a banner with "Open as Text" and "Edit anyway" that send new messages to the host
(`openAsText`, `unlock`), and the library's `parser` switched to `parseData` for JSONC and JSON5. The
dev host gets a switch for the same state so `pnpm test:web` covers the banner and read-only behavior.

The host measures the size once when the tab opens. For a locked large-file tab it never calls core's
full `parse`: the format badge and validation use `parseData`, and `releaseParse` is not needed because
nothing is cached. "Edit anyway" flips the tab's session to the normal path (spec 003's sync, which
parses and caches on the first edit) and tells the webview. "Open as Text" runs the existing
`chrJsonEditor.reopenAsText`. Above UNK-041's size the host skips validation and shows a status-bar
item that validates once on click.

The ceiling check lives in the "Open in CHR JSON Editor" command: `workspace.fs.stat` before
`vscode.openWith`, and a message with "Open as Text" above the ceiling.

## Constraints / invariants
- `core` stays pure TypeScript; `parseData` is exported from `@chr-json-editor/core`.
- Only the extension host writes documents (ADR-003); a locked tab sends no edits at all.
- New message types are validated like `packages/app-shell/src/protocol.ts` and bump `PROTOCOL_VERSION`.
- Files up to 5 MiB take exactly today's code path; the existing e2e suite is the regression gate.
- No network; the webview CSP is unchanged.
- No overwrite without snapshot/backup (D4): large-file mode writes nothing; an unlocked tab edits
  through ordinary undoable `WorkspaceEdit`s, and nothing is saved automatically.

## Steps (each with a gate)
| Step | Goal | Evidence to produce | Gate |
|---|---|---|---|
| A | `parseData` | `packages/core/src/formats/parse-data.ts`, property suite, bench column | criteria 6, 7 |
| B | Large-file UI | banner, read-only, modes, dev-host switch, web tests | criteria 2, 3 (web), 12 |
| C | Host wiring | threshold, `init` state, unlock, open as text, `parseData` in badge and validation, cache probe, e2e | criteria 1–5, 8 |
| D | Ceiling | stat check and message in the open command, e2e | criterion 9 |
| E | Benchmark and validation limit | `bench/large-file.md`, UNK-041 row, paused validation | criteria 10, 11 |

## Risks and mitigations
| Risk | Mitigation |
|---|---|
| R1 `parseData` disagrees with `parse` on an edge (`__proto__`, duplicate keys, `-0`, JSON5 hex, line continuations, lone surrogates) | criterion 6 compares against the full parse on the golden corpus and on fast-check texts; a counterexample is a bug in `parseData`, not a weaker test |
| R2 `parseData` for JSON5 is not twice as fast as `parse` (criterion 7) | measure in A first; if it misses, record an UNKNOWN for the owner rather than lowering the bar |
| R3 The library still edits in `readOnly` somewhere (context menu, paste, drag, transform modal) | criterion 2's `patch` probe plus web tests on each entry point; the host also rejects `edit` from a locked tab |
| R4 VS Code's exact sync limit differs from 50 × 2^20 bytes | T4 measures it with files just below and above, and the spec's HYPOTHESIS is corrected before the criterion is gated |
| R5 "Edit anyway" at 50 MiB makes the host keep a ~2 GB parse and may exhaust the extension host's heap | measure an unlocked 50 MiB edit in E; if it fails, record an UNKNOWN (cap "Edit anyway" below some size) for the owner |
| R6 The webview's own memory at 50 MiB (library state plus data) is large | E records it with the open timings; no criterion today |

## Definition of Done
1. Criteria 1–12 pass in CI. 2. UNK-040 resolved before T2; UNK-041 resolved by its delegated rule.
