# Spike 015 T1: lossless big numbers in the editor webview (plan 015 R1, R2)

> **Result:** vanilla-jsoneditor 3.13.0 works with lossless-json `LosslessNumber` data for
> rendering, inline edit, paste, copy and search with no change to the library. Two things need
> T4's own code: the library's sorts (it orders big numbers wrongly, and both of its sorts throw on
> an overflowing or underflowing number such as `1e400`), and the library query languages (JSONQuery
> and JMESPath round big numbers; JSONPath sees them unrounded and throws on `1e400` in a filter).
>
> - **R1 (webview parse cost): met, with a changed pre-scan.** The plan's pre-scan regex matches the
>   bench document's padding (a run of dots), so that document would take the slow path. A scan
>   held to number-token shapes, `/\d(?:\.?\d){15}|\d[eE][+-]?\d{3}/`, finds no candidate there and
>   costs 0.30× `JSON.parse`. With it, the webview parser takes **1.04×** `JSON.parse` on the 5 MiB
>   document without big numbers (criterion 11 bound: 2×) and **3.43×** on the 5 MiB big-id
>   document (bound: 5×). The source-reading reviver (the plan's fallback) is slower than
>   lossless-json (4.20× against 3.53× on the big-id document), so T4 does not use it.
> - **R2 (library behaviour): the library needs no fork.** Its sort must be replaced by B3's sort,
>   and the big numbers it sees must have a `valueOf` that never throws (section 4). Every other
>   check passed as the spec expects.

## 1. What the task asks, and how this spike reads it

From `spec/015-lossless-numbers/tasks.md` T1: `vanilla-jsoneditor` 3.13.0 in the dev host with a
lossless parser over `tests/e2e/fixtures/big-numbers/input.json`. Check that the tree and table
render, inline edit and paste of a 21-digit value, copy, search, the sort dialog through
`onSortModal` and the table header sort, and JSONQuery, JMESPath and JSONPath on a rounded copy.
Measure the webview parser costs at 5 and 50 MiB: the pre-scan as a regex and as a char loop, core
parse, and lossless-json parse. Gate: REPORT answers R1 and R2 with measured numbers, and the
fixture is committed.

How it is read here:

- **The dev host.** VS Code 1.141.0 (Electron 43.7.7, Chrome 150), started by
  `@vscode/test-electron` under xvfb with `--disable-gpu` and a fresh profile. The spike extension
  opens each document in a custom text editor. Its webview gets 003 T4's options and the HTML from
  the real `renderWebviewHtml` (`packages/vscode-extension/src/webviewHtml.ts`), with 003's
  policy unchanged. No CSP violation was recorded (`results/vscode-1.141.0.json` `page`,
  `probesPage`).
- **The page.** `dist/page.js` is built the way the extension builds its webview script: one
  classic minified esbuild IIFE for `chrome128`. The library's injected CSS goes to `page.css`
  through app-shell's `extractInjectedCss`. It mounts the library with `createJSONEditor`, using
  `parser` and `validationParser` set to the spike parser (`src/parser.ts` `spikeParser`). That
  parser runs the token pre-scan, then `JSON.parse` when nothing is found. Otherwise it runs
  lossless-json 4.3.1 `parse` with a number parser that wraps only big numbers: `isSafeNumber`
  false, checked only for tokens longer than 15 characters or with an exponent, as plan §Approach
  says core does. Its `stringify` is lossless-json's.
- **Driving the library.** Each probe acts on the library's own DOM, as a user would. The probes
  double-click a value, type into the field and press Enter. They dispatch a `paste` event with a
  `DataTransfer` on the library's hidden input, and press Ctrl+C and Ctrl+F there. They use the
  selection's context menu → Sort, then the dialog's Sort button, and they click a table column
  header. The library sees no difference from a person, because it reads these events through its
  own handlers. Copy is checked twice: the page records what the library passes to
  `navigator.clipboard.writeText`, and the test reads VS Code's system clipboard
  (`vscode.env.clipboard.readText()`) afterwards.
- **Queries.** Each language's `executeQuery` runs twice. The first run uses the editor's data and
  the spike parser, which is the path the Transform dialog takes. The second run uses B7's input,
  a copy with each big number replaced by its nearest number.
- **Bench.** The page runs each method on the same text, and VS Code hands the text over through
  `document.getText()`. The texts are bench/generate.mjs's JSON document (criterion 11's "json
  document without big numbers") and the same records with 19-digit ids (`fixture.mjs`
  `bigIdText`, every id past 2^53). Each text is exactly 5 MiB or 50 MiB. The 5 MiB texts get a
  median of 9 runs and the 50 MiB texts a median of 3. Each method's result is checked on its
  first run (the scan's verdict, or the count of big numbers in the data), so a method that reads
  the text wrongly cannot look fast. Node 22.22.0 runs the same bench for reference.

## 2. What was measured

Code: this folder, a dev-only workspace package (`chr-json-editor-spike-lossless-numbers`).
Nothing in it ships.

| File | Role |
|---|---|
| `src/parser.ts` | Pre-scans (plan regex, token regex, char loop), the number parser, the spike parser, the reviver parser, `NearestValueNumber` |
| `src/page.ts` | The library probes and the page side of the bench |
| `src/bench.ts` | The bench methods (shared by the page and Node) |
| `src/extension.ts`, `suite.cjs`, `run.mjs` | The custom editor, the in-VS Code test, the runner |
| `fixture.mjs` | The bench texts |
| `tables.mjs` | Prints section 3's tables from `results/` |
| `results/vscode-1.141.0.json`, `results/node.json` | The raw results of the run this report reads |

Run: `pnpm --filter @chr-json-editor/core build`, then
`VSCODE_EXECUTABLE_PATH=<code> xvfb-run -a pnpm --filter chr-json-editor-spike-lossless-numbers spike`
(sandbox, 2026-10-12, base `72e706d`). Bench texts (sha256): plain 5 MiB `045b61bc…`, big-id 5 MiB
`7115ae7a…` (20,496 big ids), plain 50 MiB `7ba53f05…`, big-id 50 MiB `82987b2a…` (204,170 big ids).

## 3. R1: parser costs

Each cell: median (min–max) in ms · **ratio to `JSON.parse` of the same text in the same run** ·
what the method returned (scan verdict, or big numbers in the data; core's parsers return 0 because
core has no B1 until T2).

#### VS Code 1.141.0 webview (the numbers R1 is about)

| Method | plain-5mib | big-id-5mib | plain-50mib | big-id-50mib |
|---|---|---|---|---|
| JSON.parse | 23.4 (17.1–37.2) · 0 | 25.4 (15.2–31.1) · 0 | 261.3 (259.6–277.8) · 0 | 294.1 (249–382.5) · 0 |
| scan: plan regex | 0.1 (0.1–0.2) · **0.00×** · true | 0 (0–0.2) · **0.00×** · true | 0.2 (0.1–0.2) · **0.00×** · true | 0 (0–0.1) · **0.00×** · true |
| scan: token regex | 7 (5.8–9) · **0.30×** · false | 0 (0–0.2) · **0.00×** · true | 91.4 (73.3–106.6) · **0.35×** · false | 0 (0–0.2) · **0.00×** · true |
| scan: char loop | 11.9 (11.7–16.3) · **0.51×** · false | 0 (0–0.1) · **0.00×** · true | 169.8 (156.8–223.6) · **0.65×** · false | 0 (0–0.1) · **0.00×** · true |
| spike parser (token scan + route) | 24.3 (21.9–33.9) · **1.04×** · 0 | 87 (74.5–120.5) · **3.43×** · 20496 | 398.8 (395.1–405.5) · **1.53×** · 0 | 1242.8 (676.9–1363.4) · **4.23×** · 204170 |
| lossless-json parse, big only | 84 (66.1–109) · **3.59×** · 0 | 89.6 (80.5–103.5) · **3.53×** · 20496 | 960.4 (941.3–1010.2) · **3.68×** · 0 | 818.6 (807–1022.4) · **2.78×** · 204170 |
| lossless-json parse, all numbers | 88.6 (70.6–104.2) · **3.79×** · 43452 | 91.1 (76.2–127.8) · **3.59×** · 40992 | 1241 (1225.8–1247.4) · **4.75×** · 430976 | 905.2 (775.1–937.6) · **3.08×** · 408340 |
| JSON.parse + source reviver | 134.6 (88.1–178) · **5.75×** · 0 | 106.6 (91.4–170.3) · **4.20×** · 20496 | 1497.1 (1297.8–1765.6) · **5.73×** · 0 | 1243.2 (1065.7–1318.6) · **4.23×** · 204170 |
| core parseData(json) | 14.8 (14–30.9) · **0.63×** · 0 | 19.7 (15.3–30.6) · **0.78×** · 0 | 287.8 (189.4–304.5) · **1.10×** · 0 | 178.7 (173.4–185.9) · **0.61×** · 0 |
| core getAdapter(json).parse | 562 (458.4–1036.7) · **24.02×** · 0 | 578.1 (489.9–964) · **22.76×** · 0 | skipped (full parse of 50 MiB, memory) | skipped (full parse of 50 MiB, memory) |
| JSON.stringify (data) | 22.9 (8.3–39.1) · **0.98×** · 3330990 chars | 44.5 (32.8–51.8) · **1.75×** · 4177086 chars | 103.2 (94.2–109.3) · **0.39×** · 33465854 chars | 249.1 (228.4–270.2) · **0.85×** · 41811958 chars |
| lossless-json stringify (data) | 64.4 (58.5–103.3) · **2.75×** · 3330990 chars | 51.6 (37.1–160.3) · **2.03×** · 3439230 chars | 1007.4 (806.7–1025.3) · **3.86×** · 33465854 chars | 1021.1 (850.4–1426.2) · **3.47×** · 34461838 chars |

#### Node 22.22.0 (reference)

| Method | plain-5mib | big-id-5mib | plain-50mib | big-id-50mib |
|---|---|---|---|---|
| JSON.parse | 32.1 (25.9–42.8) · 0 | 28 (21.8–40.4) · 0 | 246.7 (245–643.9) · 0 | 606.9 (565.1–630.7) · 0 |
| scan: plan regex | 0.1 (0.1–0.3) · **0.00×** · true | 0 (0–0) · **0.00×** · true | 0.1 (0.1–0.1) · **0.00×** · true | 0 (0–0) · **0.00×** · true |
| scan: token regex | 13.8 (13.5–14) · **0.43×** · false | 0 (0–0) · **0.00×** · true | 113.8 (113.3–115.5) · **0.46×** · false | 0 (0–0) · **0.00×** · true |
| scan: char loop | 31 (30.8–33.5) · **0.97×** · false | 0 (0–0) · **0.00×** · true | 199.3 (163–201.6) · **0.81×** · false | 0 (0–0) · **0.00×** · true |
| spike parser (token scan + route) | 51.4 (44.4–75.2) · **1.60×** · 0 | 121.7 (94.6–159.2) · **4.35×** · 20496 | 384.5 (381.8–395.6) · **1.56×** · 0 | 1854.8 (1653.6–1907.1) · **3.06×** · 204170 |
| lossless-json parse, big only | 154 (91.6–163) · **4.80×** · 0 | 110.6 (95.8–172.9) · **3.95×** · 20496 | 1255.6 (1245.3–1309.5) · **5.09×** · 0 | 1655.7 (1600.9–2222.1) · **2.73×** · 204170 |
| lossless-json parse, all numbers | 115.9 (91.9–162) · **3.61×** · 43452 | 148.2 (97.3–164.1) · **5.29×** · 40992 | 1462.9 (1118.1–1769.3) · **5.93×** · 430976 | 1619.4 (1419.1–1622.5) · **2.67×** · 408340 |
| JSON.parse + source reviver | 199.8 (152.5–290.1) · **6.22×** · 0 | 208.8 (167.7–269.6) · **7.46×** · 20496 | 2394.3 (2203.1–2580.6) · **9.71×** · 0 | 2785.8 (2132.1–2874.1) · **4.59×** · 204170 |
| core parseData(json) | 28.2 (21.3–39.5) · **0.88×** · 0 | 31.7 (26.2–47.1) · **1.13×** · 0 | 355.4 (348.6–427.3) · **1.44×** · 0 | 307.6 (276.3–369.6) · **0.51×** · 0 |
| core getAdapter(json).parse | 932.1 (758.3–1826.3) · **29.04×** · 0 | 835.8 (671.7–928.5) · **29.85×** · 0 | skipped (full parse of 50 MiB, memory) | skipped (full parse of 50 MiB, memory) |
| JSON.stringify (data) | 17.8 (13.9–29.6) · **0.55×** · 3330990 chars | 28.5 (23.5–45) · **1.02×** · 4177086 chars | 246.3 (186.4–255.7) · **1.00×** · 33465854 chars | 411.1 (257.6–651.6) · **0.68×** · 41811958 chars |
| lossless-json stringify (data) | 110.7 (106.8–149.9) · **3.45×** · 3330990 chars | 179.2 (132.1–324.5) · **6.40×** · 3439230 chars | 1734.9 (1574.8–2300.4) · **7.03×** · 33465854 chars | 1653.7 (1507.1–1723.1) · **2.72×** · 34461838 chars |

What these say for R1:

1. **The plan's pre-scan regex cannot be used as written.** `/[\d.]{16}|[eE][+-]?\d{3}/` answers
   `true` on the plain bench document, because bench/generate.mjs pads the last record's note
   with dots. That document would then take the lossless path at about 3.6× instead of 1.04×,
   which misses criterion 11's 2×. Its second alternative also matches words: `"charlie-123"`
   holds `e-123`. The token regex
   `/\d(?:\.?\d){15}|\d[eE][+-]?\d{3}/` (`src/parser.ts` `TOKEN_SCAN`) fixes both problems. A big
   number has 16 or more digits with at most one dot between any two of them, or an exponent of 3
   or more digits right after a digit, so every big number still matches. Strings can still cause
   false positives, which only cost the slower path.
2. **Regex, not char loop.** The token regex costs 0.30–0.35× `JSON.parse` in the webview and
   0.43–0.46× in Node. The char loop (`scanLoop`, same test) costs 0.51–0.65× in the webview and
   0.81–0.97× in Node.
3. **Plain JSON stays within 2×.** The spike parser takes 1.04× at 5 MiB in the webview, under
   criterion 11's 2×. At 50 MiB it takes 1.53×, which no criterion bounds. In Node it takes
   1.56–1.60×.
4. **Big ids stay within 5×, but the margin is thin.** The spike parser takes 3.43× at 5 MiB in the
   webview, under criterion 11's 5×, and 4.23× at 50 MiB. An earlier webview run the same day (5 runs
   per 5 MiB text, results not committed) measured 4.95× at 5 MiB, and Node measures 4.35×. So the bound
   holds, but noise can come within 1.1× of it. T4's bench should report the median of 3 runs, as
   criterion 11 says, and if it misses, T4 records an UNKNOWN. The path for flagged texts is
   lossless-json's own parser, about 3.5× `JSON.parse` whether it wraps big numbers only or every
   number. The scan adds nothing there, because it stops at the first id.
