# Core benchmark: parse and one edit per format (002 T8)

> Spec 002 criterion 7, spec 008 criterion 7, spec 010 criterion 11, spec 012 criterion 12, spec 011 criterion 12, spec 014 criterion 10, spec 015 criterion 11 (core part), spec 017 criterion 10. Written by `bench/core/report.mjs` from one benchmark run; do not edit
> by hand. Re-run it (the `bench` workflow) whenever `packages/core/src/formats` or `packages/app-shell/src/query` or `packages/core/src/import` changes speed.

## Run

- Where: GitHub Actions, [run 38576746443](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/38576746443); commit `0367de212a5b869df7300fca223496d3812541c0`.
- Machine: Linux x64 (`ubuntu24`), 4 × AMD EPYC 7763 64-Core Processor, 16 GiB RAM.
- Node v22.23.3, `@chr-json-editor/core` built from that commit, called directly (no editor, no webview, no message passing). Each format and size runs in its own process (`--expose-gc`, heap collected before every timed call; `--max-old-space-size=6144`, Node's default heap limit on this machine: 4.0 GiB, see Memory).
- 3 runs per cell after a warm-up on a 256 KiB document; each cell is **median** (run 1, run 2, run 3), in milliseconds.

## Files

Each size is exactly N × 2^20 bytes (MiB, as in `bench/vscode-open.md`), ASCII only, one array of
records padded inside the last record. Built in memory by `bench/core/run.mjs`:

- **json:** `bench/generate.mjs`, the file 003 T11 opens in VS Code (pretty-printed, 2 spaces).
- **json-ids:** the json file with each record's `id` written as 19 digits (10^18 + i), a big
  number (spec 015), parsed as json; the padding keeps the size exact.
- **jsonc:** the same records with a `//` comment before each, a `/* */` comment inside each, a
  trailing comma in each nested object and after the last record.
- **json5:** as jsonc, plus unquoted keys, single-quoted strings, a hex field and trailing commas
  after every last member.
- **jsonl:** `bench/generate.mjs` `linesText`, the same records as JSON Lines: one
  `JSON.stringify(record)` per line, each ended by `\n`.

Records per file:

| Size | json | json-ids | jsonc | json5 | jsonl |
|---|---|---|---|---|---|
| 1 MiB (1,048,576 B) | 4,372 | 4,111 | 4,323 | 4,305 | 6,897 |
| 10 MiB (10,485,760 B) | 43,361 | 40,950 | 42,702 | 42,530 | 68,086 |
| 50 MiB (52,428,800 B) | 215,488 | 204,170 | 211,612 | 210,767 | 336,787 |

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
| 1 MiB | **140** (140, 118, 142) | **7** (7, 8, 7) | **93** (88, 98, 93) | **91** (92, 91, 90) | **91** (88, 95, 91) | **138** (130, 145, 138) |
| 10 MiB | **1,216** (1,392, 1,128, 1,216) | **74** (74, 76, 74) | **817** (817, 827, 808) | **822** (822, 854, 821) | **828** (828, 848, 817) | **1,315** (1,315, 1,346, 1,289) |
| 50 MiB | **9,286** (10,594, 9,256, 9,286) | **442** (440, 442, 444) | **6,702** (6,702, 6,664, 7,550) | **7,528** (7,228, 7,684, 7,528) | **7,237** (7,237, 7,537, 6,626) | **11,437** (11,381, 11,437, 11,450) |

After the text was parsed (json):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **34** (34, 30, 34) |
| 10 MiB | **0** (0, 0, 0) | **4** (4, 6, 3) | **0** (0, 0, 0) | **474** (474, 469, 474) |
| 50 MiB | **0** (0, 0, 0) | **19** (19, 19, 35) | **0** (0, 0, 0) | **2,815** (2,815, 2,772, 2,823) |

### json-ids

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **138** (165, 126, 138) | **54** (55, 54, 54) | **95** (94, 100, 95) | **99** (99, 100, 97) | **101** (101, 102, 91) | **122** (122, 128, 122) |
| 10 MiB | **1,247** (1,472, 1,193, 1,247) | **383** (383, 379, 393) | **893** (893, 896, 868) | **865** (865, 902, 863) | **881** (881, 898, 871) | **1,146** (1,135, 1,175, 1,146) |
| 50 MiB | **8,256** (10,612, 7,657, 8,256) | **1,976** (1,976, 1,961, 1,982) | **7,118** (6,252, 7,285, 7,118) | **7,398** (7,398, 7,416, 7,218) | **7,405** (6,537, 7,590, 7,405) | **11,311** (11,311, 11,409, 10,344) |

After the text was parsed (json-ids):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **30** (31, 27, 30) |
| 10 MiB | **0** (0, 0, 0) | **3** (3, 4, 3) | **0** (0, 0, 0) | **283** (293, 277, 283) |
| 50 MiB | **0** (1, 0, 0) | **18** (18, 19, 18) | **0** (0, 0, 0) | **2,621** (2,652, 2,592, 2,621) |

### jsonc

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **125** (143, 123, 125) | **52** (54, 52, 52) | **96** (96, 96, 93) | **94** (97, 94, 94) | **97** (97, 93, 99) | **136** (139, 131, 136) |
| 10 MiB | **1,101** (1,255, 1,082, 1,101) | **339** (335, 350, 339) | **781** (807, 781, 781) | **783** (831, 779, 783) | **786** (786, 775, 797) | **1,033** (1,041, 1,033, 1,028) |
| 50 MiB | **8,056** (8,901, 8,009, 8,056) | **1,703** (1,732, 1,703, 1,680) | **7,436** (7,436, 7,393, 7,527) | **7,422** (7,422, 7,423, 7,282) | **7,252** (7,448, 7,244, 7,252) | **10,053** (10,219, 10,047, 10,053) |

After the text was parsed (jsonc):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **44** (47, 39, 44) |
| 10 MiB | **0** (0, 0, 0) | **3** (2, 3, 3) | **0** (0, 0, 0) | **249** (238, 249, 288) |
| 50 MiB | **0** (0, 0, 0) | **23** (20, 24, 23) | **0** (0, 0, 0) | **1,373** (1,350, 1,373, 1,415) |

### json5

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **73** (99, 73, 72) | **29** (29, 27, 31) | **71** (70, 71, 73) | **73** (71, 73, 74) | **73** (79, 73, 73) | **133** (133, 134, 133) |
| 10 MiB | **671** (865, 671, 667) | **203** (203, 198, 203) | **647** (645, 648, 647) | **673** (681, 673, 666) | **678** (678, 665, 682) | **974** (969, 974, 989) |
| 50 MiB | **7,484** (7,640, 6,762, 7,484) | **991** (1,016, 988, 991) | **6,558** (6,558, 6,508, 6,603) | **6,987** (7,733, 6,816, 6,987) | **6,816** (6,667, 7,736, 6,816) | **10,340** (10,340, 10,241, 11,120) |

After the text was parsed (json5):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **52** (54, 47, 52) |
| 10 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **305** (318, 305, 299) |
| 50 MiB | **1** (0, 1, 1) | **0** (0, 0, 0) | **0** (0, 0, 0) | **1,991** (1,991, 1,984, 2,001) |

### jsonl

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **112** (117, 111, 112) | **12** (12, 12, 12) | **14** (16, 14, 14) | **14** (15, 14, 13) | **13** (14, 13, 13) | **14** (16, 14, 14) |
| 10 MiB | **739** (908, 736, 739) | **138** (140, 138, 137) | **147** (162, 144, 147) | **145** (159, 144, 145) | **145** (159, 143, 145) | **145** (167, 144, 145) |
| 50 MiB | **4,282** (5,092, 4,282, 4,072) | **719** (720, 719, 704) | **802** (912, 785, 802) | **808** (922, 808, 801) | **799** (919, 791, 799) | **801** (913, 801, 779) |

After the text was parsed (jsonl):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **3** (3, 3, 3) | **3** (3, 3, 3) | **2** (2, 3, 2) | **3** (3, 3, 4) |
| 10 MiB | **22** (20, 22, 22) | **22** (19, 22, 22) | **20** (19, 21, 20) | **27** (24, 28, 27) |
| 50 MiB | **112** (111, 114, 112) | **113** (113, 114, 113) | **110** (110, 110, 110) | **140** (140, 155, 138) |

## Memory

**Retained heap** is what one parse result (data, tree, tokens, style, diagnostics) keeps alive
after a full collection, so what a host holding the parsed document pays; **parseData heap** is
the same for `parseData`'s result (the data alone), measured first. **Max RSS** is the
peak resident memory of the measuring process over the whole cell (source text, every parse and
edit), in MiB. The heap ceiling is raised because with the GitHub runner's default (about 2 GiB)
the first run of this benchmark ran out of heap in the json 50 MiB cell
([run 37852960823](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/37852960823)).

| Size | json retained heap | json parseData heap | json max RSS | json-ids retained heap | json-ids parseData heap | json-ids max RSS | jsonc retained heap | jsonc parseData heap | jsonc max RSS | json5 retained heap | json5 parseData heap | json5 max RSS | jsonl retained heap | jsonl parseData heap | jsonl max RSS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 MiB | 31 | 1 | 258 | 30 | 2 | 242 | 28 | 2 | 255 | 26 | 2 | 242 | 21 | 2 | 165 |
| 10 MiB | 406 | 12 | 1,859 | 390 | 22 | 1,826 | 396 | 20 | 1,805 | 342 | 21 | 1,676 | 269 | 19 | 714 |
| 50 MiB | 2,061 | 58 | 5,905 | 1,989 | 111 | 5,710 | 2,007 | 100 | 5,844 | 1,731 | 105 | 5,641 | 1,353 | 90 | 3,127 |

## Spec 008 criterion 7: parseData against parse

For jsonc and json5 at 10 and 50 MiB, `parseData`'s median time and its retained heap must each be
at most 50% of `parse`'s, in this run. json takes `JSON.parse`, so it is shown but not judged.

| Format | Size | time parseData ÷ parse | heap parseData ÷ parse | Result |
|---|---|---|---|---|
| json | 1 MiB | 5% (7 ÷ 140 ms) | 4% (1 ÷ 31 MiB) | not judged |
| json | 10 MiB | 6% (74 ÷ 1,216 ms) | 3% (12 ÷ 406 MiB) | not judged |
| json | 50 MiB | 5% (442 ÷ 9,286 ms) | 3% (58 ÷ 2,061 MiB) | not judged |
| json-ids | 1 MiB | 39% (54 ÷ 138 ms) | 8% (2 ÷ 30 MiB) | not judged |
| json-ids | 10 MiB | 31% (383 ÷ 1,247 ms) | 6% (22 ÷ 390 MiB) | not judged |
| json-ids | 50 MiB | 24% (1,976 ÷ 8,256 ms) | 6% (111 ÷ 1,989 MiB) | not judged |
| jsonc | 1 MiB | 42% (52 ÷ 125 ms) | 8% (2 ÷ 28 MiB) | not judged |
| jsonc | 10 MiB | 31% (339 ÷ 1,101 ms) | 5% (20 ÷ 396 MiB) | pass |
| jsonc | 50 MiB | 21% (1,703 ÷ 8,056 ms) | 5% (100 ÷ 2,007 MiB) | pass |
| json5 | 1 MiB | 40% (29 ÷ 73 ms) | 8% (2 ÷ 26 MiB) | not judged |
| json5 | 10 MiB | 30% (203 ÷ 671 ms) | 6% (21 ÷ 342 MiB) | pass |
| json5 | 50 MiB | 13% (991 ÷ 7,484 ms) | 6% (105 ÷ 1,731 MiB) | pass |
| jsonl | 1 MiB | 11% (12 ÷ 112 ms) | 9% (2 ÷ 21 MiB) | not judged |
| jsonl | 10 MiB | 19% (138 ÷ 739 ms) | 7% (19 ÷ 269 MiB) | not judged |
| jsonl | 50 MiB | 17% (719 ÷ 4,282 ms) | 7% (90 ÷ 1,353 MiB) | not judged |

Verdict: criterion 7 holds in this run.

## Spec 012 criterion 12: JSON Lines against one JSON array

`parseData('jsonl')` at 50 MiB must take a median time at most 1.25 times that of
`parseData('json')` on the same records written as one JSON array (`[`, the lines joined by `,`,
`]`), in this run.

| Size | parseData('jsonl') | parseData('json') on the array | jsonl ÷ array | Result |
|---|---|---|---|---|
| 1 MiB | **12** (12, 12, 12) | **10** (10, 10, 10) | 1.23 | not judged |
| 10 MiB | **138** (140, 138, 137) | **118** (118, 117, 119) | 1.17 | not judged |
| 50 MiB | **719** (720, 719, 704) | **636** (636, 633, 643) | 1.13 | pass |

Verdict: criterion 12 holds in this run.

## Spec 015 criterion 11 (core part): parse against the base commit

`parse` of each format at 10 MiB must take a median time at most 1.1 times that of the
base commit's core (`fe24d713390df415e2c2b7ab9e91134f8b05929b`), built and measured in the same job on the same runner.
json-ids is new with spec 015, so the base commit parses it with rounded ids; it is shown, not judged.

| Format | parse (this commit) | parse (base) | this ÷ base | Result |
|---|---|---|---|---|
| json | **1,216** (1,392, 1,128, 1,216) | **1,200** (1,405, 1,149, 1,200) | 1.01 | pass |
| json-ids | **1,247** (1,472, 1,193, 1,247) | **1,261** (1,510, 1,212, 1,261) | 0.99 | not judged |
| jsonc | **1,101** (1,255, 1,082, 1,101) | **1,063** (1,208, 1,063, 1,059) | 1.04 | pass |
| json5 | **671** (865, 671, 667) | **599** (747, 594, 599) | 1.12 | **fail** |
| jsonl | **739** (908, 736, 739) | **782** (953, 782, 774) | 0.94 | pass |

Verdict: **criterion 11 (core part) does not hold** in this run.

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
| 1 MiB | filter-map (JavaScript) | 1,897 | **55** (57, 57, 56, 55, 53, 52, 54) | **1** (1, 1, 1, 1, 1, 1, 1) | 89× | yes | not judged |
| 1 MiB | filter-orderBy-map (Lodash) | 1,897 | **163** (170, 166, 160, 166, 161, 163, 160) | **5** (12, 6, 4, 5, 4, 5, 4) | 34× | yes | not judged |
| 5 MiB | filter-map (JavaScript) | 9,416 | **241** (245, 241, 241, 238, 242, 240, 239) | **3** (3, 3, 3, 3, 3, 3, 3) | 92× | yes | yes |
| 5 MiB | filter-orderBy-map (Lodash) | 9,416 | **724** (722, 724, 717, 725, 724, 716, 733) | **17** (19, 17, 19, 18, 16, 15, 17) | 43× | yes | yes |

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
| 1 MiB | jsonpath-filter | `$[?(@.active == true && @.score > 50)]` | `$[?(@.active == true && @.score > 50)]` | 1,897 | **19** (20, 19, 19, 20, 18, 22, 16) | **11** (11, 11, 8, 11, 11, 13, 13) | 1.7× | yes | not judged |
| 1 MiB | jsonpath-descendant | `$..zip` | `$..zip` | 4,372 | **39** (36, 39, 36, 39, 39, 39, 37) | **16** (16, 19, 18, 16, 18, 15, 16) | 2.4× | yes | not judged |
| 1 MiB | jsonpath-match | `$[?match(@.name, 'alpha-.*')]` | `$[?(@.name.match(/^alpha-.*$/))]` | 547 | **16** (17, 16, 6, 16, 5, 16, 4) | **8** (11, 10, 8, 10, 6, 8, 6) | 1.9× | yes | not judged |
| 1 MiB | jsonpath-pick | `$[*].name` | `$[*].name` | 4,372 | **6** (6, 6, 7, 4, 7, 5, 6) | **5** (6, 5, 3, 5, 3, 3, 5) | 1.2× | yes | not judged |
| 5 MiB | jsonpath-filter | `$[?(@.active == true && @.score > 50)]` | `$[?(@.active == true && @.score > 50)]` | 9,416 | **40** (40, 45, 39, 42, 39, 41, 39) | **35** (37, 35, 34, 34, 35, 37, 37) | 1.1× | yes | yes |
| 5 MiB | jsonpath-descendant | `$..zip` | `$..zip` | 21,726 | **144** (151, 142, 144, 142, 145, 143, 148) | **45** (47, 48, 45, 44, 44, 45, 50) | 3.2× | yes | yes |
| 5 MiB | jsonpath-match | `$[?match(@.name, 'alpha-.*')]` | `$[?(@.name.match(/^alpha-.*$/))]` | 2,716 | **39** (42, 40, 44, 35, 39, 37, 38) | **23** (23, 24, 22, 23, 24, 23, 24) | 1.7× | yes | yes |
| 5 MiB | jsonpath-pick | `$[*].name` | `$[*].name` | 21,726 | **23** (22, 24, 21, 24, 19, 23, 24) | **14** (14, 16, 14, 14, 14, 15, 15) | 1.6× | yes | yes |

Verdict: every JSONPath (RFC 9535) bench query at 5 MiB takes at most 1 s in this run (criterion 10).

## Spec 010 criterion 11: smart format

`smartFormat(text, format)` (FracturedJson 5.1.0 with spec 010 §Layout, 010 T2) beside
Format's `getAdapter(format).prettyPrint(text)`, on the same files at 1 MiB and at the 5 MiB
threshold above which smart format is off (criterion 10). Each call parses the text it formats.
HYPOTHESIS: the 5 MiB median is under 5,000 ms on the CI runner.

| Format | Size | smartFormat | prettyPrint | smartFormat ÷ prettyPrint | output size |
|---|---|---|---|---|---|
| json | 1 MiB | **361** (401, 361, 320) | **119** (119, 125, 115) | 3.0× | 0.92 MiB |
| json | 5 MiB | **1,394** (1,502, 1,394, 1,308) | **587** (587, 600, 585) | 2.4× | 4.61 MiB |
| jsonc | 1 MiB | **379** (379, 398, 362) | **128** (130, 128, 125) | 3.0× | 1.06 MiB |
| jsonc | 5 MiB | **1,482** (1,568, 1,482, 1,376) | **561** (558, 561, 561) | 2.6× | 5.29 MiB |
| json5 | 1 MiB | **468** (536, 468, 428) | **110** (110, 110, 118) | 4.2× | 1.06 MiB |
| json5 | 5 MiB | **1,847** (2,092, 1,847, 1,724) | **519** (519, 521, 517) | 3.6× | 5.31 MiB |

Verdict: the hypothesis holds in this run (every 5 MiB median is under 5,000 ms).

## Spec 017 criterion 10: YAML, TOML and XML import

`importData(text, kind)` (017 T2) on the bench records written by `bench/generate.mjs`
`importText`: YAML as a block sequence of mappings, TOML as an array of tables `records`, XML
as a `records` element of `record` elements; every record has the json file's fields (TOML
leaves out `note`, a null, but on the last record). Each size is exactly N × 2^20 bytes, padded
inside the last record's note. Retained heap is what the result keeps alive after a full
collection; max RSS is the whole process. TOML and XML must take at most
2,000 ms at 5 MiB. YAML runs at 5, 10, 20, 50 MiB (UNK-077's candidates) in
order until the first size that misses its rule, so no size above that one is measured.

| Kind | Size | Records | importData | retained heap | max RSS |
|---|---|---|---|---|---|
| yaml | 1 MiB | 6,433 | **952** (919, 955, 952) | 3 MiB | 199 MiB |
| yaml | 5 MiB | 31,845 | **4,534** (4,298, 4,534, 4,548) | 15 MiB | 538 MiB |
| yaml | 10 MiB | 63,556 | **8,546** (8,356, 8,546, 8,632) | 30 MiB | 978 MiB |
| yaml | 20 MiB | 126,655 | **17,204** (17,204, 17,271, 17,165) | 60 MiB | 1,853 MiB |
| toml | 1 MiB | 6,763 | **67** (81, 57, 67) | 2 MiB | 127 MiB |
| toml | 5 MiB | 33,460 | **364** (359, 364, 364) | 12 MiB | 222 MiB |
| toml | 10 MiB | 66,779 | **703** (712, 703, 693) | 24 MiB | 378 MiB |
| toml | 50 MiB | 330,404 | **3,674** (3,595, 3,711, 3,674) | 118 MiB | 1,304 MiB |
| xml | 1 MiB | 4,164 | **79** (85, 79, 78) | 2 MiB | 103 MiB |
| xml | 5 MiB | 20,701 | **362** (362, 359, 713) | 10 MiB | 121 MiB |
| xml | 10 MiB | 41,315 | **694** (694, 700, 694) | 19 MiB | 141 MiB |
| xml | 50 MiB | 205,400 | **3,551** (3,551, 3,529, 3,587) | 96 MiB | 320 MiB |

TOML and XML verdict: both 5 MiB medians are within 2,000 ms in this run.

UNK-077 (the YAML limit): the largest of 5, 10, 20, 50 MiB where the median is under
10,000 ms and the retained heap under 1.5 GiB; if 5 MiB misses, the limit is the 5 MiB threshold.
Result: **10 MiB** (20 MiB misses: median 17,204 ms, retained heap 60 MiB).

## Against UNK-014's edit budget (< 500 ms)

applyPatch is only the host part of an edit: the UI, the message and `workspace.applyEdit` come on
top (`bench/vscode-open.md`). So a cell over 500 ms here misses the budget whatever else happens;
one under it is necessary, not sufficient. The cells use the host's case, a text already parsed.

| Size | json | json-ids | jsonc | json5 | jsonl |
|---|---|---|---|---|---|
| 1 MiB | within, slowest op 34 | within, slowest op 30 | within, slowest op 44 | within, slowest op 52 | within, slowest op 3 |
| 10 MiB | within, slowest op 474 | within, slowest op 283 | within, slowest op 249 | within, slowest op 305 | within, slowest op 27 |
| 50 MiB | over, slowest op 2,815 | over, slowest op 2,621 | over, slowest op 1,373 | over, slowest op 1,991 | within, slowest op 140 |

Medians relative to parse, over all sizes and formats (edit ÷ parse): replace 0.1–1.0×, add 0.1–1.0×, remove 0.1–1.0×, move 0.1–1.8×.

An edit on a text core has not parsed parses it once (tree and tokens) before it edits, so its
time grows with file size like parse time does. On a parsed text, replace, add and remove only
compute the change and write the new text; move also shifts the tree and tokens after the
removed record.

To reproduce: `pnpm --filter @chr-json-editor/core build`, then
`pnpm --filter @chr-json-editor/bench bench:core` (or the `bench` workflow, `.github/workflows/bench.yml`),
which also runs the query benchmarks (`bench/query/run.mjs`) and the import benchmark (017 T4).
