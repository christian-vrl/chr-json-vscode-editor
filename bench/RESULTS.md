# Core benchmark: parse and one edit per format (002 T8)

> Spec 002 criterion 7, spec 008 criterion 7, spec 010 criterion 11, spec 012 criterion 12, spec 011 criterion 12 and spec 014 criterion 10. Written by `bench/core/report.mjs` from one benchmark run; do not edit
> by hand. Re-run it (the `bench` workflow) whenever `packages/core/src/formats` or `packages/app-shell/src/query` changes speed.

## Run

- Where: GitHub Actions, [run 38440245350](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/38440245350); commit `cc0bd641baa21828748adff9e90554384cc0d2c9`.
- Machine: Linux x64 (`ubuntu24`), 4 × INTEL(R) XEON(R) PLATINUM 8573C, 16 GiB RAM.
- Node v22.23.3, `@chr-json-editor/core` built from that commit, called directly (no editor, no webview, no message passing). Each format and size runs in its own process (`--expose-gc`, heap collected before every timed call; `--max-old-space-size=6144`, Node's default heap limit on this machine: 4.0 GiB, see Memory).
- 3 runs per cell after a warm-up on a 256 KiB document; each cell is **median** (run 1, run 2, run 3), in milliseconds.

## Files

Each size is exactly N × 2^20 bytes (MiB, as in `bench/vscode-open.md`), ASCII only, one array of
records padded inside the last record. Built in memory by `bench/core/run.mjs`:

- **json:** `bench/generate.mjs`, the file 003 T11 opens in VS Code (pretty-printed, 2 spaces).
- **jsonc:** the same records with a `//` comment before each, a `/* */` comment inside each, a
  trailing comma in each nested object and after the last record.
- **json5:** as jsonc, plus unquoted keys, single-quoted strings, a hex field and trailing commas
  after every last member.
- **jsonl:** `bench/generate.mjs` `linesText`, the same records as JSON Lines: one
  `JSON.stringify(record)` per line, each ended by `\n`.

Records per file:

| Size | json | jsonc | json5 | jsonl |
|---|---|---|---|---|
| 1 MiB (1,048,576 B) | 4,372 | 4,323 | 4,305 | 6,897 |
| 10 MiB (10,485,760 B) | 43,361 | 42,702 | 42,530 | 68,086 |
| 50 MiB (52,428,800 B) | 215,488 | 211,612 | 210,767 | 336,787 |

## Results

`parse` is `getAdapter(format).parse(text)` (data, tree, style, diagnostics); `parseData` is
`parseData(format, text)` (the data alone, nothing cached; 008 T1). Each edit is one
`applyPatch(text, [op])` on the middle record `m`, returning the whole new text, on a text core
has not parsed yet (core keeps the parse of the last text per format, so this is the first edit
of a text nothing else parsed). The second table is the extension host's usual case: the text
was parsed already (format badge, schema validation, the previous edit).

- **replace:** `{ op: "replace", path: "/m/name", value: "edited" }`, one string.
- **add:** `{ op: "add", path: "/m/extra", value: { added: true } }`, a new key.
- **remove:** `{ op: "remove", path: "/m" }`, a whole record with its comments.
- **move:** `{ op: "move", from: "/m", path: "/-" }`, the record to the end; between its remove
  and its add, `move` shifts the tree and tokens it has rather than parsing again (UNK-014).

In jsonl, replace and add edit the one line of record `m` (L7), remove and move are whole-line
edits (L4, L6).

### json

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **105** (111, 104, 105) | **5** (5, 5, 5) | **77** (77, 83, 74) | **82** (80, 86, 82) | **81** (80, 81, 81) | **111** (102, 111, 114) |
| 10 MiB | **967** (1,152, 899, 967) | **51** (51, 49, 52) | **667** (667, 706, 648) | **675** (675, 725, 664) | **670** (670, 714, 667) | **1,131** (1,131, 1,156, 1,105) |
| 50 MiB | **7,221** (7,221, 7,381, 6,804) | **307** (304, 307, 313) | **5,377** (5,966, 5,257, 5,377) | **5,240** (5,172, 5,240, 5,342) | **5,943** (5,925, 6,035, 5,943) | **9,144** (9,128, 9,327, 9,144) |

After the text was parsed (json):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **29** (38, 27, 29) |
| 10 MiB | **0** (0, 0, 0) | **4** (4, 4, 4) | **0** (0, 0, 0) | **437** (442, 430, 437) |
| 50 MiB | **0** (0, 0, 0) | **15** (15, 15, 14) | **0** (0, 0, 0) | **2,305** (2,329, 2,305, 2,295) |

### jsonc

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **100** (106, 100, 99) | **39** (39, 20, 41) | **73** (72, 73, 76) | **76** (76, 73, 76) | **76** (76, 76, 78) | **112** (108, 112, 114) |
| 10 MiB | **834** (924, 831, 834) | **257** (259, 252, 257) | **585** (590, 585, 583) | **609** (617, 609, 604) | **609** (609, 609, 615) | **953** (953, 971, 937) |
| 50 MiB | **6,697** (7,125, 6,697, 5,948) | **1,223** (1,223, 1,201, 1,238) | **5,410** (5,556, 4,520, 5,410) | **5,426** (5,499, 4,719, 5,426) | **4,912** (5,621, 4,733, 4,912) | **7,433** (7,433, 8,018, 7,412) |

After the text was parsed (jsonc):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **38** (41, 35, 38) |
| 10 MiB | **0** (0, 0, 0) | **3** (3, 7, 3) | **0** (0, 0, 0) | **356** (373, 352, 356) |
| 50 MiB | **0** (0, 0, 0) | **14** (15, 14, 14) | **0** (0, 0, 0) | **1,534** (1,567, 1,534, 1,530) |

### json5

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **67** (88, 67, 56) | **24** (24, 23, 31) | **58** (58, 58, 58) | **61** (61, 58, 62) | **56** (59, 56, 53) | **95** (93, 95, 98) |
| 10 MiB | **499** (611, 497, 499) | **163** (159, 163, 166) | **498** (511, 497, 498) | **521** (512, 521, 525) | **523** (531, 512, 523) | **781** (792, 777, 781) |
| 50 MiB | **5,527** (5,933, 5,527, 4,983) | **811** (786, 811, 817) | **5,420** (4,990, 5,986, 5,420) | **5,115** (5,115, 5,040, 5,126) | **5,286** (5,008, 5,286, 5,535) | **7,901** (7,901, 8,186, 7,701) |

After the text was parsed (json5):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **40** (41, 37, 40) |
| 10 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **268** (279, 265, 268) |
| 50 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **1,671** (1,688, 1,671, 1,671) |

### jsonl

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **85** (88, 85, 84) | **7** (8, 7, 7) | **9** (10, 9, 9) | **9** (10, 9, 9) | **8** (9, 8, 8) | **9** (9, 9, 9) |
| 10 MiB | **550** (652, 550, 539) | **90** (92, 89, 90) | **90** (104, 90, 90) | **93** (103, 91, 93) | **96** (103, 92, 96) | **93** (102, 89, 93) |
| 50 MiB | **2,807** (3,370, 2,788, 2,807) | **448** (448, 440, 458) | **479** (591, 479, 474) | **482** (568, 477, 482) | **494** (594, 494, 493) | **520** (602, 503, 520) |

After the text was parsed (jsonl):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **2** (2, 2, 2) | **2** (2, 2, 2) | **2** (2, 2, 2) | **2** (2, 2, 2) |
| 10 MiB | **17** (15, 17, 17) | **17** (15, 17, 25) | **16** (15, 16, 16) | **21** (21, 20, 21) |
| 50 MiB | **98** (95, 98, 118) | **98** (98, 98, 95) | **97** (96, 97, 103) | **117** (117, 114, 117) |

## Memory

**Retained heap** is what one parse result (data, tree, tokens, style, diagnostics) keeps alive
after a full collection, so what a host holding the parsed document pays; **parseData heap** is
the same for `parseData`'s result (the data alone), measured first. **Max RSS** is the
peak resident memory of the measuring process over the whole cell (source text, every parse and
edit), in MiB. The heap ceiling is raised because with the GitHub runner's default (about 2 GiB)
the first run of this benchmark ran out of heap in the json 50 MiB cell
([run 37852960823](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/37852960823)).

| Size | json retained heap | json parseData heap | json max RSS | jsonc retained heap | jsonc parseData heap | jsonc max RSS | json5 retained heap | json5 parseData heap | json5 max RSS | jsonl retained heap | jsonl parseData heap | jsonl max RSS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 MiB | 31 | 1 | 250 | 30 | 2 | 244 | 26 | 2 | 223 | 21 | 2 | 157 |
| 10 MiB | 406 | 12 | 1,852 | 396 | 20 | 1,776 | 342 | 21 | 1,667 | 269 | 19 | 710 |
| 50 MiB | 2,061 | 58 | 5,826 | 2,007 | 100 | 5,803 | 1,732 | 105 | 5,471 | 1,353 | 90 | 3,117 |

## Spec 008 criterion 7: parseData against parse

For jsonc and json5 at 10 and 50 MiB, `parseData`'s median time and its retained heap must each be
at most 50% of `parse`'s, in this run. json takes `JSON.parse`, so it is shown but not judged.

| Format | Size | time parseData ÷ parse | heap parseData ÷ parse | Result |
|---|---|---|---|---|
| json | 1 MiB | 5% (5 ÷ 105 ms) | 4% (1 ÷ 31 MiB) | not judged |
| json | 10 MiB | 5% (51 ÷ 967 ms) | 3% (12 ÷ 406 MiB) | not judged |
| json | 50 MiB | 4% (307 ÷ 7,221 ms) | 3% (58 ÷ 2,061 MiB) | not judged |
| jsonc | 1 MiB | 39% (39 ÷ 100 ms) | 7% (2 ÷ 30 MiB) | not judged |
| jsonc | 10 MiB | 31% (257 ÷ 834 ms) | 5% (20 ÷ 396 MiB) | pass |
| jsonc | 50 MiB | 18% (1,223 ÷ 6,697 ms) | 5% (100 ÷ 2,007 MiB) | pass |
| json5 | 1 MiB | 36% (24 ÷ 67 ms) | 8% (2 ÷ 26 MiB) | not judged |
| json5 | 10 MiB | 33% (163 ÷ 499 ms) | 6% (21 ÷ 342 MiB) | pass |
| json5 | 50 MiB | 15% (811 ÷ 5,527 ms) | 6% (105 ÷ 1,732 MiB) | pass |
| jsonl | 1 MiB | 9% (7 ÷ 85 ms) | 9% (2 ÷ 21 MiB) | not judged |
| jsonl | 10 MiB | 16% (90 ÷ 550 ms) | 7% (19 ÷ 269 MiB) | not judged |
| jsonl | 50 MiB | 16% (448 ÷ 2,807 ms) | 7% (90 ÷ 1,353 MiB) | not judged |

Verdict: criterion 7 holds in this run.

## Spec 012 criterion 12: JSON Lines against one JSON array

`parseData('jsonl')` at 50 MiB must take a median time at most 1.25 times that of
`parseData('json')` on the same records written as one JSON array (`[`, the lines joined by `,`,
`]`), in this run.

| Size | parseData('jsonl') | parseData('json') on the array | jsonl ÷ array | Result |
|---|---|---|---|---|
| 1 MiB | **7** (8, 7, 7) | **6** (6, 6, 6) | 1.19 | not judged |
| 10 MiB | **90** (92, 89, 90) | **76** (80, 76, 76) | 1.18 | not judged |
| 50 MiB | **448** (448, 440, 458) | **389** (382, 389, 405) | 1.15 | pass |

Verdict: criterion 12 holds in this run.

## Spec 011 criterion 12: JavaScript and Lodash queries

One run of each bench query in the engine (`runQuery` from `packages/app-shell/src/query`: a
fresh QuickJS runtime and context, Lodash loaded for Lodash, the data copied in, the query, the
result copied out) beside the reference (the library's own `executeQuery` of the same language,
in Node, on the data already in memory, so it copies nothing). The documents are
`bench/generate.mjs`'s JSON files at 1 MiB and 5 MiB, parsed once. Same Node process, `--expose-gc`, heap collected before every timed call; 7 runs per
cell after a warm-up on a 256 KiB document; each cell is **median** (runs), in milliseconds. The engine's
WebAssembly was compiled once before the runs (37 ms; criterion 10 compiles it when Transform first opens).

- **filter-map** (JavaScript, `bench/query/filter-map.js`): `filter` on two fields, then `map` to
  four.
- **filter-orderBy-map** (Lodash, `bench/query/filter-orderBy-map.js`): `_.chain`, `filter`,
  `orderBy` on two keys, `map` with `_.pick`, `.value()`.

| Size | Query | Result items | Engine | Reference | Engine ÷ reference | Same result | Within 2.5 s |
|---|---|---|---|---|---|---|---|
| 1 MiB | filter-map (JavaScript) | 1,897 | **39** (43, 38, 41, 39, 39, 39, 37) | **0** (1, 0, 0, 0, 0, 0, 0) | 94× | yes | not judged |
| 1 MiB | filter-orderBy-map (Lodash) | 1,897 | **111** (114, 113, 111, 113, 110, 108, 109) | **4** (9, 4, 3, 4, 3, 4, 3) | 30× | yes | not judged |
| 5 MiB | filter-map (JavaScript) | 9,416 | **172** (179, 173, 169, 172, 170, 171, 173) | **2** (2, 2, 2, 2, 2, 2, 2) | 96× | yes | yes |
| 5 MiB | filter-orderBy-map (Lodash) | 9,416 | **486** (495, 485, 485, 475, 486, 490, 496) | **13** (15, 12, 13, 13, 12, 15, 15) | 38× | yes | yes |

Verdict: every bench query at 5 MiB takes at most 2.5 s in this run (criterion 12).

The reference is V8 running the query on data already in memory; most of the engine's time is
copying the data in and the result out (011 T1 REPORT §3), so the ratio says what the sealed engine
costs, not how fast QuickJS runs the query itself.

## Spec 014 criterion 10: JSONPath queries

Each bench query in JSONPath (RFC 9535) (`executeJsonpathRfc9535` from
`packages/app-shell/src/query/jsonpath-rfc9535.ts`: json-p3 2.3.2, as the Transform dialog runs it)
beside JSONPath (Goessner) (the library's `jsonpathQueryLanguage.executeQuery`, jsonpath-plus), in
the same Node process as the queries above, on the same data already in memory: `bench/generate.mjs`'s
JSON files at 1 MiB and 5 MiB, parsed once. Heap collected before every timed call; 7 runs per cell after a warm-up on a
256 KiB document; each cell is **median** (runs), in milliseconds. "Same result" compares the two
languages' results with `isDeepStrictEqual`.

- **jsonpath-filter** (`bench/query/jsonpath-filter.jsonpath`): a filter on two fields.
- **jsonpath-descendant** (`bench/query/jsonpath-descendant.jsonpath`): a descendant search for
  one key.
- **jsonpath-match** (`bench/query/jsonpath-match.jsonpath`): a filter with `match`; Goessner has
  no `match`, so its query is the same filter with an anchored script regular expression.
- **jsonpath-pick** (`bench/query/jsonpath-pick.jsonpath`): one field of every record.

| Size | Query | RFC 9535 query | Goessner query | Result items | RFC 9535 | Goessner | RFC 9535 ÷ Goessner | Same result | RFC 9535 within 1 s |
|---|---|---|---|---|---|---|---|---|---|
| 1 MiB | jsonpath-filter | `$[?(@.active == true && @.score > 50)]` | `$[?(@.active == true && @.score > 50)]` | 1,897 | **16** (16, 16, 14, 15, 4, 16, 16) | **10** (10, 8, 10, 11, 10, 11, 10) | 1.5× | yes | not judged |
| 1 MiB | jsonpath-descendant | `$..zip` | `$..zip` | 4,372 | **30** (31, 34, 27, 35, 27, 30, 28) | **14** (14, 14, 13, 15, 15, 16, 14) | 2.2× | yes | not judged |
| 1 MiB | jsonpath-match | `$[?match(@.name, 'alpha-.*')]` | `$[?(@.name.match(/^alpha-.*$/))]` | 547 | **11** (13, 7, 11, 5, 11, 6, 13) | **6** (8, 6, 11, 6, 6, 5, 6) | 1.8× | yes | not judged |
| 1 MiB | jsonpath-pick | `$[*].name` | `$[*].name` | 4,372 | **5** (3, 6, 5, 3, 6, 5, 4) | **4** (4, 4, 3, 4, 4, 2, 4) | 1.1× | yes | not judged |
| 5 MiB | jsonpath-filter | `$[?(@.active == true && @.score > 50)]` | `$[?(@.active == true && @.score > 50)]` | 9,416 | **33** (34, 31, 37, 33, 32, 32, 34) | **28** (31, 28, 29, 25, 29, 27, 28) | 1.2× | yes | yes |
| 5 MiB | jsonpath-descendant | `$..zip` | `$..zip` | 21,726 | **111** (112, 107, 113, 109, 110, 111, 114) | **36** (34, 34, 37, 39, 36, 38, 36) | 3.1× | yes | yes |
| 5 MiB | jsonpath-match | `$[?match(@.name, 'alpha-.*')]` | `$[?(@.name.match(/^alpha-.*$/))]` | 2,716 | **32** (30, 32, 29, 35, 32, 30, 33) | **17** (17, 18, 18, 18, 17, 17, 17) | 1.8× | yes | yes |
| 5 MiB | jsonpath-pick | `$[*].name` | `$[*].name` | 21,726 | **19** (17, 20, 19, 19, 20, 18, 18) | **13** (13, 12, 14, 12, 13, 12, 14) | 1.4× | yes | yes |

Verdict: every JSONPath (RFC 9535) bench query at 5 MiB takes at most 1 s in this run (criterion 10).

## Spec 010 criterion 11: smart format

`smartFormat(text, format)` (FracturedJson 5.1.0 with spec 010 §Layout, 010 T2) beside
Format's `getAdapter(format).prettyPrint(text)`, on the same files at 1 MiB and at the 5 MiB
threshold above which smart format is off (criterion 10). Each call parses the text it formats.
HYPOTHESIS: the 5 MiB median is under 5,000 ms on the CI runner.

| Format | Size | smartFormat | prettyPrint | smartFormat ÷ prettyPrint | output size |
|---|---|---|---|---|---|
| json | 1 MiB | **287** (314, 287, 246) | **101** (96, 105, 101) | 2.8× | 0.92 MiB |
| json | 5 MiB | **1,080** (1,121, 1,080, 986) | **490** (485, 492, 490) | 2.2× | 4.61 MiB |
| jsonc | 1 MiB | **315** (322, 315, 277) | **100** (100, 101, 99) | 3.1× | 1.06 MiB |
| jsonc | 5 MiB | **1,103** (1,107, 1,103, 1,054) | **439** (448, 437, 439) | 2.5× | 5.29 MiB |
| json5 | 1 MiB | **366** (406, 366, 309) | **92** (81, 92, 92) | 4.0× | 1.06 MiB |
| json5 | 5 MiB | **1,411** (1,508, 1,411, 1,310) | **438** (438, 421, 438) | 3.2× | 5.31 MiB |

Verdict: the hypothesis holds in this run (every 5 MiB median is under 5,000 ms).

## Against UNK-014's edit budget (< 500 ms)

applyPatch is only the host part of an edit: the UI, the message and `workspace.applyEdit` come on
top (`bench/vscode-open.md`). So a cell over 500 ms here misses the budget whatever else happens;
one under it is necessary, not sufficient. The cells use the host's case, a text already parsed.

| Size | json | jsonc | json5 | jsonl |
|---|---|---|---|---|
| 1 MiB | within, slowest op 29 | within, slowest op 38 | within, slowest op 40 | within, slowest op 2 |
| 10 MiB | within, slowest op 437 | within, slowest op 356 | within, slowest op 268 | within, slowest op 21 |
| 50 MiB | over, slowest op 2,305 | over, slowest op 1,534 | over, slowest op 1,671 | within, slowest op 117 |

Medians relative to parse, over all sizes and formats (edit ÷ parse): replace 0.1–1.0×, add 0.1–1.0×, remove 0.1–1.0×, move 0.1–1.6×.

An edit on a text core has not parsed parses it once (tree and tokens) before it edits, so its
time grows with file size like parse time does. On a parsed text, replace, add and remove only
compute the change and write the new text; move also shifts the tree and tokens after the
removed record.

To reproduce: `pnpm --filter @chr-json-editor/core build`, then
`pnpm --filter @chr-json-editor/bench bench:core` (or the `bench` workflow, `.github/workflows/bench.yml`),
which also runs the query benchmarks (`bench/query/run.mjs`).
