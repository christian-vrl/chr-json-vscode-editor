# Spike 011 T1: QuickJS in the editor webview (spec 011 HYPOTHESIS, plan R1, R2, R3, R7)

> **Result:** the spec's CSP HYPOTHESIS holds on VS Code 1.141.0. With `'wasm-unsafe-eval'` added
> to `script-src` of the policy `renderWebviewHtml` writes, QuickJS compiles and runs in a custom
> editor webview with **no CSP violation**, and without it compilation is refused (so the source
> is needed and is the only change). Every sealed probe, limit and built-in case of criteria 4 and
> 5 behaves as the spec says, the bench queries give the reference's exact results well inside the
> 5-second limit, and typing into the library's real Transform dialog on a 5.2 MB document never
> blocks the page for 1 second.
>
> - **R7 (loading route): (a), a dynamic `import()`** of the engine as a separate ES module works
>   under the nonce-only policy, as do (b) and (c). By plan R7 ("T4 uses the first that works"),
>   T4 loads the engine with `import()`.
> - **R2 (preview while typing): no change.** The library already debounces the preview by 300 ms;
>   the longest gap between two key handlings was 679 ms (Lodash, a key every 450 ms), under plan
>   R2's 1-second trigger, so T4 adds no debounce and the spec does not change.

## 1. What the task asks, and how this spike reads it

From `spec/011-js-queries/tasks.md` T1: a custom editor webview rendered by `renderWebviewHtml`
with `'wasm-unsafe-eval'` added to `script-src`, loading the QuickJS single-file browser module from
a nonce'd script; run the sealed probes, the 5-second loop, the allocation loop at 256 MiB,
criterion 5's built-in cases and the 1 and 5 MiB bench queries in the webview on VS Code 1.141.0;
check plan R7 and R2; record CSP violations, the loading route, the stop times, the typing
measurements and the speeds. Gate: the HYPOTHESIS confirmed with results committed.

How it is read here:

- **The page.** `src/extension.ts` calls the real `renderWebviewHtml` and `contentSecurityPolicy`
  from `packages/vscode-extension/src/webviewHtml.ts` (imported, not copied) and changes exactly one
  thing in the result: `script-src 'nonce-…'` becomes `script-src 'nonce-…' 'wasm-unsafe-eval'`
  (it throws if the policy does not have that shape). Webview options are 003 T4's
  (`enableScripts`, `localResourceRoots` = the spike's `dist/` only). Every page's policy, read back
  from its `<meta>`, is checked by `suite.cjs` `criterion9Failures`: `assertCriterion6`'s rules
  with that one source allowed (the variant T5 adds).
- **The bundle.** `dist/page.js` is built the way `packages/vscode-extension/esbuild.mjs` builds
  `webview.js`: one classic, minified esbuild IIFE for `chrome128`, loaded with the nonce. It holds
  vanilla-jsoneditor 3.13.0 with its injected CSS moved into `dist/page.css` by app-shell's own
  `extractInjectedCss` and `styleModPageNonce` (UNK-029), so the library adds no `<style>` the
  policy would block. The engine is quickjs-emscripten-core 0.32.0 with
  `@jitl/quickjs-singlefile-browser-release-sync` 0.32.0 (WebAssembly base64 inside the JS);
  Lodash 4.18.1's `lodash.min.js` is a string in the bundle, evaluated only inside the engine.
- **The engine.** `src/engine.ts` is the smallest `runQuery` that answers the questions: one
  runtime and context per run, `memoryLimitBytes` 256 MiB, `shouldInterruptAfterDeadline` at 5 s,
  the library's own wrapper (`"use strict"`, the `query` function check) and Lodash check, data in
  and out as JSON text, the spec's two limit messages. The full Q2 bridge (`-0`, `NaN`, `__proto__`,
  BigInt, cycles) is T3's, not this spike's.
