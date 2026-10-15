# Core benchmark: parse and one edit per format (002 T8)

> Spec 002 criterion 7, spec 008 criterion 7, spec 010 criterion 11, spec 012 criterion 12, spec 011 criterion 12, spec 014 criterion 10, spec 015 criterion 11 (core part), spec 015 criterion 11 (webview part), UNK-068 (spec 008 criterion 7 on big ids), spec 017 criterion 10. Written by `bench/core/report.mjs` from one benchmark run; do not edit
> by hand. Re-run it (the `bench` workflow) whenever `packages/core/src/formats` or `packages/app-shell/src/query` or `packages/core/src/import` changes speed.

## Run

- Where: GitHub Actions, [run 38611914239](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/38611914239); commit `3123970f0f4ca03ab9d1ab8ee9be8a4d5141714e`.
- Machine: Linux x64 (`ubuntu24`), 4 × Intel(R) Xeon(R) 6973P-C, 16 GiB RAM.
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
| 1 MiB | **98** (122, 95, 98) | **6** (6, 7, 6) | **84** (91, 84, 66) | **77** (77, 85, 73) | **73** (72, 77, 73) | **97** (97, 103, 95) |
| 10 MiB | **1,069** (1,137, 940, 1,069) | **92** (67, 95, 92) | **732** (766, 732, 721) | **729** (729, 770, 692) | **719** (682, 767, 719) | **1,118** (1,118, 1,135, 1,103) |
| 50 MiB | **7,746** (7,746, 7,966, 7,046) | **446** (446, 444, 451) | **6,276** (6,276, 6,737, 5,508) | **6,314** (6,314, 5,906, 6,521) | **5,899** (6,244, 5,735, 5,899) | **9,444** (9,444, 8,954, 9,512) |

After the text was parsed (json):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **32** (33, 26, 32) |
| 10 MiB | **0** (0, 0, 0) | **4** (3, 4, 4) | **0** (0, 0, 0) | **454** (454, 436, 455) |
| 50 MiB | **0** (0, 0, 0) | **14** (15, 14, 14) | **0** (0, 0, 0) | **2,513** (2,489, 2,513, 2,570) |

### json-ids

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **105** (130, 102, 105) | **39** (39, 45, 37) | **77** (77, 81, 74) | **79** (79, 82, 78) | **79** (79, 81, 79) | **114** (114, 117, 104) |
| 10 MiB | **1,023** (1,229, 993, 1,023) | **303** (299, 303, 307) | **743** (737, 768, 743) | **829** (829, 865, 752) | **748** (747, 785, 748) | **1,000** (1,000, 1,091, 988) |
| 50 MiB | **7,899** (8,104, 7,694, 7,899) | **1,461** (1,471, 1,386, 1,461) | **5,522** (5,522, 5,411, 6,062) | **5,067** (5,067, 6,151, 4,954) | **5,288** (5,398, 5,151, 5,288) | **8,380** (8,380, 8,373, 8,506) |

After the text was parsed (json-ids):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **38** (40, 35, 38) |
| 10 MiB | **0** (0, 0, 0) | **4** (4, 4, 3) | **0** (0, 0, 0) | **329** (305, 329, 337) |
| 50 MiB | **0** (0, 0, 0) | **14** (14, 14, 14) | **0** (0, 0, 0) | **2,063** (2,022, 2,063, 2,069) |

### jsonc

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **92** (96, 92, 85) | **35** (35, 39, 18) | **72** (65, 73, 72) | **73** (79, 73, 71) | **73** (74, 71, 73) | **107** (108, 104, 107) |
| 10 MiB | **867** (946, 840, 867) | **260** (262, 259, 260) | **634** (643, 634, 632) | **649** (649, 652, 646) | **642** (642, 634, 654) | **889** (889, 892, 885) |
| 50 MiB | **7,609** (7,609, 7,784, 7,482) | **1,376** (1,376, 1,349, 1,457) | **5,847** (5,847, 6,184, 5,645) | **6,205** (6,205, 6,712, 5,780) | **5,871** (6,145, 5,729, 5,871) | **9,889** (10,634, 9,889, 9,388) |

