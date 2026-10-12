# SPEC 007 — Structural compare

> **Status:** `approved (owner: Chris, thread decision card cmsg_01Wz9SKzwQD2da69nuNGPcidHm1YnN1U5VzZfFkSRkqPsk, 2026-10-09)`
> The spec is the source of truth. Plan and tasks derive from it. Desired behavior changed?
> Change the spec first, not the code.

## Problem / motivation
VS Code's built-in diff compares text line by line, so two JSON files with the same data in a
different key order, indentation or quoting show as different everywhere. jsoneditoronline.org's
compare is data-level: it ignores white space and key order and detects array inserts and deletes
(UNK-013). No VS Code extension offers that with the differences shown in a tree (feature map gap 4).

## Goal
The user compares two JSON, JSONC or JSON5 documents (two files, or a file against its Git HEAD
version) side by side in tree view, sees every data difference and only those, ignoring key order
and formatting, and can copy a difference from one side to the other.

## Acceptance criterion (falsifiable)
`compare(left, right)` in `packages/core` returns `Difference[]`, one per operation of
`diff(left, right)` (002 T9), each `{ kind: 'added' | 'removed' | 'changed', leftPath?, rightPath? }`
as JSON Pointers: `added` exists only on the right, `removed` only on the left, `changed` on both.

1. **Core (fast-check, seed committed, 10 000 runs):** `compare(a, b)` is empty exactly when `a` and
   `b` are equal under `diff`'s equality (`isDeepStrictEqual`: key order ignored, `NaN` equals `NaN`,
   `-0` differs from `0`); reordering any object's keys in `b` leaves the result unchanged; every
   `leftPath` resolves in `a` and every `rightPath` in `b`; where `b` only inserts or only removes items
   of an array of `a`, those items are `added` or `removed` and nothing else in that array is reported.
   *Amended by spec 015 B3 (spec 015, owner approval card cmsg_01Wz9SKzwQD2da69nuNGPcid8rBEjWhoBBUYvqqGxPwYhU, 2026-10-12; AGENTS rule 7): numbers are equal by exact value (spec 015 Terms), so `12345678901234567890` and `12345678901234567891` differ and `1e20` equals `100000000000000000000`; `-0` and `NaN` stay as written above.*
2. **Copy (core, same suite):** `copyDifference(source, target, d)` returns a JSON Patch for the
   target. Applied to the target, it leaves the target deep-equal to before except at `d`'s location,
   which now holds the source's value there (or no member, for a difference that is absent on the
   source side). Copying differences one at a time, from either side, re-running `compare` after
   each copy and taking any difference of the new result, makes both sides deep-equal within `2n`
   copies, `n` being the number of differences at the start (UNK-039: a copy can realign array
   items, so one copy may remove more or fewer than one difference).
3. **Panel (web, `pnpm test:web`, other origins blocked):** for each fixture `tests/compare/<case>/`
   (`left.*`, `right.*`, `expected.json` = the `Difference[]`), the compare page renders both sides in
   tree mode, read-only (per UNK-036), marks each difference's path with class `chr-diff-added`,
   `chr-diff-removed` or `chr-diff-changed` on the side(s) where it exists and every ancestor of a
   marked node with `chr-diff-inside`, and marks no other node. A counter shows the number of
   differences; "Next" and "Previous" select each difference in list order, expanding and scrolling it
   into view on both sides; with no differences the page says "No differences in the data".
4. **Commands (e2e):** "Compare With…" (active document vs a workspace file picked from a list or a
   file dialog), "Compare Selected" (explorer, exactly two `.json`, `.jsonc` or `.json5` files) and
   "Compare with HEAD" (active document vs its committed version, HEAD on the left) open the compare
   panel, titled `<left name> ↔ <right name>` (`<name> (HEAD)` for the HEAD side). The documents are
   compared as currently edited, unsaved changes included.
5. **Git (e2e, temp repository fixture):** "Compare with HEAD" on a committed file with an unsaved
   edit reports exactly that edit; on an untracked file it shows "`<name>` is not in Git HEAD"; outside
   a Git repository it shows "`<name>` is not in a Git repository"; no compare panel opens in those
   two cases. HEAD is read locally, with no network (UNK-038).