5. **No reviver.** `JSON.parse` with a source-reading reviver works in VS Code 1.141's webview
   (`reviverHasSource: true`), but it costs 4.2–5.8× and is slower than lossless-json on every
   text. Plan R1's fallback is therefore not needed.
6. **Core parse is not a webview option.** Core's full `getAdapter('json').parse` costs 23–30×
   `JSON.parse` (each run on a fresh text, because core caches by text). `parseData` is
   `JSON.parse` for strict JSON today, so its time shows only what core's data-only path costs
   before T2 adds B1.
7. **Stringify.** lossless-json's `stringify`, which the library uses for copy, for text mode and
   for the JSONQuery and JMESPath copies, costs 2.0–3.9× `JSON.stringify` in the webview. That is
   about 50–65 ms at 5 MiB, the size of document text mode handles.

## 4. R2: the library with `LosslessNumber` data

All results below come from `results/vscode-1.141.0.json` `probes`. The fixture is
`tests/e2e/fixtures/big-numbers/input.json`. It holds 13 big-number tokens (`a`–`f`, the `ids`
array in criterion 3's order, and `records[].id`) and plain numbers that must stay plain (`4.0`,
`9007199254740991`, `0.1`, `1e2`, `-0`, `1.5e300`).

| Check | Result | Evidence |
|---|---|---|
| Parse | The 13 big tokens become `LosslessNumber`s with their exact text. Plain numbers stay `number`s (`4.0` → `4`). `stringify` writes the digits back. | probe `parse`: `bigNumbersInData` equals `bigNumbersInText` |
| Type | `valueType(LosslessNumber)` is `"number"`, so values get the `jse-number` class and render as numbers | probe `parse` `valueTypeOfBig`; `tree render` `notNumberClass: []`; library `typeUtils.ts:109-147` |
| Tree render | Every big number shows its decimal text: `12345678901234567890`, `0.1000000000000000000001`, `1e400`, `1E-400`, `9007199254740993` and the rest. `4.0` shows `4`, as the spec's §Where we differ says. | probe `tree render`: `missing: []` |
| Table render | Same, for `ids` (one `values` column) and `records` (`id` column) | probe `table render`: `missing: []` |
| Inline edit | Typing `123456789012345678901` into `/a` and pressing Enter gives the patch `replace /a` with a `LosslessNumber("123456789012345678901")`, and the cell shows those digits. The library runs typed text through `parser.parse` (`stringConvert`, `typeUtils.ts:162-186`). | probe `inline edit` |
| Paste | Pasting `123456789012345678901` over `/b` gives a `LosslessNumber`. Pasting `[123456789012345678901, 1, 0.1000000000000000000001]` over `/plain` gives two `LosslessNumber`s and a `1`. | probe `paste` |
| Copy | Ctrl+C on `/a` writes `12345678901234567890`. On `/ids` it writes the array with every digit (`1e400`, `-12345678901234567890`, …). VS Code's system clipboard holds the same text afterwards. | probe `copy`; `clipboard` |
| Search | `12345678901234567890` finds 4 matches: `a`, `ids[5]`, `records[2].id`, and inside `-12345678901234567890`. `0.1000000000000000000001` and `1e400` find 2 each. `4.0` finds nothing, because it shows as `4`. | probe `search` |
| Sort dialog: hook | `onSortModal` is **not** a public prop. It is missing from `JSONEditorPropsOptional` (`index.d.ts:483-523`) and is a private function of `JSONEditor.svelte:503`. A prop passed to `createJSONEditor` was called 0 times. The plan's hook does not exist. | probe `sort dialog` `onSortModalPropCalls: 0` |
| Sort dialog: order | The dialog (selection context menu → Sort) on `ids` without `1e400` gives `[0.1, 5, -…890, 0.1000…1, …891, …890]`, which is wrong in two ways. Plain numbers come before every big number, because the comparator orders by `typeof` first (`sort.ts:126-155`). Big numbers are then compared by `natural-compare-lite` on `valueOf() + ''`. Its digit runs are compared as floats (`+str.slice`), so `…891` and `…890` tie and keep file order. On `records` by `id` the result is `[7, 9007199254740993, …891, …890]`. | probe `sort dialog` |
| Sort dialog: `1e400` | On the fixture's `ids`, which holds `1e400`, the dialog shows "Error: Cannot safely convert to number: the value '1e400' would overflow and become Infinity". No change is made. `LosslessNumber.valueOf()` throws, and natural-compare-lite's `a += ""` calls it. | probe `sort dialog` `ids` |
| Table header sort | The same order as the dialog. On `ids` with `1e400` it raises an uncaught error ("Cannot safely convert…") and makes no change. | probe `table header sort` |
| Sort, `valueOf` never throws | With `NearestValueNumber`, a `LosslessNumber` subclass whose `valueOf` returns `Number(value)` on overflow or underflow (`src/parser.ts`), both sorts complete on the fixture's `ids` and hand over a change (`replace /ids`, or `replace` of the table's root). The order is still the library's: `[0.1, 5, -…890, 0.1000…1, …891, …890, 1e400]`. | probe `sort dialog` and `table header sort`, case `ids, valueOf never throws` |
| What the app can read when a sort lands | Dialog: while `onChange` runs, the dialog is still open. Its `input.jse-path` holds the array path (`ids`, `records`). The property and direction selects hold their values in hidden inputs (`{"value":["id"],"label":"id"}`, `{"value":1,…}`). Header: the sorted column icon (`.jse-column-sort-icon`, title "Currently sorted in ascending order") is not yet in the DOM during `onChange` but is there right after. | probe `sort dialog` `dialogWhenChangeArrived`; `table header sort` `sortedHeaderAfter` |
| JSONQuery, JMESPath | Both run on `JSON.parse(parser.stringify(json))` (`jsonQueryLanguage.ts:59-67`, `jmespathQueryLanguage.ts:101-111`), so with the lossless parser they already get B7's rounded copy. Results match the rounded-copy run exactly: `filter`, `sort`, `max`, `max_by` return nearest numbers (`12345678901234567000`). Nothing throws. | probe `queries` |
| JSONPath (Goessner) | It runs on the data itself (`jsonpathQueryLanguage.ts:51-54`), so results keep `LosslessNumber`s (`$.ids[*]` returns every big number exact). A filter compares through `valueOf`: `$.records[?(@.id > 5)]` works (BigInt > number), but `$.ids[?(@ > 5)]` throws "Cannot safely convert to number: the value '1e400' would overflow…". On the rounded copy it gives nearest numbers, with `Infinity` for `1e400`. | probe `queries` |

