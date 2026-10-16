# Core benchmark: parse and one edit per format (002 T8)

> Spec 002 criterion 7, spec 008 criterion 7, spec 010 criterion 11, spec 012 criterion 12, spec 011 criterion 12, spec 014 criterion 10, spec 015 criterion 11 (core part), spec 015 criterion 11 (webview part), UNK-068 (spec 008 criterion 7 on big ids), spec 017 criterion 10, spec 016 criterion 9. Written by `bench/core/report.mjs` from one benchmark run; do not edit
> by hand. Re-run it (the `bench` workflow) whenever `packages/core/src/formats` or `packages/app-shell/src/query` or `packages/core/src/import` changes speed.

## Run

- Where: GitHub Actions, [run 38668404847](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/38668404847); commit `f41b53e6e38d6673c1be71e5c1032094c14a0612`.
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
| 1 MiB | **141** (172, 140, 141) | **7** (8, 7, 7) | **108** (108, 107, 109) | **113** (109, 115, 113) | **94** (113, 94, 89) | **119** (119, 121, 115) |
| 10 MiB | **1,126** (1,335, 1,046, 1,126) | **74** (72, 74, 74) | **825** (913, 825, 793) | **816** (816, 837, 809) | **817** (817, 830, 805) | **1,289** (1,289, 1,318, 1,275) |
| 50 MiB | **9,175** (10,341, 9,027, 9,175) | **434** (432, 434, 437) | **7,198** (7,223, 6,328, 7,198) | **7,267** (7,046, 7,326, 7,267) | **7,356** (7,020, 7,394, 7,356) | **11,094** (10,251, 11,199, 11,094) |

After the text was parsed (json):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **31** (32, 26, 31) |
| 10 MiB | **0** (0, 0, 0) | **3** (2, 3, 3) | **0** (0, 0, 0) | **465** (465, 452, 476) |
| 50 MiB | **0** (0, 0, 0) | **18** (18, 18, 18) | **0** (0, 0, 0) | **2,740** (2,736, 2,740, 2,743) |

### json-ids

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **133** (159, 123, 133) | **55** (55, 52, 57) | **92** (92, 100, 91) | **96** (96, 100, 93) | **95** (97, 95, 93) | **125** (123, 125, 125) |
| 10 MiB | **1,176** (1,428, 1,124, 1,176) | **378** (378, 381, 376) | **849** (849, 883, 846) | **869** (869, 905, 856) | **852** (844, 890, 852) | **1,299** (1,299, 1,315, 1,278) |
| 50 MiB | **9,131** (10,354, 7,770, 9,131) | **1,985** (1,938, 1,985, 2,005) | **6,291** (7,079, 6,291, 6,129) | **6,277** (6,009, 6,277, 6,985) | **6,377** (6,221, 6,377, 7,037) | **9,841** (9,796, 10,071, 9,841) |

After the text was parsed (json-ids):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **29** (29, 27, 29) |
| 10 MiB | **0** (0, 0, 0) | **3** (3, 3, 3) | **0** (0, 3, 0) | **443** (447, 438, 443) |
| 50 MiB | **0** (0, 0, 0) | **19** (19, 19, 19) | **0** (0, 0, 0) | **2,378** (2,370, 2,378, 2,386) |

### jsonc

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **125** (135, 125, 119) | **53** (53, 49, 53) | **92** (92, 94, 87) | **90** (95, 88, 90) | **92** (92, 89, 94) | **130** (130, 127, 134) |
| 10 MiB | **1,062** (1,176, 1,062, 1,038) | **327** (318, 331, 327) | **742** (742, 750, 733) | **757** (763, 754, 757) | **754** (754, 758, 750) | **998** (998, 1,011, 988) |
| 50 MiB | **7,751** (8,256, 7,680, 7,751) | **1,643** (1,643, 1,673, 1,619) | **6,779** (6,922, 6,779, 6,767) | **6,872** (6,897, 6,872, 6,756) | **6,894** (6,944, 6,894, 5,973) | **9,575** (9,575, 9,575, 9,635) |