- **The real dialog (R2).** The typing test mounts the library with JSONQuery plus JavaScript and
  Lodash (`{ ...javascriptQueryLanguage, executeQuery }` on this engine, as plan §Approach says T4
  will), opens Transform with `editor.transform()`, and types into its query box one character at
  a time (an `input` event per key, as the library's `on:input` handler reads it).
- **"Responds" after a limit (criterion 5).** Measured here as a message round trip from the
  extension host to the page right after each probe; T4's web test checks a real click.

## 2. What was measured

Code: this folder (dev-only workspace package `chr-json-editor-spike-query-engine`; nothing in it
ships or is bundled into the extension).

| File | Role |
|---|---|
| `src/engine.ts` | The spike's `runQuery` (§1), with a per-part timer for the bench. |
| `src/probes.ts` | The sealed probes, the limit and built-in cases, a locale probe, the bench queries. |
| `src/page.ts` | Editor page, engine inside the bundle (route c): probes, bench, typing in the real dialog. |
| `src/loader.ts` | Page without the engine, for routes (a) and (b). |
| `src/extension.ts` | Custom editor; the page's HTML from `renderWebviewHtml` plus `'wasm-unsafe-eval'`. |
| `suite.cjs`, `run.mjs` | Opens the fixtures once per measurement inside VS Code; writes `results/vscode-<version>.json`. |
| `fixture.mjs` | Deterministic bench documents (seeded PRNG). |
| `src/node-reference.ts` | The reference: the library's own `executeQuery` of each bench query in Node. |
| `src/preflight.ts` | Every probe in Node first, so one that never stops is found before it hangs a webview. |

Fixtures: arrays of records `{id, name, active, total, tags, address: {city, zip}}`, 2-space
indent.

| Fixture | Bytes (UTF-8) | Items | SHA-256 |
|---|---|---|---|
| `1mib` | 1,040,073 | 4,800 | `3c3bb42f7eddcbf578aea7c9aeff2e3c42c3fcc9ac66a838fbaf9fbcbfca8258` |
| `5mib` | 5,200,159 (≤ 5,242,880, so UNK-049 offers both languages) | 23,884 | `408a93fee01bc6e1c40b4f946f87df6c6bd47aead2f68c8a479bf707a96673ba` |

Environment: Linux x64 under `xvfb-run`; VS Code **1.141.0** from the packages.microsoft.com
`.deb` (Electron 43.7.7, Chromium 150.0.7871.250, Node 24.21.0). Reference: Node 22.22.0, same
machine. Raw data: `results/vscode-1.141.0.json`.

## 3. Results

### CSP and loading (R1, R7, criterion 9)

| Policy | Route | Loads | Time to a compiled engine | CSP violations | Criterion 9 check |
|---|---|---|---|---|---|
| nonce + `'wasm-unsafe-eval'` | (a) `import(asWebviewUri('engine.mjs'))` from the nonce'd page script | **yes** | 85.5 ms | none | passes |
| nonce + `'wasm-unsafe-eval'` | (b) second `<script nonce>` added by the page | yes | 101.7 ms | none | passes |
| nonce + `'wasm-unsafe-eval'` | (c) engine inside `page.js` | yes | 19.8 ms (compile only; parsing is part of the page's load) | none | passes |
| 003 T4 unchanged (control) | (c) | **no** | — | `script-src` blocked `wasm-eval` | (not applicable) |

The control's error, as the page caught it: `RuntimeError: Aborted(CompileError:
WebAssembly.instantiate(): Compiling or instantiating WebAssembly module violates the following
Content Security policy directive because 'unsafe-eval' is not an allowed source of script …
"script-src 'nonce-…'")`. So without the source nothing compiles, and with it nothing else in
the policy changes (the probes, bench and typing pages also report no violation and pass the
criterion 9 check).

Why (a) works (inference from the HTML standard, consistent with the result): a module fetched by
`import()` inherits the referencing script's fetch options, its nonce included, so `script-src
'nonce-…'` allows it although no element carries the nonce. Each route ran on its own fresh
webview, in the order (a), (b), (c).

**R7 decision: (a).** T4 builds the engine as its own ES module file next to `webview.js` and the
page imports it by its webview URI (the host can hand the URI to the page with the rest of
`init`). The main bundle does not grow: here `engine.mjs` is 947 KB minified (WebAssembly
base64 plus Lodash's source), while putting it inside the bundle (c) doubled the page script
(`page.js` 1.94 MB). Criterion 10's "compiled only when Transform first opens" holds by
construction, since nothing imports the module before then.

### Sealed (criterion 4)

| Probe | Result in the webview |
|---|---|
| `typeof` of `window`, `document`, `self`, `globalThis.fetch`, `XMLHttpRequest`, `WebSocket`, `importScripts`, `postMessage`, `acquireVsCodeApi`, `require`, `process`, `setTimeout`, `WebAssembly`, `Worker`, `navigator` | all `"undefined"`, in JavaScript and in Lodash (where `typeof _.chain` is `"function"`) |
| `eval('1 + 1')`, `Function('return typeof window')()`, `(0, eval)('typeof document')` | `2`, `"undefined"`, `"undefined"`: both exist inside the engine and see only its global object |
| The engine's global names | only ECMAScript built-ins: `AggregateError` … `WeakSet`, `eval`, `globalThis`, the URI functions, `escape`/`unescape`; no `console`, no timers, no modules (Q3) |
| `globalThis.leaked = 42`, then `typeof globalThis.leaked` in the next run | `"number"`, then `"undefined"` (Q4) |

No CSP violation during these runs and none for the rest of the page (`probesPage` in the results).
The network and DOM halves of criterion 4 are T4's web test.

### Limits and built-ins (criterion 5, plan R3)

Each probe on its own run; "after" is the host-to-page round trip right after the run ended, then
a trivial query (`data.length`) ran each time and returned 4800.

| Probe | Stopped after | Message | Engine's error | Criterion 5 bound | After |
|---|---|---|---|---|---|
| `while (true) {}` | 5,003.6 ms | stopped after 5 seconds | `InternalError: interrupted` | 6 s | 1.1 ms |
| `_.forEach([1], () => { while (true) {} })` (Lodash) | 5,005.1 ms | stopped after 5 seconds | interrupted | 6 s | 1.1 ms |
| keeps allocating `new Array(1e6).fill(n)` | **10,762.9 ms** | used more than 256 MiB | `InternalError: out of memory` | 15 s | 2.8 ms |
| keeps allocating small objects | 5,369.0 ms | used more than 256 MiB | out of memory | 15 s | 1.1 ms |
| `/^(a+)+$/.test('a'.repeat(32) + 'b')` | 5,003.4 ms | stopped after 5 seconds | interrupted | 15 s | 1.4 ms |
| `'x'.repeat(2 ** 28)` | 22.0 ms | used more than 256 MiB | out of memory | 15 s | 0.8 ms |
| `Array(3e7).fill('ab').join(',')` | 302.7 ms | used more than 256 MiB | out of memory | 15 s | 0.9 ms |
| `sort` with a comparator over 3 million numbers, repeated | 5,055.1 ms | stopped after 5 seconds | interrupted | 15 s | 6.2 ms |

All within the bounds. R3 shows up as measured in the sandbox check: the large-block allocation
loop stops on memory after 10.8 s, past the 5 s deadline, because the deadline is not checked
inside one large native fill; criterion 5's 15 s for memory covers it. The small-object loop
reached 256 MiB just after the deadline in this run (in the first run it was the deadline at
5.5 s), so it can end on either limit; criterion 5 expects the memory message, which the
large-block form gives reliably. The regex case shows QuickJS's regex engine polls the
interrupt handler.

### Speed (criterion 12)

Median of 5 runs, ms. The engine's time is one whole run as T3 will do it: a fresh runtime and
context, Lodash evaluated (Lodash only), `JSON.stringify` in the page + `JSON.parse` in the engine
("in"), the query, `JSON.stringify` in the engine + `JSON.parse` in the page ("out"). The
reference is the library's `executeQuery` on data already in memory, so it has no "in" or "out".

| Fixture | Query | Engine (min–max) | in / Lodash / query / out | Reference | Same result as reference |
|---|---|---|---|---|---|
| 1 MiB | filter-map (JavaScript) | 157.1 (92.6–203.4) | 114.8 / — / 11.9 / 26.4 | 0.8 | yes |
| 1 MiB | filter-orderBy-map (Lodash) | 154.5 (89.6–248.0) | 35.8 / 25.9 / 86.2 / 5.9 | 4.2 | yes |
| 5 MiB | filter-map (JavaScript) | **146.6** (137.9–198.7) | 121.9 / — / 7.1 / 17.6 | 3.0 | yes |
| 5 MiB | filter-orderBy-map (Lodash) | **557.2** (418.9–750.1) | 117.4 / 18.4 / 318.2 / 18.0 | 16.4 | yes |

"Same result" compares an FNV-1a hash and the length of the result's JSON text with the Node
reference's. The spec's HYPOTHESIS (5 MiB about 0.4 s JavaScript, 1.1 s Lodash) is met with
margin, and both are far under criterion 12's 2.5 s trigger. The 1 MiB JavaScript row is noisy
(an earlier run of the same build gave a 31.9 ms median): the "in" step varies with the page's
garbage collection; T5's bench on the CI runner is the number that counts. The query itself is
cheap; moving the data in is most of a JavaScript run.

### Preview while typing (plan R2)

The library's Transform dialog (vanilla-jsoneditor 3.13.0 `TransformModal.svelte`) runs the
preview through `debounce(previewTransform, DEBOUNCE_DELAY)` with `DEBOUNCE_DELAY = 300` ms
(`src/lib/constants.ts`), so a run starts only after typing pauses for 300 ms. On the 5 MiB
fixture, 40 characters typed one at a time after the anchor in the wizard's query
(`return data` + `.filter(item => item.total > 500).length` for JavaScript; `_.chain(data)` +
`.filter(i => i.total > 50).orderBy('id')` for Lodash):

| Language | One key every | Preview runs started | Longest run | Median run | Longest gap between key handlings | Final preview is the final query |
|---|---|---|---|---|---|---|
| JavaScript | 150 ms | 1 | 207 ms | 207 ms | 151 ms | yes (`11877`) |
| JavaScript | 300 ms | 13 | 288 ms | 210 ms | 589 ms | yes |
| JavaScript | 450 ms | 29 | 339 ms | 221 ms | 639 ms | yes |
| Lodash | 150 ms | 1 | 697 ms | 697 ms | 151 ms | yes (22,740 items) |
| Lodash | 300 ms | 9 | 613 ms | 275 ms | 621 ms | yes |
| Lodash | 450 ms | 26 | 968 ms | 247 ms | **679 ms** | yes |

Plan R2's trigger is "a run starts per keystroke **and** the gap exceeds 1 s". At a slow typist's
pace a run does start for most keys (26–29 of 40), but no key waited a second: the longest gap was
679 ms. **So T4 adds no debounce of its own and the spec does not change.** Most runs while typing
are short because the half-typed query is a syntax or type error; they still pay for moving 5 MB
into the engine first (§4).

### Locale (011 T2 finding, plan R4)

QuickJS has no `Intl` (`typeof Intl` is `"undefined"`), and its locale methods ignore locale:

| Expression | QuickJS (webview) | V8 (Node 22.22, en-US) |
|---|---|---|
| `words.sort((a, b) => a.localeCompare(b))` on `banana, Apple, cherry, apple, Ébano, eclair, Zebra, zebra, ä, b` | `Apple, Zebra, apple, b, banana, cherry, eclair, zebra, Ébano, ä` (code-unit order, the same as `sort()`) | `ä, apple, Apple, b, banana, cherry, Ébano, eclair, zebra, Zebra` |
| `'a'.localeCompare('B')` | `31` | `-1` |
| `(1234567.891).toLocaleString()` | `1234567.891` | `1,234,567.891` |
| `new Date(Date.UTC(2026, 9, 11)).toLocaleDateString()` | `10/11/2026` | `10/11/2026` |
| `'straße'.toLocaleUpperCase()` | `STRASSE` | `STRASSE` |

So a query that sorts with `localeCompare` (or Lodash's `_.sortBy` on strings, which compares with
`<`) differs from the library wherever case or accents decide the order. Recorded for T3 under
plan R4 (a corpus case tagged with this cause, documented in spec §Where we differ, spec changed
first); this spike decides nothing about it.

## 4. Consequences for later tasks (observations, not decisions)

- **T4 (R7):** load the engine with `import()` of its own ES module by webview URI (above). The
  dev host's page needs the same: its CSP mirrors the editor's (plan Phase D).
- **T3:** in this spike's order (data in, then the query text), every preview run pays for moving
  the data in, even when the text does not parse. Evaluating the query text first, then moving the
  data in, would make the half-typed previews nearly free. A choice for T3; nothing in the spec
  depends on it.
- **T3/T4:** the library shows a preview error as `String(err)`, so an error class named
  `QueryError` reads "QueryError: The query was stopped after 5 seconds."; the message criteria 5
  and 6 check is what follows. T4's web test sees the exact text.
- **T5:** `lodash.min.js` 4.18.1 contains one URL (`https://npms.io/search?q=ponyfill.`, spec
  evidence); bundled as a string, it will appear in `dist/` and needs a named
  `offline-allowlist.txt` entry or stripping (criterion 9). This spike's `dist/` is not scanned by
  `check:offline` (it scans `packages/*/dist`).
- **T4's limits test:** use the large-block allocation form for criterion 5's memory case; the
  small-object loop can end on either limit.

## 5. Reproduce

```sh
pnpm install
# Needs a display; VS Code from VSCODE_EXECUTABLE_PATH or downloaded by @vscode/test-electron.
VSCODE_EXECUTABLE_PATH=/path/to/code xvfb-run -a pnpm --filter chr-json-editor-spike-query-engine spike
```

The command rebuilds the spike, regenerates the fixtures (same SHA-256), runs the Node preflight
and reference, and overwrites `results/vscode-<version>.json`. Times vary by machine; the
loads / blocked / stopped outcomes, messages and result hashes should not.
