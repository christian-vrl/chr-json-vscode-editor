# PLAN 011 — JavaScript and Lodash queries

> Derives from spec `011`. Constraints from `governance/constitution.md`
> (D3 observable behavior, D4 reversibility).

## Approach
**Where the code runs (ADR-011, UNK-048 ★).** The library's Transform dialog calls
`QueryLanguage.executeQuery` synchronously for the preview and for Transform, so a query engine that
answers by message (extension host, worker, frame) cannot plug into it; we would have to rebuild the
dialog, its wizard and its preview. ADR-010's spike already showed that a frame with its own CSP
does not load in a VS Code webview, and the extension host would give query code Node's file,
process and network access unless we wrap it in something that really isolates it. QuickJS compiled
to WebAssembly gives both at once: a separate JavaScript engine with its own heap and global object
(no DOM, no Node, no network objects exist in it), with an interrupt handler for a time limit and a
memory limit, callable synchronously from the page. The page only needs `'wasm-unsafe-eval'`, which
permits compiling WebAssembly and nothing else: page scripts still cannot `eval`. The same code runs
on Chrome MV3 extension pages and in a vscode.dev webview, so specs 013 and 020 reuse it.

T1 proves this in a real VS Code webview before anything else is built (spec HYPOTHESIS). If it
fails, the spec changes first and the fallback is QuickJS in a `worker_threads` worker in the
extension host with our own Transform dialog for these two languages; that goes back to the owner as
a new UNKNOWN, since it changes what the user sees.

**`runQuery(language, data, queryText)`** in `packages/app-shell/src/query/`:
1. Create a QuickJS runtime with a 256 MiB memory limit and an interrupt handler with a 5 s deadline;
   create a context. For Lodash, evaluate `lodash.min.js` (bundled as a string, never evaluated in
   the page) and check `_.chain(`/`.value()` counts as the library does.
2. **Bridge in (Q1, Q2):** `JSON.stringify` the data in the page with a replacer that records the
   JSON Pointer of every `-0`, `NaN`, `Infinity` and `-Infinity` (written as `null`); pass the text
   and the pointer list as two strings; inside the engine `JSON.parse` the text (which keeps
   `__proto__` as an own key) and set each recorded number at its pointer.
3. Evaluate `"use strict";` + query text + the library's own check that `query` is a function, then
   call `query(data)`.
4. **Bridge out:** a small serializer evaluated inside the engine walks the result once: it rejects
   `BigInt` and cycles with Q2's messages, records special-number pointers, and emits JSON text with
   `JSON.stringify` semantics otherwise; the page parses it (with `__proto__` as an own key, as core's
   parsers do) and restores the special numbers. `undefined` becomes `null`.
5. Map engine errors to `QueryError`: the interrupt to the 5-second message, the memory limit to the
   256 MiB message, anything else to its own message. Free the context and runtime in `finally`.

The engine module (`quickjs-emscripten-core` + the single-file browser release-sync variant, whose
WebAssembly is base64 inside the JS) is imported dynamically, so Vite puts it in its own chunk loaded
by the same nonce'd script mechanism; it is compiled the first time Transform opens (criterion 10).
`App.svelte` adds `{ ...javascriptQueryLanguage, executeQuery }` and `{ ...lodashQueryLanguage,
executeQuery }` to `QUERY_LANGUAGES`, so the wizard's `createQuery` and the dialog are the library's.
Write-back needs no new code: the library hands Transform's result to the paths that already exist
(Q5). For a tab above the threshold the host's `init` already says `largeFile` (008 T3); the two
languages are left out of the list there.

`contentSecurityPolicy()` gains `'wasm-unsafe-eval'` for the CHR JSON editor webview only (a
parameter, so the CSV, compare and convert panels keep 003's policy), and `assertCriterion6` gets a
variant that allows exactly that one source.

## Constraints / invariants
- The page never evaluates user text or Lodash's source; only the engine does. No `'unsafe-eval'`
  anywhere (ADR-006 stays true for JavaScript).
- No new message types and no protocol bump: queries never leave the webview.
- Only the extension host writes documents (ADR-003); Transform's result follows the existing paths.
- Exact pins: QuickJS packages 0.32.0, `lodash` = the locked `lodash-es` version (4.18.1); an upgrade
  is its own PR that re-runs criteria 1, 3 and 12.
- `tests/query/` is added to `.prettierignore`.
- No network (criterion 9); `pnpm check:offline` allowlist entries only with the Reviewer naming them.
- No overwrite without snapshot/backup (D4): all work in branches; Transform is one undoable edit.

## Steps (each with a gate)
| Step | Goal | Evidence to produce | Gate |
|---|---|---|---|
| A | Engine works in a real webview | `spikes/query-engine/REPORT.md` + results on VS Code 1.141.0 | HYPOTHESIS confirmed (or spec changed and owner asked) |
| B | Query corpus + coverage test | `tests/query/` cases with `case.json` tags | criterion 2; Reviewer checks every case against Q1–Q5 |
| C | `runQuery` in app-shell | engine wrapper, bridges, limits, unit and property tests | criteria 1, 3 |
| D | Dialog in the editor | languages, lazy load, dev-host CSP, web tests | criteria 4–6, 8, 10 |
| E | VS Code | CSP + check, e2e write-back, bench, licenses | criteria 7, 9, 12, 13 |
| F | Large files | language list above the threshold, e2e | criterion 11 |

## Risks and mitigations
| Risk | Mitigation |
|---|---|
| R1 VS Code's webview refuses WebAssembly under its CSP even with `'wasm-unsafe-eval'` | T1 first, on the same `renderWebviewHtml` and VS Code 1.141.0; fallback in §Approach goes to the owner |
| R2 The page freezes while a query runs (synchronous) | 5 s limit; T4 records how often the dialog re-runs the preview while typing; measured speeds (spec evidence) are well inside it up to 5 MiB; above 5 MiB the languages are off (UNK-049 ★) |
| R3 A memory bomb takes longer than the deadline to stop (8.4 s in the sandbox check: the interrupt is not polled inside one large native allocation) | criterion 5 allows 15 s for the memory case; T1 measures in the webview; T3 may lower the limit if that keeps every bench query passing |
| R4 Results differ from the library's (engine differences: `Intl`, locale sorting, regex flags) | criterion 1 runs every case against the reference; a difference becomes a case tagged with its cause, documented in §Where we differ, with the spec changed first |
| R5 Bundle size (+~0.7 MB) slows opening | separate chunk, compiled on first Transform (criterion 10); T5 records the `.vsix` size change in its PR |
| R6 A QuickJS or Lodash bug lets code out of the engine | the engine has no host objects to reach; criterion 4 probes the obvious routes on every CI run; exact pins, upgrades reviewed |

## Definition of Done
1. Criteria 1–13 pass in CI. 2. UNK-048 resolved before T1; UNK-049 before T6.
