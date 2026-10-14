# Core benchmark: parse and one edit per format (002 T8)

> Spec 002 criterion 7, spec 008 criterion 7, spec 010 criterion 11, spec 012 criterion 12, spec 011 criterion 12, spec 014 criterion 10, spec 015 criterion 11 (core part). Written by `bench/core/report.mjs` from one benchmark run; do not edit
> by hand. Re-run it (the `bench` workflow) whenever `packages/core/src/formats` or `packages/app-shell/src/query` changes speed.

## Run

- Where: GitHub Actions, [run 38453205357](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/38453205357); commit `c67a898b1bb986c5fecd92376d1c8f0cd6178f82`.
- Machine: Linux x64 (`ubuntu24`), 4 × AMD EPYC 9V45 96-Core Processor, 16 GiB RAM.
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
| 1 MiB | **84** (91, 78, 84) | **5** (5, 5, 5) | **62** (62, 64, 62) | **68** (69, 68, 61) | **70** (70, 76, 70) | **104** (106, 99, 104) |
| 10 MiB | **732** (915, 732, 726) | **47** (47, 47, 48) | **542** (542, 547, 518) | **557** (556, 562, 557) | **541** (541, 555, 538) | **914** (914, 956, 904) |
| 50 MiB | **6,683** (7,651, 6,683, 6,548) | **288** (283, 288, 294) | **5,398** (5,425, 5,398, 4,746) | **4,736** (4,772, 4,736, 4,657) | **5,440** (4,531, 5,440, 5,557) | **8,653** (8,653, 8,653, 8,901) |

After the text was parsed (json):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **33** (37, 28, 33) |
| 10 MiB | **0** (0, 0, 0) | **2** (2, 2, 2) | **0** (0, 0, 2) | **350** (348, 350, 361) |
| 50 MiB | **0** (0, 0, 0) | **8** (7, 8, 8) | **0** (0, 0, 0) | **2,344** (2,396, 2,344, 2,335) |

### json-ids

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **90** (107, 86, 90) | **32** (31, 34, 32) | **63** (63, 70, 63) | **68** (68, 69, 68) | **66** (66, 69, 64) | **89** (89, 91, 88) |
| 10 MiB | **818** (962, 768, 818) | **234** (232, 234, 235) | **575** (568, 575, 578) | **607** (607, 620, 576) | **604** (580, 604, 662) | **956** (946, 956, 956) |
| 50 MiB | **6,695** (7,907, 6,561, 6,695) | **1,294** (1,294, 1,275, 1,315) | **5,140** (4,376, 5,377, 5,140) | **5,552** (5,552, 5,537, 5,612) | **5,397** (5,397, 4,799, 5,478) | **7,599** (7,221, 7,599, 8,223) |

After the text was parsed (json-ids):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **31** (31, 28, 32) |
| 10 MiB | **0** (0, 0, 0) | **2** (2, 2, 2) | **0** (0, 0, 0) | **340** (340, 336, 345) |
| 50 MiB | **0** (0, 0, 0) | **8** (8, 7, 8) | **0** (0, 0, 0) | **1,941** (1,941, 1,873, 2,034) |

### jsonc

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **76** (87, 75, 76) | **28** (30, 15, 28) | **56** (59, 54, 56) | **58** (58, 58, 57) | **60** (63, 56, 60) | **91** (86, 91, 92) |
| 10 MiB | **644** (761, 632, 644) | **208** (208, 209, 203) | **447** (440, 447, 472) | **462** (462, 448, 464) | **465** (471, 461, 465) | **774** (774, 765, 806) |
| 50 MiB | **6,093** (6,748, 6,093, 5,487) | **1,053** (1,075, 1,052, 1,053) | **4,943** (4,943, 4,916, 5,004) | **5,091** (4,394, 5,091, 5,118) | **4,454** (4,454, 4,321, 5,224) | **7,142** (7,142, 7,097, 7,282) |

After the text was parsed (jsonc):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **30** (29, 30, 33) |
| 10 MiB | **0** (0, 0, 0) | **2** (2, 2, 2) | **0** (0, 0, 0) | **309** (309, 295, 381) |
| 50 MiB | **0** (0, 0, 0) | **8** (8, 8, 8) | **0** (0, 0, 0) | **1,091** (1,075, 1,105, 1,091) |

### json5

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **44** (55, 43, 44) | **17** (17, 9, 20) | **45** (41, 45, 45) | **45** (45, 45, 47) | **46** (47, 46, 45) | **85** (83, 88, 85) |
| 10 MiB | **456** (526, 410, 456) | **113** (106, 113, 116) | **412** (405, 412, 433) | **430** (421, 437, 430) | **440** (440, 423, 441) | **663** (686, 627, 663) |
| 50 MiB | **5,334** (5,334, 4,805, 5,535) | **618** (689, 578, 618) | **5,600** (4,721, 5,650, 5,600) | **5,716** (5,741, 4,852, 5,716) | **5,657** (4,992, 5,674, 5,657) | **8,259** (7,238, 8,264, 8,259) |

