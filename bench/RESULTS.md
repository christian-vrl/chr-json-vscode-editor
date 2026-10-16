# Core benchmark: parse and one edit per format (002 T8)

> Spec 002 criterion 7, spec 008 criterion 7, spec 010 criterion 11, spec 012 criterion 12, spec 011 criterion 12, spec 014 criterion 10, spec 015 criterion 11 (core part), spec 015 criterion 11 (webview part), UNK-068 (spec 008 criterion 7 on big ids), spec 017 criterion 10, spec 016 criterion 9, spec 018 criterion 11. Written by `bench/core/report.mjs` from one benchmark run; do not edit
> by hand. Re-run it (the `bench` workflow) whenever `packages/core/src/formats` or `packages/app-shell/src/query` or `packages/core/src/import` or `packages/core/src/paths` changes speed.

## Run

- Where: GitHub Actions, [run 38899795803](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/38899795803); commit `6d29f5688925637b7694554605a732dc96c06ca5`.
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
| 1 MiB | **127** (134, 118, 127) | **7** (7, 7, 7) | **92** (90, 99, 92) | **108** (112, 106, 108) | **105** (117, 105, 104) | **145** (143, 145, 168) |
| 10 MiB | **1,203** (1,339, 1,203, 1,128) | **72** (71, 72, 72) | **787** (787, 814, 785) | **817** (817, 839, 805) | **805** (805, 837, 802) | **1,279** (1,278, 1,325, 1,279) |
| 50 MiB | **9,064** (10,181, 9,056, 9,064) | **436** (431, 440, 436) | **7,284** (6,350, 7,321, 7,284) | **6,427** (6,169, 6,427, 7,318) | **6,452** (6,214, 6,452, 7,218) | **11,195** (10,851, 11,195, 11,263) |

After the text was parsed (json):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **35** (34, 39, 35) |
| 10 MiB | **0** (0, 0, 0) | **3** (3, 3, 2) | **0** (0, 0, 0) | **459** (469, 459, 458) |
| 50 MiB | **0** (0, 0, 0) | **18** (19, 18, 18) | **0** (0, 0, 0) | **2,748** (2,740, 2,774, 2,748) |

### json-ids

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **130** (161, 123, 130) | **50** (50, 53, 49) | **96** (92, 96, 97) | **96** (97, 95, 96) | **94** (94, 99, 92) | **125** (125, 132, 125) |
| 10 MiB | **1,218** (1,425, 1,160, 1,218) | **377** (377, 381, 373) | **849** (849, 865, 843) | **857** (857, 881, 840) | **854** (852, 885, 854) | **1,297** (1,297, 1,327, 1,278) |
| 50 MiB | **8,229** (9,468, 7,989, 8,229) | **1,947** (1,873, 1,947, 1,953) | **6,096** (7,000, 6,064, 6,096) | **7,148** (7,148, 7,208, 6,155) | **7,094** (7,094, 7,152, 6,935) | **10,161** (10,161, 10,264, 9,267) |

After the text was parsed (json-ids):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **46** (46, 29, 46) |
| 10 MiB | **0** (0, 0, 0) | **2** (2, 2, 2) | **0** (0, 0, 0) | **445** (447, 437, 445) |
| 50 MiB | **0** (0, 0, 0) | **18** (18, 18, 18) | **0** (0, 0, 0) | **1,903** (1,895, 1,903, 1,906) |

### jsonc

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **119** (130, 118, 119) | **49** (47, 49, 49) | **88** (92, 88, 88) | **93** (94, 93, 92) | **91** (89, 91, 93) | **129** (129, 132, 127) |
| 10 MiB | **1,044** (1,167, 1,040, 1,044) | **322** (324, 322, 317) | **744** (744, 750, 738) | **745** (745, 754, 745) | **746** (746, 741, 754) | **981** (986, 980, 981) |
| 50 MiB | **8,304** (8,245, 8,304, 8,319) | **1,647** (1,650, 1,647, 1,606) | **6,761** (6,933, 6,761, 6,662) | **6,656** (6,762, 6,656, 5,768) | **6,699** (6,699, 6,706, 5,798) | **9,504** (8,408, 9,504, 9,507) |

After the text was parsed (jsonc):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **43** (44, 40, 43) |
| 10 MiB | **0** (0, 0, 0) | **3** (2, 6, 3) | **0** (0, 0, 0) | **241** (254, 229, 241) |
| 50 MiB | **0** (0, 0, 0) | **18** (18, 18, 18) | **0** (0, 0, 0) | **1,287** (1,272, 1,287, 1,296) |