What these say for R2 and for T4 (findings that become T4 cases, plan R2):

1. **Rendering, inline edit, paste, copy and search need nothing.** They work through the library's
   `parser` prop and `String(value)`. T4's fixture checks in criterion 4 should pass with
   `parser.ts` alone.
2. **Sort needs our comparator, and there is no hook for it.** `onSortModal` cannot be set from
   outside. The plan's fallback, re-sorting the library's result with B3 before `dataChange`, works
   only if the library produces a result. It does not when a sorted value is an overflowing or
   underflowing big number (`1e400`, `1E-400`, the spec's own examples). T4 has two routes that
   need no library change:
   - (a) The webview's big-number class overrides `valueOf` so it never throws, as
     `NearestValueNumber` does. The library's sort then always hands over a change, and the app
     re-sorts it with B3's comparator, reading the sort path and direction as shown above. This
     keeps ADR-014's "a lossless-json `LosslessNumber`" (it is a subclass, `isLosslessNumber` true,
     written by `stringify` as its digits). Only the webview's `valueOf` differs from lossless-json,
     and only for values the library would otherwise throw on. B8's QuickJS class is separate and
     keeps lossless-json's throwing `valueOf`.
   - (b) Capture-phase click handlers on the dialog's Sort button and on `.jse-column-header` run
     B3's sort themselves and stop the library's handler. The app already intercepts clicks this
     way for repair (`App.svelte` `interceptRepair`). The cost is that the table's sorted-column
     icon is not set.

   The spike checked route (a) end to end, up to the library's change. Route (b) is only read
   from the code. Either way, T4's e2e for criterion 4 sorts the fixture's `ids`, which includes
   `1e400`.