After the text was parsed (json5):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **36** (36, 33, 36) |
| 10 MiB | **0** (0, 0, 0) | **0** (0, 1, 0) | **0** (0, 0, 0) | **224** (233, 224, 222) |
| 50 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **1,424** (1,397, 1,424, 1,482) |

### jsonl

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **76** (78, 75, 76) | **7** (7, 7, 7) | **8** (10, 8, 8) | **9** (9, 9, 8) | **8** (9, 8, 8) | **10** (12, 10, 10) |
| 10 MiB | **520** (654, 518, 520) | **86** (87, 86, 86) | **93** (103, 92, 93) | **97** (104, 93, 97) | **97** (104, 95, 97) | **101** (102, 91, 101) |
| 50 MiB | **3,299** (4,088, 3,161, 3,299) | **449** (449, 478, 445) | **503** (583, 500, 503) | **502** (606, 488, 502) | **511** (600, 497, 511) | **510** (587, 506, 510) |

After the text was parsed (jsonl):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **2** (2, 2, 2) | **2** (2, 2, 2) | **2** (2, 1, 2) | **2** (2, 2, 2) |
| 10 MiB | **16** (12, 17, 16) | **16** (12, 16, 16) | **16** (12, 17, 16) | **18** (15, 20, 18) |
| 50 MiB | **71** (71, 69, 72) | **72** (73, 71, 72) | **71** (71, 70, 72) | **90** (92, 87, 90) |

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
| 1 MiB | 31 | 1 | 247 | 27 | 2 | 237 | 30 | 2 | 247 | 26 | 2 | 230 | 21 | 2 | 157 |
| 10 MiB | 406 | 12 | 1,865 | 390 | 22 | 1,831 | 396 | 20 | 1,802 | 342 | 21 | 1,697 | 269 | 19 | 710 |
| 50 MiB | 2,061 | 58 | 5,845 | 1,989 | 111 | 5,739 | 2,007 | 100 | 5,761 | 1,732 | 105 | 5,425 | 1,353 | 90 | 3,126 |

## Spec 008 criterion 7: parseData against parse

For jsonc and json5 at 10 and 50 MiB, `parseData`'s median time and its retained heap must each be
at most 50% of `parse`'s, in this run. json takes `JSON.parse`, so it is shown but not judged.

| Format | Size | time parseData ÷ parse | heap parseData ÷ parse | Result |
|---|---|---|---|---|
| json | 1 MiB | 5% (5 ÷ 84 ms) | 4% (1 ÷ 31 MiB) | not judged |
| json | 10 MiB | 6% (47 ÷ 732 ms) | 3% (12 ÷ 406 MiB) | not judged |
| json | 50 MiB | 4% (288 ÷ 6,683 ms) | 3% (58 ÷ 2,061 MiB) | not judged |
| json-ids | 1 MiB | 35% (32 ÷ 90 ms) | 9% (2 ÷ 27 MiB) | not judged |
| json-ids | 10 MiB | 29% (234 ÷ 818 ms) | 6% (22 ÷ 390 MiB) | not judged |
| json-ids | 50 MiB | 19% (1,294 ÷ 6,695 ms) | 6% (111 ÷ 1,989 MiB) | not judged |
| jsonc | 1 MiB | 37% (28 ÷ 76 ms) | 7% (2 ÷ 30 MiB) | not judged |
| jsonc | 10 MiB | 32% (208 ÷ 644 ms) | 5% (20 ÷ 396 MiB) | pass |
| jsonc | 50 MiB | 17% (1,053 ÷ 6,093 ms) | 5% (100 ÷ 2,007 MiB) | pass |
| json5 | 1 MiB | 40% (17 ÷ 44 ms) | 8% (2 ÷ 26 MiB) | not judged |
| json5 | 10 MiB | 25% (113 ÷ 456 ms) | 6% (21 ÷ 342 MiB) | pass |
| json5 | 50 MiB | 12% (618 ÷ 5,334 ms) | 6% (105 ÷ 1,732 MiB) | pass |
| jsonl | 1 MiB | 9% (7 ÷ 76 ms) | 9% (2 ÷ 21 MiB) | not judged |
| jsonl | 10 MiB | 17% (86 ÷ 520 ms) | 7% (19 ÷ 269 MiB) | not judged |
| jsonl | 50 MiB | 14% (449 ÷ 3,299 ms) | 7% (90 ÷ 1,353 MiB) | not judged |

Verdict: criterion 7 holds in this run.