After the text was parsed (jsonc):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **42** (42, 40, 43) |
| 10 MiB | **0** (0, 0, 0) | **3** (3, 5, 2) | **0** (0, 0, 0) | **240** (240, 232, 244) |
| 50 MiB | **0** (0, 0, 0) | **19** (19, 18, 19) | **0** (0, 1, 0) | **1,291** (1,289, 1,291, 1,311) |

### json5

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **70** (88, 70, 68) | **29** (29, 28, 31) | **71** (68, 73, 71) | **69** (75, 65, 69) | **68** (67, 68, 70) | **121** (122, 121, 120) |
| 10 MiB | **629** (793, 629, 614) | **195** (196, 192, 195) | **633** (631, 633, 635) | **648** (648, 635, 656) | **639** (666, 623, 639) | **924** (936, 924, 915) |
| 50 MiB | **6,932** (6,932, 7,122, 6,246) | **956** (956, 956, 958) | **6,443** (6,443, 6,394, 6,520) | **6,484** (6,484, 6,612, 6,407) | **6,539** (6,539, 6,546, 6,538) | **10,621** (10,621, 9,705, 10,716) |

After the text was parsed (json5):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **47** (47, 44, 47) |
| 10 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **275** (292, 272, 275) |
| 50 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **1,861** (1,895, 1,861, 1,854) |

### jsonl

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **110** (111, 105, 110) | **12** (12, 12, 12) | **14** (15, 14, 14) | **14** (14, 13, 14) | **14** (14, 13, 14) | **14** (14, 13, 14) |
| 10 MiB | **752** (916, 746, 752) | **139** (139, 140, 137) | **145** (160, 145, 145) | **144** (158, 142, 144) | **145** (159, 141, 145) | **147** (160, 146, 147) |
| 50 MiB | **4,011** (5,014, 3,994, 4,011) | **715** (716, 713, 715) | **762** (894, 762, 755) | **766** (892, 753, 766) | **768** (875, 758, 768) | **774** (894, 772, 774) |

After the text was parsed (jsonl):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **3** (3, 2, 3) | **3** (3, 2, 3) | **2** (2, 2, 2) | **3** (3, 3, 3) |
| 10 MiB | **20** (19, 22, 20) | **21** (30, 20, 21) | **20** (18, 21, 20) | **26** (24, 28, 26) |
| 50 MiB | **113** (111, 113, 144) | **110** (110, 110, 111) | **109** (109, 109, 108) | **137** (137, 146, 137) |

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
| 1 MiB | 31 | 1 | 258 | 27 | 2 | 241 | 30 | 2 | 255 | 26 | 2 | 245 | 21 | 2 | 165 |
| 10 MiB | 406 | 12 | 1,884 | 390 | 22 | 1,797 | 396 | 20 | 1,808 | 342 | 21 | 1,701 | 269 | 19 | 714 |
| 50 MiB | 2,061 | 58 | 5,893 | 1,989 | 111 | 5,943 | 2,007 | 100 | 5,690 | 1,732 | 105 | 5,564 | 1,353 | 90 | 3,132 |

## Spec 008 criterion 7: parseData against parse

For jsonc and json5 at 10 and 50 MiB, `parseData`'s median time and its retained heap must each be
at most 50% of `parse`'s, in this run. json takes `JSON.parse`, so it is shown but not judged.