After the text was parsed (jsonc):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **38** (38, 36, 40) |
| 10 MiB | **0** (0, 0, 0) | **4** (4, 4, 4) | **0** (0, 0, 3) | **272** (272, 269, 279) |
| 50 MiB | **0** (0, 0, 0) | **15** (15, 15, 14) | **0** (0, 0, 0) | **2,021** (2,045, 2,019, 2,021) |

### json5

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **70** (79, 60, 70) | **28** (29, 28, 11) | **71** (68, 71, 78) | **72** (72, 79, 70) | **76** (76, 83, 63) | **112** (112, 113, 109) |
| 10 MiB | **675** (738, 585, 675) | **184** (178, 184, 205) | **644** (644, 603, 690) | **650** (693, 628, 650) | **624** (653, 624, 622) | **1,027** (1,027, 1,034, 960) |
| 50 MiB | **6,534** (6,680, 6,331, 6,534) | **882** (929, 882, 881) | **6,046** (6,021, 6,046, 6,447) | **6,845** (6,849, 6,845, 6,588) | **6,658** (6,622, 6,828, 6,658) | **9,518** (9,518, 9,797, 9,411) |

After the text was parsed (json5):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **48** (54, 43, 48) |
| 10 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 3) | **338** (352, 330, 338) |
| 50 MiB | **0** (0, 1, 0) | **0** (0, 0, 3) | **0** (0, 0, 0) | **1,740** (1,755, 1,716, 1,740) |

### jsonl

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **107** (107, 94, 109) | **9** (9, 9, 8) | **10** (12, 10, 10) | **10** (11, 10, 9) | **10** (10, 9, 10) | **10** (11, 10, 9) |
| 10 MiB | **572** (802, 572, 562) | **106** (106, 113, 106) | **105** (135, 99, 105) | **104** (127, 101, 104) | **107** (121, 101, 107) | **104** (133, 103, 104) |
| 50 MiB | **3,588** (4,001, 3,130, 3,588) | **593** (545, 593, 605) | **726** (818, 726, 700) | **566** (736, 566, 546) | **642** (820, 642, 606) | **662** (700, 638, 662) |

After the text was parsed (jsonl):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **2** (2, 2, 2) | **2** (2, 2, 2) | **2** (2, 2, 2) | **2** (2, 2, 2) |
| 10 MiB | **17** (30, 16, 17) | **15** (15, 15, 17) | **15** (14, 15, 16) | **19** (19, 19, 16) |
| 50 MiB | **95** (95, 80, 154) | **92** (92, 90, 96) | **127** (127, 192, 93) | **117** (113, 192, 117) |

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
| 1 MiB | 31 | 1 | 260 | 27 | 2 | 238 | 30 | 2 | 244 | 26 | 2 | 237 | 21 | 2 | 164 |
| 10 MiB | 406 | 12 | 1,897 | 390 | 22 | 1,818 | 396 | 20 | 1,805 | 342 | 21 | 1,686 | 269 | 19 | 714 |
| 50 MiB | 2,061 | 58 | 5,706 | 1,989 | 111 | 5,694 | 2,007 | 100 | 5,746 | 1,732 | 105 | 5,641 | 1,353 | 90 | 3,125 |

## Spec 008 criterion 7: parseData against parse

For jsonc and json5 at 10 and 50 MiB, `parseData`'s median time and its retained heap must each be
at most 50% of `parse`'s, in this run. json takes `JSON.parse`, so it is shown but not judged.

