# PLAN 018 — Copy path and reveal node

> Derives from spec `018`. Constraints from `governance/constitution.md`
> (D3 observable behavior, D4 reversibility).

## Approach
Everything that reads text lives in `core` (`packages/core/src/paths/`), exported from
`@chr-json-editor/core`, so the extension host, the webview, the web build and a later Chrome app
share it:
- `jsonPath(path)`, `jsonPointer(path)` write P1 and P2; `readPath(text, data)` reads P3 (the
  pointer half reuses `formats/pointer.ts`).
- `nodeAt(format, text, offset)` and `placeOf(format, text, path)` walk tokens once from the start
  and stop: `nodeAt` at the end of the token at the offset (A6), `placeOf` at the node (or, for R2,
  at the end of the object holding it). They keep a stack of open objects and arrays with the
  current name or index, never a tree, so a 50 MiB document costs one partial scan and no
  `FormatNode`s (criterion 11). `json` and `jsonc` use jsonc-parser's scanner as `tokens.ts`
  does; `json5` uses the JSON5 parser's lexer, made callable on its own (today it only runs inside
  `parseJson5`); `jsonl` finds the line with `indexOf('\n')`, counts non-blank lines before it and
  scans that line alone.

The webview (`packages/app-shell`) adds S1–S4: menu items in `renderContextMenu`, a `pathParser`
whose `stringify` walks the library's current data to tell indices from names (the library's
`JSONPath` holds strings only), a capture-phase click handler that sends the navigation bar's copy
to the host (as `interceptRepair` does for repair), and `onChangeMode` hooks that carry the place
with `nodeAt` and `placeOf` on the page's text. The host (`packages/vscode-extension`) adds S5–S6:
four commands, a request for the page's current node (the `getRowSource` pattern), a `reveal`
message to the page, and `showTextDocument` with a selection for the text editor. Clipboard writes
always go through `vscode.env.clipboard`, which works in the desktop and the web host alike.

## Constraints / invariants
- No overwrite without snapshot/backup (D4): the commands never change the document, its file, its
  dirty state or a tab's lock; the only write is the clipboard.
- Offline (AGENTS rule 3): nothing is fetched; no new dependency.
- `core` stays free of DOM and Node APIs (spec 013).
- Locating never builds a parse tree and never adds to core's parse cache (criteria 4, 11).
- Webview messages: the PR that adds them bumps the protocol version by one and adds its changelog
  row; the number is the next free one on `main` when it merges (16, taken by 018 T2).

## Steps (each with a gate)
| Step | Goal | Evidence to produce | Gate |
|---|---|---|---|
| A | Path text and locating in core | `tests/paths/`, `packages/core/src/paths/`, coverage and property tests | criteria 1–4 |
| B | The page: menus, navigation bar, mode switch | app-shell changes, protocol bump, `tests/web` cases | criteria 5, 6 |
| C | Commands | e2e fixtures, menus, context keys | criteria 7–9 |
| D | JSON Lines, large files, bench | e2e on `.jsonl` and 008's fixture, `bench/RESULTS.md` rows | criteria 10, 11 |
| E | Web | web e2e case, 013 coverage map | criterion 12 |

## Risks and mitigations
| Risk | Mitigation |
|---|---|
| R1 The JSON5 lexer is not separable from the parser without changing parse results | T1 moves it behind the same tokens; every golden and property suite of 002 stays green in the same PR |
| R2 The library's `JSONPath` is strings only, so `stringify` cannot tell `["0"]` (a name) from index 0 | `stringify` walks the page's current data step by step; criterion 5's `index-like-name` case |
| R3 Intercepting the navigation bar's copy button breaks on a library update | the handler matches the button's title; criterion 5 fails loudly if the title changes |
| R4 The library's `scrollTo` does not expand collapsed parents | expand the path first, as `Compare.svelte` does (spec 007) |
| R5 `placeOf` on a text edited since the selection was made | S6's second message; criterion 9 |
| R6 json-p3 refuses `\u00xx` control escapes RFC 9535 requires | P1 still follows the RFC; criterion 3 names the excluded names; a later json-p3 can lift it |
| R7 Criterion 11's bound misses on the CI runner | record an owner UNKNOWN before merging instead of relaxing the bound (016 precedent) |

## Definition of Done
1. Criteria 1–13 green in CI.
2. UNK-080, UNK-081 and UNK-082 resolved.
3. README (spec 005) names the four commands in one line.