## Spec 012 criterion 12: JSON Lines against one JSON array

`parseData('jsonl')` at 50 MiB must take a median time at most 1.25 times that of
`parseData('json')` on the same records written as one JSON array (`[`, the lines joined by `,`,
`]`), in this run.

| Size | parseData('jsonl') | parseData('json') on the array | jsonl ÷ array | Result |
|---|---|---|---|---|
| 1 MiB | **7** (7, 7, 7) | **6** (6, 6, 6) | 1.19 | not judged |
| 10 MiB | **86** (87, 86, 86) | **76** (77, 74, 76) | 1.14 | not judged |
| 50 MiB | **449** (449, 478, 445) | **411** (401, 411, 422) | 1.09 | pass |

Verdict: criterion 12 holds in this run.

## Spec 015 criterion 11 (core part): parse against the base commit

`parse` of each format at 10 MiB must take a median time at most 1.1 times that of the
base commit's core (`3a533201ad9edbbd7e686c2f1c964f98f7381e83`), built and measured in the same job on the same runner.
json-ids is new with spec 015, so the base commit parses it with rounded ids; it is shown, not judged.

| Format | parse (this commit) | parse (base) | this ÷ base | Result |
|---|---|---|---|---|
| json | **732** (915, 732, 726) | **764** (919, 751, 764) | 0.96 | pass |
| json-ids | **818** (962, 768, 818) | **803** (969, 785, 803) | 1.02 | not judged |
| jsonc | **644** (761, 632, 644) | **732** (783, 732, 664) | 0.88 | pass |
| json5 | **456** (526, 410, 456) | **430** (593, 430, 416) | 1.06 | pass |
| jsonl | **520** (654, 518, 520) | **558** (697, 556, 558) | 0.93 | pass |

Verdict: criterion 11 (core part) holds in this run.

## Spec 011 criterion 12: JavaScript and Lodash queries

One run of each bench query in the engine (`runQuery` from `packages/app-shell/src/query`: a
fresh QuickJS runtime and context, Lodash loaded for Lodash, the data copied in, the query, the
result copied out) beside the reference (the library's own `executeQuery` of the same language,
in Node, on the data already in memory, so it copies nothing). The documents are
`bench/generate.mjs`'s JSON files at 1 MiB and 5 MiB, parsed once. Same Node process, `--expose-gc`, heap collected before every timed call; 7 runs per
cell after a warm-up on a 256 KiB document; each cell is **median** (runs), in milliseconds. The engine's
WebAssembly was compiled once before the runs (27 ms; criterion 10 compiles it when Transform first opens).

- **filter-map** (JavaScript, `bench/query/filter-map.js`): `filter` on two fields, then `map` to
  four.
- **filter-orderBy-map** (Lodash, `bench/query/filter-orderBy-map.js`): `_.chain`, `filter`,
  `orderBy` on two keys, `map` with `_.pick`, `.value()`.

| Size | Query | Result items | Engine | Reference | Engine ÷ reference | Same result | Within 2.5 s |
|---|---|---|---|---|---|---|---|
| 1 MiB | filter-map (JavaScript) | 1,897 | **31** (36, 37, 36, 30, 30, 30, 31) | **0** (1, 1, 0, 0, 0, 0, 0) | 70× | yes | not judged |
| 1 MiB | filter-orderBy-map (Lodash) | 1,897 | **87** (90, 91, 87, 85, 87, 84, 86) | **3** (7, 3, 2, 3, 2, 2, 3) | 34× | yes | not judged |
| 5 MiB | filter-map (JavaScript) | 9,416 | **143** (156, 142, 138, 143, 138, 145, 144) | **2** (2, 2, 2, 2, 2, 2, 2) | 74× | yes | yes |
| 5 MiB | filter-orderBy-map (Lodash) | 9,416 | **386** (420, 382, 386, 380, 392, 386, 388) | **11** (12, 11, 11, 9, 10, 11, 11) | 35× | yes | yes |

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
| 1 MiB | jsonpath-filter | `$[?(@.active == true && @.score > 50)]` | `$[?(@.active == true && @.score > 50)]` | 1,897 | **12** (12, 12, 11, 13, 3, 12, 12) | **8** (8, 8, 8, 7, 7, 8, 8) | 1.5× | yes | not judged |
| 1 MiB | jsonpath-descendant | `$..zip` | `$..zip` | 4,372 | **23** (21, 23, 23, 22, 23, 23, 21) | **11** (11, 11, 12, 10, 11, 11, 10) | 2.2× | yes | not judged |
| 1 MiB | jsonpath-match | `$[?match(@.name, 'alpha-.*')]` | `$[?(@.name.match(/^alpha-.*$/))]` | 547 | **9** (10, 5, 9, 4, 9, 4, 9) | **5** (6, 5, 5, 5, 4, 5, 5) | 1.8× | yes | not judged |
| 1 MiB | jsonpath-pick | `$[*].name` | `$[*].name` | 4,372 | **3** (2, 5, 2, 3, 2, 3, 5) | **3** (3, 3, 3, 3, 3, 1, 3) | 1.1× | yes | not judged |
| 5 MiB | jsonpath-filter | `$[?(@.active == true && @.score > 50)]` | `$[?(@.active == true && @.score > 50)]` | 9,416 | **27** (26, 30, 27, 28, 26, 28, 27) | **24** (24, 25, 24, 24, 24, 24, 22) | 1.1× | yes | yes |
| 5 MiB | jsonpath-descendant | `$..zip` | `$..zip` | 21,726 | **78** (85, 79, 78, 78, 78, 73, 78) | **27** (27, 28, 27, 27, 28, 28, 25) | 2.9× | yes | yes |
| 5 MiB | jsonpath-match | `$[?match(@.name, 'alpha-.*')]` | `$[?(@.name.match(/^alpha-.*$/))]` | 2,716 | **25** (24, 25, 24, 27, 25, 24, 25) | **15** (16, 15, 15, 15, 15, 15, 14) | 1.6× | yes | yes |
| 5 MiB | jsonpath-pick | `$[*].name` | `$[*].name` | 21,726 | **15** (13, 15, 16, 16, 15, 14, 15) | **10** (10, 10, 9, 10, 10, 10, 10) | 1.5× | yes | yes |

