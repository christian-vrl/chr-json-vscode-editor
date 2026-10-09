# PLAN 007 — Structural compare

> Derives from spec `007`. Constraints from `governance/constitution.md`
> (D3 observable behavior, D4 reversibility).

## Approach
Core first. `compare(left, right)` runs `diff(left, right)` (002 T9) and turns each operation into a
`Difference` with a path on each side where the value exists. `diff` emits array paths in the
coordinates of a partly patched array, so `compare` replays the patch while tracking, for each array
it touches, which left index each right index came from; that index map gives `leftPath` for every
operation. `copyDifference(source, target, d)` builds the smallest patch that makes the target match
the source at `d`'s location; for an item that exists only on the source side, it inserts after the
target item aligned with the source's previous item (from the same index map), so later items keep
their alignment. Because data alone does not say which side of `compare(left, right)` the source
is, `copyDifference` takes an optional 4th argument `from: 'left' | 'right'` (default `'right'`,
the spec's 3-argument form); the panel passes it for left-to-right copies (007 T1).

The compare page is a second entry in `app-shell` (`Compare.svelte`) with two read-only
`vanilla-jsoneditor` instances in tree mode, `onClassName` driven by the differences, and a toolbar
(counter, Next, Previous, copy buttons). It talks to a `CompareHostAdapter` (load both sides, receive
updates, request a copy), implemented by a dev host for Playwright and by the extension. All
computation stays in the extension host: it parses both sides with `core`, runs `compare`, sends the
data and differences to the page, and applies copies with `applyPatch` → `WorkspaceEdit`, exactly as
003 does for edits.

HEAD content comes from local Git per UNK-038; the HEAD side is a read-only text, parsed with the
working file's detected format.

## Constraints / invariants
- `core` stays pure TypeScript; `compare` and `copyDifference` are exported from `@chr-json-editor/core`.
- Only the extension host writes documents; the compare page never does (ADR-003).
- The compare webview gets the 003 CSP (nonce scripts, `connect-src 'none'`, no `unsafe-eval`) and
  `localResourceRoots` limited to the extension's `dist`.
- New message types are validated like `packages/app-shell/src/protocol.ts` and bump `PROTOCOL_VERSION`.
- No network: Git is read from the local repository only.
- No overwrite without snapshot/backup (D4): copies are ordinary undoable edits; nothing is saved automatically.

## Steps (each with a gate)
| Step | Goal | Evidence to produce | Gate |
|---|---|---|---|
| A | `compare` + `copyDifference` | `packages/core/src/compare.ts`, property suite | criteria 1, 2 |
| B | HEAD reader | reader + e2e on a temp repository; UNK-038 row filled | criterion 5 |
| C | Compare page | `Compare.svelte`, dev host, `tests/compare/` fixtures, web tests | criteria 3, 9 (theme) |
| D | VS Code panel | panel, commands, copy, live refresh, e2e | criteria 4–9 |
| E | Size limit | `bench/compare.md`, fallback to `vscode.diff` | criterion 10; UNK-037 resolved |

## Risks and mitigations
| Risk | Mitigation |
|---|---|
| R1 Index mapping from `diff`'s sequential paths to left paths is wrong for mixed inserts and removes | criterion 1's "every path resolves" plus a check that the value at `leftPath` is the one `diff` removed or replaced |
| R2 Copying one item shifts the alignment of later items, so the count drops by more or less than one | criterion 2 is a property test; a counterexample becomes an UNKNOWN on the copy rule, not a weaker test |
| R3 Large disjoint arrays are slow (002 T9 review: 20k items ≈ 6 s before `LCS_BUDGET`) | measure in E; the size limit and the text-diff fallback bound it |
| R6 `copyDifference` re-runs `diff` on each array it walks through to find the alignment (007 T1 review), so one copy in a large document repeats array diffs | include a copy in E's benchmark |
| R4 `onClassName` runs for every rendered node | look-up by a `Set` of path keys built once per `compare` result |
| R5 A copy into a file that is not open leaves an unsaved document nobody sees | open it in a background tab (criterion 6) so VS Code's own dirty marker and save apply |

## Definition of Done
1. Criteria 1–10 pass in CI. 2. UNK-036 resolved before T3; UNK-037 and UNK-038 resolved by their delegated rules.