6. **Copy across (e2e):** copying one difference into a file side applies `copyDifference` as one
   `WorkspaceEdit` through `applyPatch` (002 R14), so on `tests/compare/comments/*` the target text
   equals `expected-after-copy.*` byte for byte, the target document is dirty, opens in a background
   tab if it was not open, and one undo in that tab restores its text exactly. The HEAD side offers
   no copy into it.
7. **Live:** an edit to either file document while the panel is open (typed in another editor or
   applied as an external `WorkspaceEdit`) is reflected in the panel's differences within 1 s.
8. **Formats:** either side may be JSON, JSONC or JSON5, parsed with its own detected format; a side
   whose parse has an `error` diagnostic shows the parse error instead of a tree, and nothing is
   compared. Comments and formatting never produce a difference.
9. **CSP, offline, theme:** the compare webview's CSP meets spec 003 criterion 6; `pnpm check:offline`
   passes; the compare page passes axe-core's `color-contrast` rule with `tests/themes/{light,dark,hc}.json`,
   difference colours taken from VS Code's `diffEditor.*` theme variables.
10. **Size:** compare runs up to the size UNK-037 sets; above it, the panel does not open and the
    message offers VS Code's text diff of the same two documents (`vscode.diff`) instead.

## Scope
- **In:** `compare` and `copyDifference` in `core`, the compare page in `app-shell` with its own
  host interface and a dev host for web tests, the VS Code compare panel, the three commands, copy
  across, live refresh, Git HEAD via local Git, the size limit.
- **Out:** editing inside the compare panels (per UNK-036; edits are made in the normal editor and
  show up live, criterion 7), text-level diff (VS Code has one), comparing against a commit other than
  HEAD or the index, three-way merge, matching array items by an id field, move detection (002 T9 has
  none), table and text modes inside the compare, the vscode.dev build (013), the Chrome app (020).

## Current evidence (D2 — path + lines / section)
- Requirement: `docs/research/feature-map.md` §What jsoneditoronline.org does (Compare row: "Two
  panels side by side, structural diff highlighting, copy left to right and back") and §Prioritized
  feature list (P1 "Structural compare: pick two files or editor vs Git HEAD, diff ignoring key order,
  copy values across"); UNK-013 resolution (site compare is data-level, ignores white space and key
  order, detects array inserts and deletes).
- `diff(a, b)`: `packages/core/src/diff.ts:1-16` (contract: add/remove/replace only, LCS on deep-equal
  items, gaps paired by position, `isDeepStrictEqual` equality), `:24` (export), `:89` and `:118`
  (`LCS_BUDGET` = 5 000 000 with a positional fallback); property suite per spec 002 criterion 9.
- Data-level writes keep comments: spec 002 R14; `FormatAdapter.applyPatch` (`packages/core/src/formats/types.ts:56-58`).
- Library hooks: `vanilla-jsoneditor@3.13.0/index.d.ts:486` (`readOnly`), `:509` (`onClassName(path, value)`),
  `:1250` (`expand(path)`), `:1255` (`scrollTo(path)`).
- Host-agnostic UI: ADR-002; the single-document `HostAdapter` (`packages/app-shell/src/host-adapter.ts:37-62`)
  has no notion of two documents, so the compare page gets its own interface.
- CSP and offline: ADR-006, spec 003 criterion 6; theme capture: spec 003 criterion 7.
- Git access (HYPOTHESIS, to verify in T2): VS Code's built-in Git extension exposes `getAPI(1)` with
  `Repository.show(ref, path)` (`extensions/git/src/api/git.d.ts` in the VS Code repository); see UNK-038.

## UNKNOWNS (record in UNKNOWNS.md; escalate, do not decide)
| ID | Unknown | Blocks | Options (awaiting human) |
|---|---|---|---|
| UNK-036 | Compare panels read-only with copy buttons, or editable like the site | criteria 3, 6; T3, T4 | see ledger |
| UNK-037 | Largest documents compare handles before falling back to text diff | criterion 10; T5 | delegated (T5 evidence) |
| UNK-038 | How HEAD content is read | criterion 5; T2 | delegated (T2 evidence) |
| UNK-039 | "Exactly one difference fewer" after a copy cannot always hold (a copy can realign array items) | criterion 2; T1 | resolved (owner): restated, see ledger |

## Gate (this spec's Definition of Done)
- [x] Acceptance criterion defined and falsifiable
- [ ] Result-affecting UNKNOWNS resolved
- [x] Human approval recorded