### json5

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **68** (86, 68, 67) | **28** (29, 18, 28) | **69** (69, 68, 69) | **70** (70, 69, 71) | **71** (71, 71, 72) | **121** (120, 121, 127) |
| 10 MiB | **625** (804, 611, 625) | **197** (197, 198, 195) | **610** (610, 625, 608) | **650** (654, 641, 650) | **677** (677, 668, 684) | **923** (930, 923, 912) |
| 50 MiB | **6,383** (7,038, 6,383, 6,260) | **970** (992, 970, 970) | **7,266** (7,257, 7,266, 7,291) | **6,611** (6,446, 6,611, 6,615) | **6,602** (6,514, 6,602, 6,636) | **9,905** (9,741, 10,643, 9,905) |

After the text was parsed (json5):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **47** (46, 47, 48) |
| 10 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **274** (286, 270, 274) |
| 50 MiB | **0** (0, 1, 0) | **2** (0, 2, 3) | **0** (0, 0, 0) | **1,885** (1,884, 1,891, 1,885) |

### jsonl

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **111** (120, 111, 108) | **12** (12, 12, 12) | **13** (15, 13, 13) | **13** (16, 13, 13) | **13** (14, 13, 13) | **14** (14, 14, 13) |
| 10 MiB | **728** (908, 728, 718) | **138** (137, 138, 138) | **142** (157, 141, 142) | **144** (157, 144, 143) | **148** (160, 145, 148) | **146** (160, 146, 146) |
| 50 MiB | **4,362** (5,100, 4,362, 4,223) | **714** (724, 714, 713) | **759** (875, 752, 759) | **737** (841, 732, 737) | **743** (862, 739, 743) | **750** (857, 740, 750) |

After the text was parsed (jsonl):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **3** (3, 2, 3) | **2** (2, 2, 3) | **2** (2, 2, 2) | **3** (3, 3, 3) |
| 10 MiB | **20** (18, 20, 21) | **21** (18, 21, 22) | **20** (18, 20, 20) | **27** (24, 27, 27) |
| 50 MiB | **110** (108, 110, 110) | **111** (148, 111, 110) | **110** (110, 108, 110) | **137** (138, 136, 137) |

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
| 1 MiB | 31 | 1 | 257 | 30 | 2 | 245 | 28 | 2 | 247 | 26 | 2 | 242 | 21 | 2 | 163 |
| 10 MiB | 406 | 12 | 1,873 | 390 | 22 | 1,811 | 396 | 20 | 1,818 | 342 | 21 | 1,684 | 269 | 19 | 714 |
| 50 MiB | 2,061 | 58 | 5,647 | 1,989 | 111 | 5,853 | 2,007 | 100 | 5,769 | 1,732 | 105 | 5,429 | 1,353 | 90 | 3,132 |

## Spec 008 criterion 7: parseData against parse

For jsonc and json5 at 10 and 50 MiB, `parseData`'s median time and its retained heap must each be
at most 50% of `parse`'s, in this run. json takes `JSON.parse`, so it is shown but not judged.

| Format | Size | time parseData ÷ parse | heap parseData ÷ parse | Result |
|---|---|---|---|---|
| json | 1 MiB | 6% (7 ÷ 127 ms) | 4% (1 ÷ 31 MiB) | not judged |
| json | 10 MiB | 6% (72 ÷ 1,203 ms) | 3% (12 ÷ 406 MiB) | not judged |
| json | 50 MiB | 5% (436 ÷ 9,064 ms) | 3% (58 ÷ 2,061 MiB) | not judged |
| json-ids | 1 MiB | 39% (50 ÷ 130 ms) | 8% (2 ÷ 30 MiB) | not judged |
| json-ids | 10 MiB | 31% (377 ÷ 1,218 ms) | 6% (22 ÷ 390 MiB) | not judged |
| json-ids | 50 MiB | 24% (1,947 ÷ 8,229 ms) | 6% (111 ÷ 1,989 MiB) | not judged |
| jsonc | 1 MiB | 41% (49 ÷ 119 ms) | 8% (2 ÷ 28 MiB) | not judged |
| jsonc | 10 MiB | 31% (322 ÷ 1,044 ms) | 5% (20 ÷ 396 MiB) | pass |
| jsonc | 50 MiB | 20% (1,647 ÷ 8,304 ms) | 5% (100 ÷ 2,007 MiB) | pass |
| json5 | 1 MiB | 41% (28 ÷ 68 ms) | 8% (2 ÷ 26 MiB) | not judged |
| json5 | 10 MiB | 32% (197 ÷ 625 ms) | 6% (21 ÷ 342 MiB) | pass |
| json5 | 50 MiB | 15% (970 ÷ 6,383 ms) | 6% (105 ÷ 1,732 MiB) | pass |
| jsonl | 1 MiB | 11% (12 ÷ 111 ms) | 9% (2 ÷ 21 MiB) | not judged |
| jsonl | 10 MiB | 19% (138 ÷ 728 ms) | 7% (19 ÷ 269 MiB) | not judged |
| jsonl | 50 MiB | 16% (714 ÷ 4,362 ms) | 7% (90 ÷ 1,353 MiB) | not judged |

