# PLAN 014 — JSONPath (RFC 9535)

> Derives from spec `014`. Constraints from `governance/constitution.md`
> (D3 observable behavior, D4 reversibility).

## Approach
**One more `QueryLanguage`, not a new path.** The library's Transform dialog already takes a list
of `QueryLanguage`s (`id`, `name`, `description`, `createQuery`, synchronous `executeQuery`), and
spec 011 adds JavaScript and Lodash to the same list. RFC 9535 queries need no sandbox: json-p3 is
plain JavaScript that interprets the query (no `eval`), so it runs in the page like JSONQuery,
JMESPath and jsonpath-plus already do. The new language is one object in
`packages/app-shell/src/query/jsonpath-rfc9535.ts`:

```ts
export const jsonpathRfc9535QueryLanguage: QueryLanguage = {
  id: 'jsonpath-rfc9535',
  name: 'JSONPath (RFC 9535)',
  description: '<p>Enter a <a href="https://www.rfc-editor.org/rfc/rfc9535" …>JSONPath (RFC 9535)</a> …</p>',
  createQuery: jsonpathQueryLanguage.createQuery, // P7: already valid RFC 9535
  executeQuery,
};
```

`executeQuery(json, query)`: one module-level `JSONPathEnvironment({ maxRecursionDepth: 1000 })`
(P6; strict is the default); `env.query(query, json).values()` → a new array (P2). A `JSONPathRecursionLimitError` or a `RangeError` from the stack
becomes `new Error('The data is nested too deeply for this query.')`; other engine errors pass
through with their own message (criterion 6). Nothing else is translated: the values are the data's
own (P2), so `-0`, `NaN` and `__proto__` keys need no bridge, unlike 011's engine.

`App.svelte`'s `QUERY_LANGUAGES` gets the language between JMESPath and JSONPath (Goessner). For
the large-file rule (UNK-065 ★), the list the dialog gets is computed when Transform opens from the
document text's UTF-8 length, the same check 011 T6 adds for JavaScript and Lodash: one set of
"not above the threshold" language ids, so whichever of 011 T6 and 014 T4 lands second only adds
ids to it.

Write-back needs no code: the library hands Transform's array to the paths that exist (011 Q5).

## Constraints / invariants
- No change to any CSP and no new message type or protocol bump: queries never leave the webview.
- Plain ES2020 in the webview and core, no Node API (spec 013's web build and spec 020's Chrome
  app reuse it unchanged).
- `json-p3` pinned at exactly 2.3.2; an upgrade is its own PR that re-runs criteria 1–4 and 10.
- The CTS is vendored as data (`tests/query/jsonpath-cts/cts.json` with its `LICENSE` and the
  commit in a `SOURCE` file), never fetched in a test; `.prettierignore` already covers
  `tests/query/`.
- The corpus's `expected.json5` and `error.json` are written by hand from P1–P7 (AGENTS rule 5's
  spirit), never produced by the code under test.
- JSONPath (Goessner) is not changed.
- `offline-allowlist.txt` gets exactly one entry (the RFC link), named by the Reviewer.
- No overwrite without snapshot/backup (D4): all work in branches; Transform is one undoable edit.

## Steps (each with a gate)
| Step | Goal | Evidence to produce | Gate |
|---|---|---|---|
| A | Contract | vendored CTS, corpus, coverage tags | criteria 2 (expected files), 3; Reviewer checks every case against P1–P7 |
| B | Language in app-shell | `jsonpath-rfc9535.ts`, CTS and corpus runners, property suite, license | criteria 1, 2, 4, 11 |
| C | Dialog | language list, web tests | criteria 5, 6, 9 |
| D | VS Code and size | e2e write-back, large-file rule, bench | criteria 7, 8, 10 |

## Risks and mitigations
| Risk | Mitigation |
|---|---|
| R1 json-p3 differs from the CTS on a case added after commit `9d1a415` | the CTS is pinned; a newer suite is its own PR with the upgrade |
| R2 `..` is slower than Goessner (4.9 s vs 1.4 s at 50 MiB in the sandbox) and the preview runs on every typing pause | above 5 MiB not offered (UNK-065 ★); criterion 10 measures 5 MiB on CI and sends anything over 1 s to the owner |
| R3 A catastrophic regex in `match`/`search` stalls the page | same exposure as JSONQuery's `regex` today (P5); no limit can stop a native `RegExp`; recorded in "Where we differ" of the README (spec 005) |
| R4 The library's wizard text changes in a library upgrade and stops being RFC 9535 | the coverage test checks each wizard case's text against `createQuery` (as 011 does), and the CTS-backed engine parses it; a library upgrade re-runs both |
| R5 Webview stack depth differs from Node's, so 1,000 levels overflow in Chromium | P6 maps the overflow to the same message; the `deep` case uses 60 levels and `too-deep` 100,000, both far from the edge |
| R6 Users confuse the two JSONPath entries | both names say which JSONPath they are; each description says so and links its own reference |

## Definition of Done
1. Criteria 1–11 pass in CI. 2. UNK-065 resolved before T4.
