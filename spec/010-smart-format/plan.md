# PLAN 010 — Smart format

> Derives from spec `010`. Constraints from `governance/constitution.md`
> (D3 observable behavior, D4 reversibility).

## Approach
Corpus first, as in 002 and 006: the golden cases are written and reviewed before `smartFormat`, so
they are the contract. Expected bytes are produced by running FracturedJson 5.1.0 with §Layout's
options on the case input and then hand-checked against L1–L8 (key order, comments, trailing commas,
JSON5 tokens), because FracturedJson's column and padding choices are its own and are not worth
re-deriving by hand.

`smartFormat(text, format)` in `packages/core/src/formats/smart-format.ts`:
1. Parse with the format's adapter; an `error` diagnostic throws `PatchError` (criterion 9). A text
   with no value returns unchanged.
2. **Bridge for JSON5 (L7):** walk `parseJson5(text).tokens`; replace each JSON5-only token (unquoted
   key, single-quoted string, hex, `Infinity`/`NaN`, signed or dotted number, a string with a line
   continuation) by a placeholder JSON string `"<n>"` and keep a table from placeholder to
   original bytes. JSON5-only white space becomes a space. `Formatter.StringLengthFunc` reports each
   placeholder's original width so columns and line length match the written tokens. After
   formatting, each placeholder is replaced by its original bytes. JSON and JSONC go to
   FracturedJson as they are (`AllowTrailingCommas`, `CommentPolicy.Preserve`).
3. **Format** with `Formatter.Reformat` and §Layout's options (indent, EOL from the detected `Style`).
4. **Key order (L5, UNK-045 ★):** FracturedJson's table template puts row members in column order.
   Pinned at exactly 5.1.0, override the formatter's table-row check (`CanBeTableRow` /
   `DivideContainerIntoSegments`, prototype methods) so a row whose keys are not in the template's
   order ends the table segment there. If the override needs more than that, vendor
   `fracturedjsonjs` 5.1.0 under `packages/core/vendor/fracturedjson/` with its MIT license and the
   patch as a separate commit. T2 picks one and says why in the PR; the property suite (criterion 3,
   key order) is the gate either way.
5. **Trailing commas (L6, UNK-046 ★):** FracturedJson drops them. Record which containers had one
   (by their order of opening bracket, which formatting does not change); after formatting, add a
   comma after the last member of each such container whose closing bracket is on its own line,
   before any same-line comment.
6. **Style:** final newline as the input (FracturedJson always ends with one), BOM kept.

The kept-token check of criterion 3 compares token streams (`tokenize` for JSON and JSONC,
`parseJson5(...).tokens` for JSON5) with layout tokens removed, so a bug in the bridge or the comma
pass fails the property suite instead of reaching a user.

The webview adds a "Smart format" button to the text mode menu next to `jse-format` and sends
`{ name: 'smartFormat' }` as a whole-document action (protocol bump); the host's `runAction` calls
`smartFormat` and writes through the existing minimal-replacement path, so one `WorkspaceEdit` and
one undo come for free. The command reuses the same host path for a CHR JSON editor tab and, for a
text editor, applies the result as one `WorkspaceEdit` like 003's "Repair JSON". Both check the
threshold first (criterion 10). The dev host's action switch gets `smartFormat` for `pnpm test:web`.

## Constraints / invariants
- `core` stays pure TypeScript with no DOM and no Node APIs; `fracturedjsonjs` (no dependencies, no
  Node API) is a runtime dependency of `core` pinned to exactly `5.1.0`: its output is the golden
  contract, so any upgrade is a PR that regenerates and re-reviews the corpus.
- No `expected.*` file changes without a spec change (AGENTS rule 5); `tests/golden/smart-format/` is
  added to `.prettierignore`.
- Only the extension host writes documents (ADR-003); the action and command are undoable edits and
  never save.
- Protocol: `smartFormat` is added to `ACTION_NAMES` with a `PROTOCOL_VERSION` bump; if another PR
  bumps it first, the PR merging second renumbers.
- No network; the webview CSP is unchanged.
- No overwrite without snapshot/backup (D4): all work in branches; the document change is one undo.

## Steps (each with a gate)
| Step | Goal | Evidence to produce | Gate |
|---|---|---|---|
| A | Golden corpus + coverage test | cases with `case.json` tags | criterion 2; Reviewer checks every case against L1–L8 |
| B | `smartFormat` in core | `smart-format.ts`, property suite, bench column | criteria 1, 3–6, 11, 12 (license) |
| C | Webview and command | menu item, action, command with its size guard, messages, web and e2e tests, README credit | criteria 7–9, 10 (text editor), 12 |
| D | Large-file tabs | e2e of the guard in large-file tabs | criterion 10 (large-file tab) |

## Risks and mitigations
| Risk | Mitigation |
|---|---|
| R1 The key-order override touches private FracturedJson methods | exact version pin; the property suite checks key order on every run; vendoring is the fallback (step 4) |
| R2 A placeholder's width differs from the token it stands for, so columns drift | `StringLengthFunc` maps placeholders to the original width; JSON5 golden cases inside tables pin the bytes |
| R3 FracturedJson moves a comment to another member or drops one | criterion 3 compares kept tokens in order; a counterexample becomes a golden case and an upstream issue, and a comment it cannot place makes `smartFormat` fall back to throwing with a message rather than losing it |
| R4 Not stable (criterion 4) after the comma or key-order pass | the property suite checks it; fix in our passes, not by weakening the criterion |
| R5 5 MiB takes over 5 s on the CI runner (criterion 11) and blocks the extension host meanwhile | measure in B; a miss becomes an owner UNKNOWN before C merges, as criterion 11 says; a worker thread in the host is the fallback design |
| R6 East Asian wide characters misalign columns | out of scope: widths are UTF-16 lengths, as the site's default; a later spec may pass a width function |

## Definition of Done
1. Criteria 1–12 pass in CI. 2. UNK-045, UNK-046 and UNK-047 resolved before T1 starts (all three resolved by the owner, 2026-10-11).