Verdict: every JSONPath (RFC 9535) bench query at 5 MiB takes at most 1 s in this run (criterion 10).

## Spec 010 criterion 11: smart format

`smartFormat(text, format)` (FracturedJson 5.1.0 with spec 010 §Layout, 010 T2) beside
Format's `getAdapter(format).prettyPrint(text)`, on the same files at 1 MiB and at the 5 MiB
threshold above which smart format is off (criterion 10). Each call parses the text it formats.
HYPOTHESIS: the 5 MiB median is under 5,000 ms on the CI runner.

| Format | Size | smartFormat | prettyPrint | smartFormat ÷ prettyPrint | output size |
|---|---|---|---|---|---|
| json | 1 MiB | **248** (259, 248, 201) | **79** (84, 79, 79) | 3.1× | 0.92 MiB |
| json | 5 MiB | **943** (1,031, 943, 859) | **371** (380, 371, 366) | 2.5× | 4.61 MiB |
| jsonc | 1 MiB | **270** (290, 270, 232) | **80** (80, 76, 82) | 3.4× | 1.06 MiB |
| jsonc | 5 MiB | **1,000** (1,041, 1,000, 962) | **352** (352, 346, 384) | 2.8× | 5.29 MiB |
| json5 | 1 MiB | **332** (367, 332, 279) | **74** (69, 74, 79) | 4.5× | 1.06 MiB |
| json5 | 5 MiB | **1,369** (1,433, 1,369, 1,244) | **421** (421, 409, 427) | 3.3× | 5.31 MiB |

Verdict: the hypothesis holds in this run (every 5 MiB median is under 5,000 ms).

## Against UNK-014's edit budget (< 500 ms)

applyPatch is only the host part of an edit: the UI, the message and `workspace.applyEdit` come on
top (`bench/vscode-open.md`). So a cell over 500 ms here misses the budget whatever else happens;
one under it is necessary, not sufficient. The cells use the host's case, a text already parsed.

| Size | json | json-ids | jsonc | json5 | jsonl |
|---|---|---|---|---|---|
| 1 MiB | within, slowest op 33 | within, slowest op 31 | within, slowest op 30 | within, slowest op 36 | within, slowest op 2 |
| 10 MiB | within, slowest op 350 | within, slowest op 340 | within, slowest op 309 | within, slowest op 224 | within, slowest op 18 |
| 50 MiB | over, slowest op 2,344 | over, slowest op 1,941 | over, slowest op 1,091 | over, slowest op 1,424 | within, slowest op 90 |

Medians relative to parse, over all sizes and formats (edit ÷ parse): replace 0.1–1.0×, add 0.1–1.1×, remove 0.1–1.1×, move 0.1–2.0×.

An edit on a text core has not parsed parses it once (tree and tokens) before it edits, so its
time grows with file size like parse time does. On a parsed text, replace, add and remove only
compute the change and write the new text; move also shifts the tree and tokens after the
removed record.

To reproduce: `pnpm --filter @chr-json-editor/core build`, then
`pnpm --filter @chr-json-editor/bench bench:core` (or the `bench` workflow, `.github/workflows/bench.yml`),
which also runs the query benchmarks (`bench/query/run.mjs`).