| Format | Size | time parseData ÷ parse | heap parseData ÷ parse | Result |
|---|---|---|---|---|
| json | 1 MiB | 6% (6 ÷ 98 ms) | 4% (1 ÷ 31 MiB) | not judged |
| json | 10 MiB | 9% (92 ÷ 1,069 ms) | 3% (12 ÷ 406 MiB) | not judged |
| json | 50 MiB | 6% (446 ÷ 7,746 ms) | 3% (58 ÷ 2,061 MiB) | not judged |
| json-ids | 1 MiB | 38% (39 ÷ 105 ms) | 9% (2 ÷ 27 MiB) | not judged |
| json-ids | 10 MiB | 30% (303 ÷ 1,023 ms) | 6% (22 ÷ 390 MiB) | not judged |
| json-ids | 50 MiB | 18% (1,461 ÷ 7,899 ms) | 6% (111 ÷ 1,989 MiB) | not judged |
| jsonc | 1 MiB | 38% (35 ÷ 92 ms) | 7% (2 ÷ 30 MiB) | not judged |
| jsonc | 10 MiB | 30% (260 ÷ 867 ms) | 5% (20 ÷ 396 MiB) | pass |
| jsonc | 50 MiB | 18% (1,376 ÷ 7,609 ms) | 5% (100 ÷ 2,007 MiB) | pass |
| json5 | 1 MiB | 40% (28 ÷ 70 ms) | 8% (2 ÷ 26 MiB) | not judged |
| json5 | 10 MiB | 27% (184 ÷ 675 ms) | 6% (21 ÷ 342 MiB) | pass |
| json5 | 50 MiB | 13% (882 ÷ 6,534 ms) | 6% (105 ÷ 1,732 MiB) | pass |
| jsonl | 1 MiB | 8% (9 ÷ 107 ms) | 9% (2 ÷ 21 MiB) | not judged |
| jsonl | 10 MiB | 19% (106 ÷ 572 ms) | 7% (19 ÷ 269 MiB) | not judged |
| jsonl | 50 MiB | 17% (593 ÷ 3,588 ms) | 7% (90 ÷ 1,353 MiB) | not judged |

Verdict: criterion 7 holds in this run.

## Spec 012 criterion 12: JSON Lines against one JSON array

`parseData('jsonl')` at 50 MiB must take a median time at most 1.25 times that of
`parseData('json')` on the same records written as one JSON array (`[`, the lines joined by `,`,
`]`), in this run.

| Size | parseData('jsonl') | parseData('json') on the array | jsonl ÷ array | Result |
|---|---|---|---|---|
| 1 MiB | **9** (9, 9, 8) | **8** (9, 8, 8) | 1.13 | not judged |
| 10 MiB | **106** (106, 113, 106) | **99** (99, 98, 100) | 1.07 | not judged |
| 50 MiB | **593** (545, 593, 605) | **541** (524, 541, 553) | 1.10 | pass |

Verdict: criterion 12 holds in this run.

## Spec 015 criterion 11 (core part): parse against the base commit

`parse` of each format at 10 MiB must take a median time at most 1.1 times that of the
base commit's core (`dfff4eaa1752e9adb43fe8efe295ec2ef65f3223`), built and measured in the same job on the same runner.
json-ids is new with spec 015, so the base commit parses it with rounded ids; it is shown, not judged.

| Format | parse (this commit) | parse (base) | this ÷ base | Result |
|---|---|---|---|---|
| json | **1,069** (1,137, 940, 1,069) | **1,031** (1,293, 936, 1,031) | 1.04 | pass |
| json-ids | **1,023** (1,229, 993, 1,023) | **1,143** (1,177, 1,143, 1,033) | 0.89 | not judged |
| jsonc | **867** (946, 840, 867) | **862** (1,070, 854, 862) | 1.01 | pass |
| json5 | **675** (738, 585, 675) | **649** (790, 606, 649) | 1.04 | pass |
| jsonl | **572** (802, 572, 562) | **628** (721, 628, 611) | 0.91 | pass |

Verdict: criterion 11 (core part) holds in this run.

## Spec 015 criterion 11 (webview part): the editor page's parser