| Format | Size | time parseData ÷ parse | heap parseData ÷ parse | Result |
|---|---|---|---|---|
| json | 1 MiB | 5% (7 ÷ 141 ms) | 4% (1 ÷ 31 MiB) | not judged |
| json | 10 MiB | 7% (74 ÷ 1,126 ms) | 3% (12 ÷ 406 MiB) | not judged |
| json | 50 MiB | 5% (434 ÷ 9,175 ms) | 3% (58 ÷ 2,061 MiB) | not judged |
| json-ids | 1 MiB | 41% (55 ÷ 133 ms) | 9% (2 ÷ 27 MiB) | not judged |
| json-ids | 10 MiB | 32% (378 ÷ 1,176 ms) | 6% (22 ÷ 390 MiB) | not judged |
| json-ids | 50 MiB | 22% (1,985 ÷ 9,131 ms) | 6% (111 ÷ 1,989 MiB) | not judged |
| jsonc | 1 MiB | 42% (53 ÷ 125 ms) | 7% (2 ÷ 30 MiB) | not judged |
| jsonc | 10 MiB | 31% (327 ÷ 1,062 ms) | 5% (20 ÷ 396 MiB) | pass |
| jsonc | 50 MiB | 21% (1,643 ÷ 7,751 ms) | 5% (100 ÷ 2,007 MiB) | pass |
| json5 | 1 MiB | 42% (29 ÷ 70 ms) | 8% (2 ÷ 26 MiB) | not judged |
| json5 | 10 MiB | 31% (195 ÷ 629 ms) | 6% (21 ÷ 342 MiB) | pass |
| json5 | 50 MiB | 14% (956 ÷ 6,932 ms) | 6% (105 ÷ 1,732 MiB) | pass |
| jsonl | 1 MiB | 11% (12 ÷ 110 ms) | 9% (2 ÷ 21 MiB) | not judged |
| jsonl | 10 MiB | 19% (139 ÷ 752 ms) | 7% (19 ÷ 269 MiB) | not judged |
| jsonl | 50 MiB | 18% (715 ÷ 4,011 ms) | 7% (90 ÷ 1,353 MiB) | not judged |

Verdict: criterion 7 holds in this run.

## Spec 012 criterion 12: JSON Lines against one JSON array

`parseData('jsonl')` at 50 MiB must take a median time at most 1.25 times that of
`parseData('json')` on the same records written as one JSON array (`[`, the lines joined by `,`,
`]`), in this run.

| Size | parseData('jsonl') | parseData('json') on the array | jsonl ÷ array | Result |
|---|---|---|---|---|
| 1 MiB | **12** (12, 12, 12) | **10** (10, 10, 10) | 1.22 | not judged |
| 10 MiB | **139** (139, 140, 137) | **116** (116, 123, 115) | 1.20 | not judged |
| 50 MiB | **715** (716, 713, 715) | **632** (627, 654, 632) | 1.13 | pass |

Verdict: criterion 12 holds in this run.

## Spec 015 criterion 11 (core part): parse against the base commit

`parse` of each format at 10 MiB must take a median time at most 1.1 times that of the
base commit's core (`ecbd04362154a88ab1b739d069b2ffe926eb135a`), built and measured in the same job on the same runner.
json-ids is new with spec 015, so the base commit parses it with rounded ids; it is shown, not judged.

| Format | parse (this commit) | parse (base) | this ÷ base | Result |
|---|---|---|---|---|
| json | **1,126** (1,335, 1,046, 1,126) | **1,125** (1,381, 1,096, 1,125) | 1.00 | pass |
| json-ids | **1,176** (1,428, 1,124, 1,176) | **1,234** (1,448, 1,184, 1,234) | 0.95 | not judged |
| jsonc | **1,062** (1,176, 1,062, 1,038) | **1,049** (1,198, 1,049, 1,030) | 1.01 | pass |
| json5 | **629** (793, 629, 614) | **612** (764, 612, 588) | 1.03 | pass |
| jsonl | **752** (916, 746, 752) | **777** (947, 773, 777) | 0.97 | pass |

Verdict: criterion 11 (core part) holds in this run.

## Spec 015 criterion 11 (webview part): the editor page's parser