Verdict: criterion 7 holds in this run.

## Spec 012 criterion 12: JSON Lines against one JSON array

`parseData('jsonl')` at 50 MiB must take a median time at most 1.25 times that of
`parseData('json')` on the same records written as one JSON array (`[`, the lines joined by `,`,
`]`), in this run.

| Size | parseData('jsonl') | parseData('json') on the array | jsonl ÷ array | Result |
|---|---|---|---|---|
| 1 MiB | **12** (12, 12, 12) | **9** (9, 9, 10) | 1.24 | not judged |
| 10 MiB | **138** (137, 138, 138) | **115** (117, 115, 115) | 1.20 | not judged |
| 50 MiB | **714** (724, 714, 713) | **638** (635, 638, 650) | 1.12 | pass |

Verdict: criterion 12 holds in this run.

## Spec 015 criterion 11 (core part): parse against the base commit

`parse` of each format at 10 MiB must take a median time at most 1.1 times that of the
base commit's core (`bc6f0721bab81b3330dc3b179a381886ac2b8852`), built and measured in the same job on the same runner.
json-ids is new with spec 015, so the base commit parses it with rounded ids; it is shown, not judged.

| Format | parse (this commit) | parse (base) | this ÷ base | Result |
|---|---|---|---|---|
| json | **1,203** (1,339, 1,203, 1,128) | **1,155** (1,355, 1,092, 1,155) | 1.04 | pass |
| json-ids | **1,218** (1,425, 1,160, 1,218) | **1,184** (1,429, 1,141, 1,184) | 1.03 | not judged |
| jsonc | **1,044** (1,167, 1,040, 1,044) | **1,051** (1,178, 1,046, 1,051) | 0.99 | pass |
| json5 | **625** (804, 611, 625) | **589** (765, 579, 589) | 1.06 | pass |
| jsonl | **728** (908, 728, 718) | **779** (899, 779, 742) | 0.93 | pass |

Verdict: criterion 11 (core part) holds in this run.

## Spec 015 criterion 11 (webview part): the editor page's parser