3. **Sorting `ids` by table header in T4 needs the nested editor.** The table header sort exists
   only for a root array (`TableMode.svelte:364-379`, `rootPath = []`). On the fixture, whose root
   is an object, table mode shows its welcome screen with "Edit" (a nested editor modal) or
   "Extract" for `ids`. T4's e2e has to sort through that modal, or through a fixture variant whose
   root is the array.
4. **Queries.** JSONQuery and JMESPath already run on B7's rounded copy, so T5 needs only B7's
   restore step on their results. JSONPath (Goessner) does not get a rounded copy: T5's wrapper must
   pass it one, or `@ > 5` throws on `1e400`.
5. **Validation (not probed).** `App.svelte` passes `parserFor(...)` as `validationParser`, so with
   T4's parser the library's validator would receive `LosslessNumber`s. B6 wants nearest numbers.
   T4 should give `validationParser` a nearest-number reading, for example `JSON.parse` of the
   lossless `stringify`.

## 5. Off the critical path

- JMESPath's `sort()` orders numbers as strings in the library's `jmespath` 0.16.0, on `main` today
  and with or without big numbers. In this run `sort(records[*].id)` returned
  `[1.2e19, 1.2e19, 7, 9.0e15]`. A Node check gave `jmespath.search({a:[30,7,100]}, 'sort(a)')` →
  `[100, 30, 7]`. That is a library bug outside spec 015, a possible follow-up for the query
  specs.
- The spike measured the pre-scan only for strict JSON. JSONC and JSON5 go to core's parser
  whatever the scan says (`packages/app-shell/src/parser.ts`), so B1 in core (T2) covers them.