The page's parser (`parserFor('json')`, app-shell's `parser.ts` built by `tsc`) against
`JSON.parse` of the same 5 MiB text, in one Node process per document: at most
2× on the json document (no big number: the parser scans for a big-number
candidate, then calls `JSON.parse`) and at most 5× on the json-ids document (every
record's id a big number: lossless-json's parser through core's `readJsonExact`).

| Document | JSON.parse | parserFor('json') | parser ÷ JSON.parse | Limit | Result |
|---|---|---|---|---|---|
| json 5 MiB | **22** (24, 22, 22) | **30** (30, 30, 29) | 1.32 | 2× | pass |
| json-ids 5 MiB | **25** (25, 26, 25) | **124** (126, 123, 124) | 4.93 | 5× | pass |

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
| json 5 MiB | **8** (13, 7, 8) | — (nothing to restore) | — |
| json-ids 5 MiB | **103** (103, 103, 97) | **16** (14, 16, 18) | 20496 numbers in this result can't be kept exact. |

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
| jsonc-ids | 6 MiB | 28% (198 ÷ 698 ms) | 6% (13 ÷ 215 MiB) | pass |
| jsonc-ids | 10 MiB | 28% (317 ÷ 1,149 ms) | 6% (21 ÷ 372 MiB) | pass |
| jsonc-ids | 50 MiB | 19% (1,633 ÷ 8,618 ms) | 5% (104 ÷ 1,894 MiB) | pass |
| json5-ids | 6 MiB | 31% (119 ÷ 390 ms) | 7% (14 ÷ 199 MiB) | pass |
| json5-ids | 10 MiB | 28% (189 ÷ 666 ms) | 7% (24 ÷ 333 MiB) | pass |
| json5-ids | 50 MiB | 17% (957 ÷ 5,590 ms) | 7% (118 ÷ 1,695 MiB) | pass |

Verdict: criterion 7 holds with big ids in this run.

## Spec 011 criterion 12: JavaScript and Lodash queries

One run of each bench query in the engine (`runQuery` from `packages/app-shell/src/query`: a
fresh QuickJS runtime and context, Lodash loaded for Lodash, the data copied in, the query, the
result copied out) beside the reference (the library's own `executeQuery` of the same language,
in Node, on the data already in memory, so it copies nothing). The documents are
`bench/generate.mjs`'s JSON files at 1 MiB and 5 MiB, parsed once. Same Node process, `--expose-gc`, heap collected before every timed call; 7 runs per
cell after a warm-up on a 256 KiB document; each cell is **median** (runs), in milliseconds. The engine's
WebAssembly was compiled once before the runs (36 ms; criterion 10 compiles it when Transform first opens).

- **filter-map** (JavaScript, `bench/query/filter-map.js`): `filter` on two fields, then `map` to
  four.
- **filter-orderBy-map** (Lodash, `bench/query/filter-orderBy-map.js`): `_.chain`, `filter`,
  `orderBy` on two keys, `map` with `_.pick`, `.value()`.

| Size | Query | Result items | Engine | Reference | Engine ÷ reference | Same result | Within 2.5 s |
|---|---|---|---|---|---|---|---|
| 1 MiB | filter-map (JavaScript) | 1,897 | **53** (55, 56, 55, 52, 52, 53, 51) | **1** (1, 1, 0, 1, 1, 1, 1) | 98× | yes | not judged |
| 1 MiB | filter-orderBy-map (Lodash) | 1,897 | **159** (162, 161, 158, 157, 159, 156, 159) | **5** (13, 6, 4, 5, 4, 5, 4) | 34× | yes | not judged |
| 5 MiB | filter-map (JavaScript) | 9,416 | **234** (236, 233, 234, 233, 232, 238, 234) | **2** (3, 2, 2, 2, 2, 3, 2) | 95× | yes | yes |
| 5 MiB | filter-orderBy-map (Lodash) | 9,416 | **715** (699, 715, 725, 720, 716, 710, 707) | **17** (19, 17, 17, 15, 16, 15, 17) | 42× | yes | yes |

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
| 1 MiB | jsonpath-filter | `$[?(@.active == true && @.score > 50)]` | `$[?(@.active == true && @.score > 50)]` | 1,897 | **19** (20, 19, 18, 20, 18, 21, 19) | **10** (11, 10, 10, 11, 10, 8, 10) | 1.9× | yes | not judged |
| 1 MiB | jsonpath-descendant | `$..zip` | `$..zip` | 4,372 | **38** (39, 38, 38, 39, 36, 37, 34) | **16** (16, 15, 16, 16, 16, 17, 16) | 2.4× | yes | not judged |
| 1 MiB | jsonpath-match | `$[?match(@.name, 'alpha-.*')]` | `$[?(@.name.match(/^alpha-.*$/))]` | 547 | **15** (17, 9, 16, 5, 15, 9, 15) | **8** (10, 8, 10, 7, 9, 7, 8) | 2.0× | yes | not judged |
| 1 MiB | jsonpath-pick | `$[*].name` | `$[*].name` | 4,372 | **7** (7, 4, 7, 5, 7, 8, 8) | **5** (5, 3, 5, 5, 5, 5, 5) | 1.4× | yes | not judged |
| 5 MiB | jsonpath-filter | `$[?(@.active == true && @.score > 50)]` | `$[?(@.active == true && @.score > 50)]` | 9,416 | **39** (42, 38, 40, 40, 39, 37, 39) | **32** (31, 32, 31, 33, 33, 32, 35) | 1.2× | yes | yes |
| 5 MiB | jsonpath-descendant | `$..zip` | `$..zip` | 21,726 | **141** (142, 140, 140, 141, 142, 138, 145) | **43** (42, 43, 42, 44, 44, 43, 42) | 3.3× | yes | yes |
| 5 MiB | jsonpath-match | `$[?match(@.name, 'alpha-.*')]` | `$[?(@.name.match(/^alpha-.*$/))]` | 2,716 | **38** (33, 42, 37, 39, 35, 42, 38) | **23** (23, 24, 24, 23, 23, 24, 23) | 1.6× | yes | yes |
| 5 MiB | jsonpath-pick | `$[*].name` | `$[*].name` | 21,726 | **22** (22, 24, 22, 24, 20, 23, 21) | **14** (13, 14, 14, 15, 14, 13, 13) | 1.6× | yes | yes |

Verdict: every JSONPath (RFC 9535) bench query at 5 MiB takes at most 1 s in this run (criterion 10).

## Spec 010 criterion 11: smart format

`smartFormat(text, format)` (FracturedJson 5.1.0 with spec 010 §Layout, 010 T2) beside
Format's `getAdapter(format).prettyPrint(text)`, on the same files at 1 MiB and at the 5 MiB
threshold above which smart format is off (criterion 10). Each call parses the text it formats.
HYPOTHESIS: the 5 MiB median is under 5,000 ms on the CI runner.

| Format | Size | smartFormat | prettyPrint | smartFormat ÷ prettyPrint | output size |
|---|---|---|---|---|---|
| json | 1 MiB | **345** (367, 345, 316) | **120** (112, 128, 120) | 2.9× | 0.92 MiB |
| json | 5 MiB | **1,314** (1,441, 1,314, 1,228) | **542** (535, 568, 542) | 2.4× | 4.61 MiB |
| jsonc | 1 MiB | **388** (405, 388, 339) | **116** (113, 116, 126) | 3.3× | 1.06 MiB |
| jsonc | 5 MiB | **1,403** (1,462, 1,403, 1,275) | **530** (517, 530, 537) | 2.6× | 5.29 MiB |
| json5 | 1 MiB | **453** (510, 453, 408) | **105** (105, 105, 108) | 4.3× | 1.06 MiB |
| json5 | 5 MiB | **1,749** (1,953, 1,749, 1,596) | **490** (490, 489, 500) | 3.6× | 5.31 MiB |

Verdict: the hypothesis holds in this run (every 5 MiB median is under 5,000 ms).

## Spec 016 criterion 9: JSON Schema generation

`generateSchema(data, 'draft-07')` (016 T1, the dialect the command writes) on the data
`parseData('json', text)` gives, beside that `parseData`, on the json file at the 5 MiB
threshold and at 50 MiB, both in the same process. Criterion 9: at each size the median
`generateSchema` time is at most the median `parseData` time of the same document in this run.

| Size | Records | generateSchema | parseData | generateSchema ÷ parseData | schema file |
|---|---|---|---|---|---|
| 5 MiB | 21,726 | **20** (20, 29, 12) | **30** (30, 29, 31) | 0.67× | 949 B |
| 50 MiB | 215,488 | **151** (151, 156, 123) | **358** (358, 367, 350) | 0.42× | 949 B |

Verdict: the bound holds in this run (at 5 and 50 MiB `generateSchema` takes at most the time of `parseData`).

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
| yaml | 1 MiB | 6,433 | **913** (870, 920, 913) | 3 MiB | 189 MiB |
| yaml | 5 MiB | 31,845 | **4,317** (4,317, 4,461, 4,172) | 15 MiB | 540 MiB |
| yaml | 10 MiB | 63,556 | **8,697** (8,823, 8,678, 8,697) | 30 MiB | 979 MiB |
| yaml | 20 MiB | 126,655 | **17,226** (17,286, 17,226, 17,074) | 59 MiB | 1,853 MiB |
| toml | 1 MiB | 6,763 | **65** (74, 56, 65) | 2 MiB | 125 MiB |
| toml | 5 MiB | 33,460 | **338** (348, 338, 335) | 12 MiB | 222 MiB |
| toml | 10 MiB | 66,779 | **660** (660, 662, 651) | 24 MiB | 343 MiB |
| toml | 50 MiB | 330,404 | **3,525** (3,513, 3,525, 3,571) | 118 MiB | 1,219 MiB |
| xml | 1 MiB | 4,164 | **88** (88, 77, 147) | 2 MiB | 105 MiB |
| xml | 5 MiB | 20,701 | **357** (357, 363, 354) | 10 MiB | 121 MiB |
| xml | 10 MiB | 41,315 | **702** (720, 691, 702) | 19 MiB | 142 MiB |
| xml | 50 MiB | 205,400 | **3,490** (3,490, 3,499, 3,470) | 96 MiB | 320 MiB |

TOML and XML verdict: both 5 MiB medians are within 2,000 ms in this run.

UNK-077 (the YAML limit): the largest of 5, 10, 20, 50 MiB where the median is under
10,000 ms and the retained heap under 1.5 GiB; if 5 MiB misses, the limit is the 5 MiB threshold.
Result: **10 MiB** (20 MiB misses: median 17,226 ms, retained heap 59 MiB).

## Against UNK-014's edit budget (< 500 ms)

applyPatch is only the host part of an edit: the UI, the message and `workspace.applyEdit` come on
top (`bench/vscode-open.md`). So a cell over 500 ms here misses the budget whatever else happens;
one under it is necessary, not sufficient. The cells use the host's case, a text already parsed.

| Size | json | json-ids | jsonc | json5 | jsonl |
|---|---|---|---|---|---|
| 1 MiB | within, slowest op 31 | within, slowest op 29 | within, slowest op 42 | within, slowest op 47 | within, slowest op 3 |
| 10 MiB | within, slowest op 465 | within, slowest op 443 | within, slowest op 240 | within, slowest op 275 | within, slowest op 26 |
| 50 MiB | over, slowest op 2,740 | over, slowest op 2,378 | over, slowest op 1,291 | over, slowest op 1,861 | within, slowest op 137 |

Medians relative to parse, over all sizes and formats (edit ÷ parse): replace 0.1–1.0×, add 0.1–1.0×, remove 0.1–1.0×, move 0.1–1.7×.

An edit on a text core has not parsed parses it once (tree and tokens) before it edits, so its
time grows with file size like parse time does. On a parsed text, replace, add and remove only
compute the change and write the new text; move also shifts the tree and tokens after the
removed record.

To reproduce: `pnpm --filter @chr-json-editor/core build`, then
`pnpm --filter @chr-json-editor/bench bench:core` (or the `bench` workflow, `.github/workflows/bench.yml`),
which also runs the query benchmarks (`bench/query/run.mjs`) and the import benchmark (017 T4).