The page's parser (`parserFor('json')`, app-shell's `parser.ts` built by `tsc`) against
`JSON.parse` of the same 5 MiB text, in one Node process per document: at most
2× on the json document (no big number: the parser scans for a big-number
candidate, then calls `JSON.parse`) and at most 5× on the json-ids document (every
record's id a big number: lossless-json's parser through core's `readJsonExact`).

| Document | JSON.parse | parserFor('json') | parser ÷ JSON.parse | Limit | Result |
|---|---|---|---|---|---|
| json 5 MiB | **21** (24, 21, 21) | **29** (29, 29, 29) | 1.34 | 2× | pass |
| json-ids 5 MiB | **25** (25, 25, 25) | **122** (128, 119, 122) | 4.93 | 5× | pass |

Verdict: criterion 11 (webview part) holds in this run.

### The big-number scan of each library query (spec 015 B7)

What `exactNumbersLanguage` (app-shell's `query/exact-numbers.ts`) adds to each JSONQuery,
JMESPath and JSONPath query on the same data, as the page holds it: **scan** is
`bigNumberOrigins` on the input (it walks every number; on data with no big number it stops
after `holdsBigNumber`'s walk) and, when there is a big number, `nearestNumbers` of the input;
**restore** is `restoreBigNumbers` on the identity query's result (the whole document, the
worst case). Shown, not judged: criterion 11 sets no bound on it.

| Document | scan | restore | restore outcome |
|---|---|---|---|
| json 5 MiB | **7** (14, 7, 7) | — (nothing to restore) | — |
| json-ids 5 MiB | **97** (96, 97, 98) | **17** (14, 17, 18) | 20496 numbers in this result can't be kept exact. |

On json-ids the identity query is refused as ambiguous: the bench's ids are consecutive, and
19-digit integers less than 128 apart share one nearest number, so B7 cannot tell which id a
result number came from (plan R4); JavaScript and Lodash keep the digits (B8). Independent of
this scan, `1e400` through JSONQuery and JMESPath still comes back `null`: the library's own
`JSON.parse(parser.stringify(json))` round trip turns `Infinity` into `null` before B7 runs
(pre-existing, disclosed in 015 T5).

## UNK-068: spec 008 criterion 7 on big-id documents

The large-file benchmark's big-id JSONC and JSON5 files (`bench/generate.mjs --formats --big-ids`,
every record's `id` 19 digits, the files `bench/large-file.md` opens), one process per file:
`parseData`'s median time and retained heap must each be at most 50% of `parse`'s.

| Format | Size | time parseData ÷ parse | heap parseData ÷ parse | Result |
|---|---|---|---|---|
| jsonc-ids | 6 MiB | 28% (197 ÷ 695 ms) | 6% (13 ÷ 215 MiB) | pass |
| jsonc-ids | 10 MiB | 27% (307 ÷ 1,156 ms) | 6% (21 ÷ 372 MiB) | pass |
| jsonc-ids | 50 MiB | 20% (1,622 ÷ 8,055 ms) | 5% (104 ÷ 1,894 MiB) | pass |
| json5-ids | 6 MiB | 30% (117 ÷ 390 ms) | 7% (14 ÷ 199 MiB) | pass |
| json5-ids | 10 MiB | 28% (187 ÷ 663 ms) | 7% (24 ÷ 333 MiB) | pass |
| json5-ids | 50 MiB | 15% (949 ÷ 6,342 ms) | 7% (118 ÷ 1,696 MiB) | pass |

Verdict: criterion 7 holds with big ids in this run.

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
| 1 MiB | filter-map (JavaScript) | 1,897 | **52** (55, 55, 55, 52, 51, 52, 51) | **1** (1, 1, 1, 1, 1, 1, 1) | 96× | yes | not judged |
| 1 MiB | filter-orderBy-map (Lodash) | 1,897 | **159** (168, 166, 159, 159, 163, 159, 158) | **4** (11, 6, 4, 5, 4, 4, 4) | 38× | yes | not judged |
| 5 MiB | filter-map (JavaScript) | 9,416 | **237** (241, 238, 238, 235, 234, 237, 236) | **2** (2, 2, 3, 2, 2, 2, 3) | 96× | yes | yes |
| 5 MiB | filter-orderBy-map (Lodash) | 9,416 | **716** (716, 711, 717, 726, 711, 718, 708) | **15** (15, 14, 15, 14, 15, 15, 17) | 48× | yes | yes |

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
| 1 MiB | jsonpath-filter | `$[?(@.active == true && @.score > 50)]` | `$[?(@.active == true && @.score > 50)]` | 1,897 | **19** (20, 19, 19, 19, 18, 18, 18) | **10** (10, 10, 11, 10, 10, 11, 13) | 1.8× | yes | not judged |
| 1 MiB | jsonpath-descendant | `$..zip` | `$..zip` | 4,372 | **39** (42, 39, 39, 40, 36, 38, 37) | **16** (16, 16, 15, 16, 16, 16, 15) | 2.5× | yes | not judged |
| 1 MiB | jsonpath-match | `$[?match(@.name, 'alpha-.*')]` | `$[?(@.name.match(/^alpha-.*$/))]` | 547 | **15** (17, 8, 17, 8, 15, 5, 16) | **8** (10, 7, 8, 8, 8, 8, 9) | 1.9× | yes | not judged |
| 1 MiB | jsonpath-pick | `$[*].name` | `$[*].name` | 4,372 | **6** (5, 6, 6, 6, 5, 5, 6) | **5** (5, 6, 5, 3, 5, 5, 5) | 1.1× | yes | not judged |
| 5 MiB | jsonpath-filter | `$[?(@.active == true && @.score > 50)]` | `$[?(@.active == true && @.score > 50)]` | 9,416 | **41** (40, 42, 37, 44, 39, 42, 41) | **33** (33, 32, 33, 34, 33, 33, 34) | 1.2× | yes | yes |
| 5 MiB | jsonpath-descendant | `$..zip` | `$..zip` | 21,726 | **147** (147, 147, 149, 143, 151, 145, 147) | **42** (42, 42, 42, 42, 41, 42, 42) | 3.5× | yes | yes |
| 5 MiB | jsonpath-match | `$[?match(@.name, 'alpha-.*')]` | `$[?(@.name.match(/^alpha-.*$/))]` | 2,716 | **38** (40, 38, 38, 36, 39, 36, 38) | **23** (24, 23, 24, 23, 23, 23, 23) | 1.6× | yes | yes |
| 5 MiB | jsonpath-pick | `$[*].name` | `$[*].name` | 21,726 | **23** (26, 24, 24, 23, 21, 23, 22) | **14** (17, 14, 13, 13, 14, 16, 15) | 1.6× | yes | yes |

Verdict: every JSONPath (RFC 9535) bench query at 5 MiB takes at most 1 s in this run (criterion 10).

## Spec 010 criterion 11: smart format

`smartFormat(text, format)` (FracturedJson 5.1.0 with spec 010 §Layout, 010 T2) beside
Format's `getAdapter(format).prettyPrint(text)`, on the same files at 1 MiB and at the 5 MiB
threshold above which smart format is off (criterion 10). Each call parses the text it formats.
HYPOTHESIS: the 5 MiB median is under 5,000 ms on the CI runner.

| Format | Size | smartFormat | prettyPrint | smartFormat ÷ prettyPrint | output size |
|---|---|---|---|---|---|
| json | 1 MiB | **346** (371, 346, 311) | **113** (111, 116, 113) | 3.1× | 0.92 MiB |
| json | 5 MiB | **1,309** (1,392, 1,309, 1,262) | **553** (553, 572, 550) | 2.4× | 4.61 MiB |
| jsonc | 1 MiB | **374** (408, 374, 336) | **115** (113, 115, 123) | 3.3× | 1.06 MiB |
| jsonc | 5 MiB | **1,370** (1,421, 1,370, 1,254) | **526** (512, 531, 526) | 2.6× | 5.29 MiB |
| json5 | 1 MiB | **437** (507, 437, 383) | **107** (105, 109, 107) | 4.1× | 1.06 MiB |
| json5 | 5 MiB | **1,706** (1,922, 1,706, 1,577) | **497** (497, 490, 500) | 3.4× | 5.31 MiB |

Verdict: the hypothesis holds in this run (every 5 MiB median is under 5,000 ms).

## Spec 016 criterion 9: JSON Schema generation

`generateSchema(data, 'draft-07')` (016 T1, the dialect the command writes) on the data
`parseData('json', text)` gives, beside that `parseData`, on the json file at the 5 MiB
threshold and at 50 MiB, both in the same process. Criterion 9: at each size the median
`generateSchema` time is at most the median `parseData` time of the same document in this run.

| Size | Records | generateSchema | parseData | generateSchema ÷ parseData | schema file |
|---|---|---|---|---|---|
| 5 MiB | 21,726 | **20** (20, 25, 11) | **30** (30, 29, 30) | 0.65× | 949 B |
| 50 MiB | 215,488 | **150** (151, 150, 118) | **353** (353, 357, 346) | 0.43× | 949 B |

Verdict: the bound holds in this run (at 5 and 50 MiB `generateSchema` takes at most the time of `parseData`).

## Spec 018 criterion 11: locating a node beside parse

`nodeAt(format, text, offset)` at the last record's last key (`note`, its first character) and
`placeOf(format, text, path)` of that path (018 T1), beside `getAdapter(format).parse(text)` of
the same document in the same process. Each `parse` call parses (two texts alternate, as above);
the path functions keep no cache. Each must take at most 25% of parse's median.

| Format | Size | parse | nodeAt | placeOf | nodeAt ÷ parse | placeOf ÷ parse |
|---|---|---|---|---|---|---|
| json | 5 MiB | **671** (740, 671, 578) | **97** (97, 98, 95) | **105** (105, 102, 108) | 14.4% | 15.6% |
| json | 50 MiB | **8,249** (7,289, 12,941, 8,249) | **1,040** (1,040, 1,052, 1,016) | **1,086** (1,086, 1,094, 1,065) | 12.6% | 13.2% |
| jsonc | 5 MiB | **572** (637, 572, 513) | **99** (100, 99, 98) | **105** (105, 105, 111) | 17.3% | 18.4% |
| jsonc | 50 MiB | **8,225** (6,295, 10,599, 8,225) | **1,057** (1,069, 1,057, 1,042) | **1,102** (1,102, 1,135, 1,100) | 12.9% | 13.4% |
| json5 | 5 MiB | **408** (485, 408, 308) | **86** (81, 89, 86) | **90** (84, 90, 90) | 21.1% | 22.0% |
| json5 | 50 MiB | **5,386** (5,386, 7,121, 5,150) | **848** (842, 851, 848) | **915** (905, 915, 934) | 15.7% | 17.0% |
| jsonl | 5 MiB | **460** (519, 460, 376) | **4** (4, 2, 4) | **3** (3, 2, 3) | 0.9% | 0.7% |
| jsonl | 50 MiB | **4,793** (5,702, 4,793, 3,949) | **33** (33, 19, 33) | **30** (30, 39, 30) | 0.7% | 0.6% |

Verdict: the bound holds in this run (every share is at most 25%).

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
| yaml | 1 MiB | 6,433 | **874** (874, 907, 867) | 3 MiB | 187 MiB |
| yaml | 5 MiB | 31,845 | **4,140** (4,133, 4,169, 4,140) | 15 MiB | 538 MiB |
| yaml | 10 MiB | 63,556 | **8,312** (8,402, 8,312, 8,209) | 30 MiB | 978 MiB |
| yaml | 20 MiB | 126,655 | **16,775** (16,664, 16,775, 17,059) | 59 MiB | 1,855 MiB |
| toml | 1 MiB | 6,763 | **68** (68, 70, 55) | 2 MiB | 122 MiB |
| toml | 5 MiB | 33,460 | **348** (351, 348, 344) | 12 MiB | 222 MiB |
| toml | 10 MiB | 66,779 | **659** (662, 654, 659) | 24 MiB | 346 MiB |
| toml | 50 MiB | 330,404 | **3,445** (3,445, 3,438, 3,473) | 118 MiB | 1,209 MiB |
| xml | 1 MiB | 4,164 | **79** (82, 79, 78) | 2 MiB | 102 MiB |
| xml | 5 MiB | 20,701 | **351** (347, 351, 694) | 10 MiB | 121 MiB |
| xml | 10 MiB | 41,315 | **692** (696, 683, 692) | 19 MiB | 142 MiB |
| xml | 50 MiB | 205,400 | **3,427** (3,517, 3,427, 3,417) | 96 MiB | 319 MiB |

TOML and XML verdict: both 5 MiB medians are within 2,000 ms in this run.

UNK-077 (the YAML limit): the largest of 5, 10, 20, 50 MiB where the median is under
10,000 ms and the retained heap under 1.5 GiB; if 5 MiB misses, the limit is the 5 MiB threshold.
Result: **10 MiB** (20 MiB misses: median 16,775 ms, retained heap 59 MiB).

## Against UNK-014's edit budget (< 500 ms)

applyPatch is only the host part of an edit: the UI, the message and `workspace.applyEdit` come on
top (`bench/vscode-open.md`). So a cell over 500 ms here misses the budget whatever else happens;
one under it is necessary, not sufficient. The cells use the host's case, a text already parsed.

| Size | json | json-ids | jsonc | json5 | jsonl |
|---|---|---|---|---|---|
| 1 MiB | within, slowest op 35 | within, slowest op 46 | within, slowest op 43 | within, slowest op 47 | within, slowest op 3 |
| 10 MiB | within, slowest op 459 | within, slowest op 445 | within, slowest op 241 | within, slowest op 274 | within, slowest op 27 |
| 50 MiB | over, slowest op 2,748 | over, slowest op 1,903 | over, slowest op 1,287 | over, slowest op 1,885 | within, slowest op 137 |

Medians relative to parse, over all sizes and formats (edit ÷ parse): replace 0.1–1.1×, add 0.1–1.0×, remove 0.1–1.1×, move 0.1–1.8×.

An edit on a text core has not parsed parses it once (tree and tokens) before it edits, so its
time grows with file size like parse time does. On a parsed text, replace, add and remove only
compute the change and write the new text; move also shifts the tree and tokens after the
removed record.

To reproduce: `pnpm --filter @chr-json-editor/core build`, then
`pnpm --filter @chr-json-editor/bench bench:core` (or the `bench` workflow, `.github/workflows/bench.yml`),
which also runs the query benchmarks (`bench/query/run.mjs`) and the import benchmark (017 T4).