The page's parser (`parserFor('json')`, app-shell's `parser.ts` built by `tsc`) against
`JSON.parse` of the same 5 MiB text, in one Node process per document: at most
2× on the json document (no big number: the parser scans for a big-number
candidate, then calls `JSON.parse`) and at most 5× on the json-ids document (every
record's id a big number: lossless-json's parser through core's `readJsonExact`).

| Document | JSON.parse | parserFor('json') | parser ÷ JSON.parse | Limit | Result |
|---|---|---|---|---|---|
| json 5 MiB | **18** (20, 17, 18) | **25** (25, 22, 26) | 1.38 | 2× | pass |
| json-ids 5 MiB | **18** (20, 18, 18) | **102** (102, 110, 100) | 5.61 | 5× | **fail** |

Verdict: **criterion 11 (webview part) does not hold** in this run.

### The big-number scan of each library query (spec 015 B7)

What `exactNumbersLanguage` (app-shell's `query/exact-numbers.ts`) adds to each JSONQuery,
JMESPath and JSONPath query on the same data, as the page holds it: **scan** is
`bigNumberOrigins` on the input (it walks every number; on data with no big number it stops
after `holdsBigNumber`'s walk) and, when there is a big number, `nearestNumbers` of the input;
**restore** is `restoreBigNumbers` on the identity query's result (the whole document, the
worst case). Shown, not judged: criterion 11 sets no bound on it.

| Document | scan | restore | restore outcome |
|---|---|---|---|
| json 5 MiB | **6** (12, 6, 6) | — (nothing to restore) | — |
| json-ids 5 MiB | **78** (78, 80, 72) | **14** (14, 15, 14) | 20496 numbers in this result can't be kept exact. |

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
| jsonc-ids | 6 MiB | 30% (189 ÷ 621 ms) | 6% (12 ÷ 215 MiB) | pass |
| jsonc-ids | 10 MiB | 29% (306 ÷ 1,060 ms) | 5% (20 ÷ 372 MiB) | pass |
| jsonc-ids | 50 MiB | 20% (1,526 ÷ 7,460 ms) | 5% (102 ÷ 1,894 MiB) | pass |
| json5-ids | 6 MiB | 28% (115 ÷ 415 ms) | 7% (14 ÷ 199 MiB) | pass |
| json5-ids | 10 MiB | 26% (188 ÷ 723 ms) | 7% (24 ÷ 333 MiB) | pass |
| json5-ids | 50 MiB | 15% (902 ÷ 5,908 ms) | 7% (118 ÷ 1,695 MiB) | pass |

Verdict: criterion 7 holds with big ids in this run.

## Spec 011 criterion 12: JavaScript and Lodash queries

One run of each bench query in the engine (`runQuery` from `packages/app-shell/src/query`: a
fresh QuickJS runtime and context, Lodash loaded for Lodash, the data copied in, the query, the
result copied out) beside the reference (the library's own `executeQuery` of the same language,
in Node, on the data already in memory, so it copies nothing). The documents are
`bench/generate.mjs`'s JSON files at 1 MiB and 5 MiB, parsed once. Same Node process, `--expose-gc`, heap collected before every timed call; 7 runs per
cell after a warm-up on a 256 KiB document; each cell is **median** (runs), in milliseconds. The engine's
WebAssembly was compiled once before the runs (35 ms; criterion 10 compiles it when Transform first opens).

- **filter-map** (JavaScript, `bench/query/filter-map.js`): `filter` on two fields, then `map` to
  four.
- **filter-orderBy-map** (Lodash, `bench/query/filter-orderBy-map.js`): `_.chain`, `filter`,
  `orderBy` on two keys, `map` with `_.pick`, `.value()`.

| Size | Query | Result items | Engine | Reference | Engine ÷ reference | Same result | Within 2.5 s |
|---|---|---|---|---|---|---|---|
| 1 MiB | filter-map (JavaScript) | 1,897 | **38** (43, 40, 38, 39, 38, 37, 35) | **0** (1, 0, 0, 0, 0, 1, 0) | 101× | yes | not judged |
| 1 MiB | filter-orderBy-map (Lodash) | 1,897 | **106** (106, 100, 103, 101, 116, 113, 116) | **2** (7, 4, 3, 2, 2, 2, 2) | 47× | yes | not judged |
| 5 MiB | filter-map (JavaScript) | 9,416 | **166** (166, 166, 169, 162, 164, 167, 161) | **2** (2, 2, 2, 2, 2, 2, 2) | 100× | yes | yes |
| 5 MiB | filter-orderBy-map (Lodash) | 9,416 | **437** (434, 433, 439, 437, 441, 436, 437) | **13** (13, 13, 15, 12, 14, 13, 13) | 33× | yes | yes |

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
| 1 MiB | jsonpath-filter | `$[?(@.active == true && @.score > 50)]` | `$[?(@.active == true && @.score > 50)]` | 1,897 | **6** (11, 6, 11, 3, 5, 8, 5) | **7** (12, 9, 7, 6, 7, 6, 5) | 0.9× | yes | not judged |
| 1 MiB | jsonpath-descendant | `$..zip` | `$..zip` | 4,372 | **30** (30, 29, 30, 56, 26, 32, 30) | **15** (15, 13, 13, 15, 15, 15, 17) | 2.0× | yes | not judged |
| 1 MiB | jsonpath-match | `$[?match(@.name, 'alpha-.*')]` | `$[?(@.name.match(/^alpha-.*$/))]` | 547 | **6** (10, 6, 4, 7, 5, 7, 4) | **5** (6, 5, 5, 5, 5, 4, 5) | 1.3× | yes | not judged |
| 1 MiB | jsonpath-pick | `$[*].name` | `$[*].name` | 4,372 | **3** (5, 3, 3, 5, 3, 6, 2) | **2** (6, 2, 2, 2, 2, 3, 2) | 1.6× | yes | not judged |
| 5 MiB | jsonpath-filter | `$[?(@.active == true && @.score > 50)]` | `$[?(@.active == true && @.score > 50)]` | 9,416 | **34** (31, 32, 33, 37, 34, 36, 38) | **25** (27, 24, 25, 26, 23, 28, 25) | 1.3× | yes | yes |
| 5 MiB | jsonpath-descendant | `$..zip` | `$..zip` | 21,726 | **101** (100, 101, 101, 100, 102, 103, 103) | **37** (43, 37, 37, 34, 39, 37, 40) | 2.7× | yes | yes |
| 5 MiB | jsonpath-match | `$[?match(@.name, 'alpha-.*')]` | `$[?(@.name.match(/^alpha-.*$/))]` | 2,716 | **30** (34, 29, 33, 30, 28, 30, 31) | **16** (19, 16, 18, 15, 15, 16, 16) | 1.8× | yes | yes |
| 5 MiB | jsonpath-pick | `$[*].name` | `$[*].name` | 21,726 | **17** (17, 18, 17, 18, 16, 19, 17) | **13** (12, 13, 12, 13, 13, 14, 14) | 1.3× | yes | yes |

Verdict: every JSONPath (RFC 9535) bench query at 5 MiB takes at most 1 s in this run (criterion 10).

## Spec 010 criterion 11: smart format

`smartFormat(text, format)` (FracturedJson 5.1.0 with spec 010 §Layout, 010 T2) beside
Format's `getAdapter(format).prettyPrint(text)`, on the same files at 1 MiB and at the 5 MiB
threshold above which smart format is off (criterion 10). Each call parses the text it formats.
HYPOTHESIS: the 5 MiB median is under 5,000 ms on the CI runner.

| Format | Size | smartFormat | prettyPrint | smartFormat ÷ prettyPrint | output size |
|---|---|---|---|---|---|
| json | 1 MiB | **288** (288, 311, 286) | **123** (114, 123, 123) | 2.3× | 0.92 MiB |
| json | 5 MiB | **1,185** (1,185, 1,201, 1,099) | **512** (495, 557, 512) | 2.3× | 4.61 MiB |
| jsonc | 1 MiB | **347** (347, 347, 298) | **109** (109, 112, 106) | 3.2× | 1.06 MiB |
| jsonc | 5 MiB | **1,228** (1,282, 1,228, 1,123) | **477** (469, 477, 489) | 2.6× | 5.29 MiB |
| json5 | 1 MiB | **401** (469, 401, 364) | **101** (100, 118, 101) | 4.0× | 1.06 MiB |
| json5 | 5 MiB | **1,630** (1,788, 1,630, 1,429) | **491** (491, 445, 518) | 3.3× | 5.31 MiB |

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
| yaml | 1 MiB | 6,433 | **702** (702, 643, 747) | 3 MiB | 191 MiB |
| yaml | 5 MiB | 31,845 | **3,317** (3,144, 3,317, 3,686) | 15 MiB | 539 MiB |
| yaml | 10 MiB | 63,556 | **6,516** (6,208, 7,381, 6,516) | 30 MiB | 981 MiB |
| yaml | 20 MiB | 126,655 | **12,612** (13,041, 12,612, 12,606) | 60 MiB | 1,855 MiB |
| toml | 1 MiB | 6,763 | **53** (53, 61, 42) | 2 MiB | 123 MiB |
| toml | 5 MiB | 33,460 | **309** (337, 309, 292) | 12 MiB | 225 MiB |
| toml | 10 MiB | 66,779 | **559** (562, 559, 555) | 24 MiB | 354 MiB |
| toml | 50 MiB | 330,404 | **2,776** (2,776, 2,622, 2,803) | 118 MiB | 1,221 MiB |
| xml | 1 MiB | 4,164 | **58** (61, 57, 58) | 2 MiB | 102 MiB |
| xml | 5 MiB | 20,701 | **250** (288, 248, 250) | 10 MiB | 116 MiB |
| xml | 10 MiB | 41,315 | **567** (574, 567, 476) | 19 MiB | 144 MiB |
| xml | 50 MiB | 205,400 | **2,597** (2,597, 2,471, 2,812) | 96 MiB | 316 MiB |

TOML and XML verdict: both 5 MiB medians are within 2,000 ms in this run.

UNK-077 (the YAML limit): the largest of 5, 10, 20, 50 MiB where the median is under
10,000 ms and the retained heap under 1.5 GiB; if 5 MiB misses, the limit is the 5 MiB threshold.
Result: **10 MiB** (20 MiB misses: median 12,612 ms, retained heap 60 MiB).

## Against UNK-014's edit budget (< 500 ms)

applyPatch is only the host part of an edit: the UI, the message and `workspace.applyEdit` come on
top (`bench/vscode-open.md`). So a cell over 500 ms here misses the budget whatever else happens;
one under it is necessary, not sufficient. The cells use the host's case, a text already parsed.

| Size | json | json-ids | jsonc | json5 | jsonl |
|---|---|---|---|---|---|
| 1 MiB | within, slowest op 32 | within, slowest op 38 | within, slowest op 38 | within, slowest op 48 | within, slowest op 2 |
| 10 MiB | within, slowest op 454 | within, slowest op 329 | within, slowest op 272 | within, slowest op 338 | within, slowest op 19 |
| 50 MiB | over, slowest op 2,513 | over, slowest op 2,063 | over, slowest op 2,021 | over, slowest op 1,740 | within, slowest op 127 |

Medians relative to parse, over all sizes and formats (edit ÷ parse): replace 0.1–1.0×, add 0.1–1.0×, remove 0.1–1.1×, move 0.1–1.6×.

An edit on a text core has not parsed parses it once (tree and tokens) before it edits, so its
time grows with file size like parse time does. On a parsed text, replace, add and remove only
compute the change and write the new text; move also shifts the tree and tokens after the
removed record.

To reproduce: `pnpm --filter @chr-json-editor/core build`, then
`pnpm --filter @chr-json-editor/bench bench:core` (or the `bench` workflow, `.github/workflows/bench.yml`),
which also runs the query benchmarks (`bench/query/run.mjs`) and the import benchmark (017 T4).
