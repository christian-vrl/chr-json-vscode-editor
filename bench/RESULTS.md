# Core benchmark: parse and one edit per format (002 T8)

> Spec 002 criterion 7, spec 008 criterion 7, spec 010 criterion 11, spec 012 criterion 12, spec 011 criterion 12, spec 015 criterion 11 (core part). Written by `bench/core/report.mjs` from one benchmark run; do not edit
> by hand. Re-run it (the `bench` workflow) whenever `packages/core/src/formats` or `packages/app-shell/src/query` changes speed.

## Run

- Where: GitHub Actions, [run 38445526156](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/38445526156); commit `4679bc866d932ae552d49e20de0bf311d37c4a31`.
- Machine: Linux x64 (`ubuntu24`), 4 × AMD EPYC 9V74 80-Core Processor, 16 GiB RAM.
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
| 1 MiB | **93** (116, 92, 93) | **6** (6, 6, 6) | **69** (69, 71, 68) | **71** (68, 77, 71) | **73** (73, 76, 69) | **95** (95, 94, 96) |
| 10 MiB | **883** (1,036, 833, 883) | **60** (61, 60, 59) | **615** (615, 628, 607) | **629** (629, 647, 618) | **664** (664, 675, 626) | **1,040** (1,041, 1,040, 1,038) |
| 50 MiB | **7,644** (8,418, 7,611, 7,644) | **363** (363, 375, 363) | **6,212** (6,251, 6,212, 5,390) | **6,080** (6,080, 6,323, 5,563) | **6,296** (6,411, 6,296, 6,250) | **9,749** (9,865, 9,749, 9,704) |

After the text was parsed (json):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **26** (27, 24, 26) |
| 10 MiB | **0** (0, 0, 0) | **2** (2, 2, 2) | **0** (0, 0, 0) | **391** (391, 385, 393) |
| 50 MiB | **0** (0, 0, 0) | **9** (8, 9, 9) | **0** (0, 0, 0) | **2,456** (2,456, 2,437, 2,473) |

### json-ids

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **99** (124, 94, 99) | **40** (42, 37, 40) | **72** (72, 75, 71) | **74** (73, 75, 74) | **74** (72, 77, 74) | **105** (102, 107, 105) |
| 10 MiB | **931** (1,120, 910, 931) | **286** (283, 287, 286) | **691** (691, 705, 682) | **739** (743, 739, 683) | **710** (740, 710, 688) | **1,086** (1,086, 1,098, 1,068) |
| 50 MiB | **7,764** (8,817, 7,461, 7,764) | **1,532** (1,535, 1,521, 1,532) | **6,095** (6,095, 6,116, 5,963) | **6,078** (6,078, 6,100, 5,942) | **6,031** (6,083, 6,031, 5,119) | **9,213** (8,208, 9,404, 9,213) |

After the text was parsed (json-ids):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **35** (36, 26, 35) |
| 10 MiB | **0** (0, 0, 0) | **2** (2, 2, 2) | **0** (0, 0, 0) | **383** (383, 387, 381) |
| 50 MiB | **0** (0, 0, 0) | **7** (7, 8, 7) | **0** (0, 0, 0) | **2,062** (2,062, 2,085, 2,059) |

### jsonc

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **92** (104, 91, 92) | **38** (37, 38, 40) | **68** (69, 67, 68) | **69** (68, 69, 71) | **71** (72, 70, 71) | **104** (101, 104, 104) |
| 10 MiB | **752** (884, 752, 748) | **238** (247, 238, 234) | **531** (524, 531, 547) | **562** (562, 553, 564) | **558** (560, 558, 549) | **894** (895, 891, 894) |
| 50 MiB | **5,805** (7,631, 5,805, 5,791) | **1,218** (1,249, 1,196, 1,218) | **5,709** (4,920, 5,721, 5,709) | **5,719** (5,729, 5,709, 5,719) | **4,940** (5,749, 4,718, 4,940) | **8,207** (8,244, 8,179, 8,207) |

After the text was parsed (jsonc):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **34** (37, 33, 34) |
| 10 MiB | **0** (0, 0, 0) | **2** (2, 2, 2) | **0** (0, 0, 0) | **322** (338, 314, 322) |
| 50 MiB | **0** (0, 0, 0) | **8** (7, 8, 8) | **0** (0, 0, 0) | **1,159** (1,159, 1,148, 1,183) |

### json5

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **51** (65, 49, 51) | **23** (24, 21, 23) | **54** (54, 53, 56) | **50** (50, 52, 49) | **50** (49, 50, 53) | **94** (96, 94, 94) |
| 10 MiB | **490** (611, 485, 490) | **145** (145, 140, 146) | **486** (495, 486, 479) | **499** (499, 507, 499) | **495** (495, 493, 507) | **734** (734, 738, 732) |
| 50 MiB | **5,589** (6,196, 5,589, 5,499) | **731** (731, 723, 740) | **4,613** (4,613, 5,501, 4,557) | **4,712** (4,712, 5,656, 4,693) | **5,706** (5,706, 4,698, 5,764) | **8,520** (8,686, 8,520, 7,517) |

After the text was parsed (json5):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **39** (39, 38, 39) |
| 10 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **243** (254, 237, 243) |
| 50 MiB | **0** (1, 0, 0) | **1** (1, 1, 0) | **0** (0, 0, 0) | **1,366** (1,373, 1,364, 1,366) |

### jsonl

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **91** (97, 91, 89) | **9** (9, 9, 9) | **11** (12, 11, 11) | **11** (13, 11, 11) | **10** (11, 10, 10) | **11** (12, 10, 11) |
| 10 MiB | **628** (820, 628, 614) | **106** (107, 106, 106) | **117** (133, 117, 116) | **124** (130, 122, 124) | **125** (130, 122, 125) | **121** (126, 118, 121) |
| 50 MiB | **3,581** (4,294, 3,510, 3,581) | **554** (554, 569, 550) | **599** (706, 599, 598) | **600** (711, 599, 600) | **606** (725, 606, 606) | **611** (730, 611, 611) |

After the text was parsed (jsonl):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **2** (3, 2, 2) | **2** (2, 2, 5) | **2** (2, 2, 2) | **2** (2, 2, 3) |
| 10 MiB | **17** (15, 17, 18) | **18** (14, 18, 19) | **17** (15, 17, 18) | **21** (18, 21, 21) |
| 50 MiB | **88** (87, 88, 89) | **87** (87, 87, 89) | **87** (87, 86, 88) | **109** (110, 109, 109) |

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
| 1 MiB | 31 | 1 | 253 | 27 | 2 | 234 | 28 | 2 | 241 | 26 | 2 | 238 | 21 | 2 | 158 |
| 10 MiB | 406 | 12 | 1,879 | 390 | 22 | 1,814 | 396 | 20 | 1,785 | 342 | 21 | 1,700 | 269 | 19 | 710 |
| 50 MiB | 2,061 | 58 | 5,677 | 1,989 | 111 | 5,947 | 2,007 | 100 | 5,895 | 1,732 | 105 | 5,709 | 1,353 | 90 | 3,125 |

## Spec 008 criterion 7: parseData against parse

For jsonc and json5 at 10 and 50 MiB, `parseData`'s median time and its retained heap must each be
at most 50% of `parse`'s, in this run. json takes `JSON.parse`, so it is shown but not judged.

| Format | Size | time parseData ÷ parse | heap parseData ÷ parse | Result |
|---|---|---|---|---|
| json | 1 MiB | 6% (6 ÷ 93 ms) | 4% (1 ÷ 31 MiB) | not judged |
| json | 10 MiB | 7% (60 ÷ 883 ms) | 3% (12 ÷ 406 MiB) | not judged |
| json | 50 MiB | 5% (363 ÷ 7,644 ms) | 3% (58 ÷ 2,061 MiB) | not judged |
| json-ids | 1 MiB | 40% (40 ÷ 99 ms) | 9% (2 ÷ 27 MiB) | not judged |
| json-ids | 10 MiB | 31% (286 ÷ 931 ms) | 6% (22 ÷ 390 MiB) | not judged |
| json-ids | 50 MiB | 20% (1,532 ÷ 7,764 ms) | 6% (111 ÷ 1,989 MiB) | not judged |
| jsonc | 1 MiB | 41% (38 ÷ 92 ms) | 8% (2 ÷ 28 MiB) | not judged |
| jsonc | 10 MiB | 32% (238 ÷ 752 ms) | 5% (20 ÷ 396 MiB) | pass |
| jsonc | 50 MiB | 21% (1,218 ÷ 5,805 ms) | 5% (100 ÷ 2,007 MiB) | pass |
| json5 | 1 MiB | 45% (23 ÷ 51 ms) | 8% (2 ÷ 26 MiB) | not judged |
| json5 | 10 MiB | 30% (145 ÷ 490 ms) | 6% (21 ÷ 342 MiB) | pass |
| json5 | 50 MiB | 13% (731 ÷ 5,589 ms) | 6% (105 ÷ 1,732 MiB) | pass |
| jsonl | 1 MiB | 10% (9 ÷ 91 ms) | 9% (2 ÷ 21 MiB) | not judged |
| jsonl | 10 MiB | 17% (106 ÷ 628 ms) | 7% (19 ÷ 269 MiB) | not judged |
| jsonl | 50 MiB | 15% (554 ÷ 3,581 ms) | 7% (90 ÷ 1,353 MiB) | not judged |

Verdict: criterion 7 holds in this run.

## Spec 012 criterion 12: JSON Lines against one JSON array

`parseData('jsonl')` at 50 MiB must take a median time at most 1.25 times that of
`parseData('json')` on the same records written as one JSON array (`[`, the lines joined by `,`,
`]`), in this run.

| Size | parseData('jsonl') | parseData('json') on the array | jsonl ÷ array | Result |
|---|---|---|---|---|
| 1 MiB | **9** (9, 9, 9) | **8** (8, 8, 8) | 1.19 | not judged |
| 10 MiB | **106** (107, 106, 106) | **98** (95, 98, 99) | 1.08 | not judged |
| 50 MiB | **554** (554, 569, 550) | **515** (516, 515, 511) | 1.08 | pass |

Verdict: criterion 12 holds in this run.

## Spec 015 criterion 11 (core part): parse against the base commit

`parse` of each format at 10 MiB must take a median time at most 1.1 times that of the
base commit's core (`158cb15b816e962403666cd893cda912b4e75323`), built and measured in the same job on the same runner.
json-ids is new with spec 015, so the base commit parses it with rounded ids; it is shown, not judged.

| Format | parse (this commit) | parse (base) | this ÷ base | Result |
|---|---|---|---|---|
| json | **883** (1,036, 833, 883) | **838** (1,027, 804, 838) | 1.05 | pass |
| json-ids | **931** (1,120, 910, 931) | **837** (1,012, 781, 837) | 1.11 | not judged |
| jsonc | **752** (884, 752, 748) | **771** (883, 771, 759) | 0.98 | pass |
| json5 | **490** (611, 485, 490) | **483** (617, 475, 483) | 1.01 | pass |
| jsonl | **628** (820, 628, 614) | **578** (703, 578, 578) | 1.09 | pass |

Verdict: criterion 11 (core part) holds in this run.

## Spec 011 criterion 12: JavaScript and Lodash queries

One run of each bench query in the engine (`runQuery` from `packages/app-shell/src/query`: a
fresh QuickJS runtime and context, Lodash loaded for Lodash, the data copied in, the query, the
result copied out) beside the reference (the library's own `executeQuery` of the same language,
in Node, on the data already in memory, so it copies nothing). The documents are
`bench/generate.mjs`'s JSON files at 1 MiB and 5 MiB, parsed once. Same Node process, `--expose-gc`, heap collected before every timed call; 7 runs per
cell after a warm-up on a 256 KiB document; each cell is **median** (runs), in milliseconds. The engine's
WebAssembly was compiled once before the runs (39 ms; criterion 10 compiles it when Transform first opens).

- **filter-map** (JavaScript, `bench/query/filter-map.js`): `filter` on two fields, then `map` to
  four.
- **filter-orderBy-map** (Lodash, `bench/query/filter-orderBy-map.js`): `_.chain`, `filter`,
  `orderBy` on two keys, `map` with `_.pick`, `.value()`.

| Size | Query | Result items | Engine | Reference | Engine ÷ reference | Same result | Within 2.5 s |
|---|---|---|---|---|---|---|---|
| 1 MiB | filter-map (JavaScript) | 1,897 | **41** (45, 41, 42, 41, 40, 40, 39) | **0** (1, 0, 0, 0, 0, 0, 0) | 103× | yes | not judged |
| 1 MiB | filter-orderBy-map (Lodash) | 1,897 | **118** (119, 118, 118, 117, 118, 117, 117) | **3** (8, 4, 3, 3, 2, 3, 2) | 38× | yes | not judged |
| 5 MiB | filter-map (JavaScript) | 9,416 | **179** (181, 179, 179, 179, 179, 178, 179) | **2** (2, 2, 2, 2, 2, 2, 2) | 105× | yes | yes |
| 5 MiB | filter-orderBy-map (Lodash) | 9,416 | **534** (537, 534, 534, 533, 535, 532, 532) | **10** (13, 10, 10, 11, 11, 10, 10) | 51× | yes | yes |

Verdict: every bench query at 5 MiB takes at most 2.5 s in this run (criterion 12).

The reference is V8 running the query on data already in memory; most of the engine's time is
copying the data in and the result out (011 T1 REPORT §3), so the ratio says what the sealed engine
costs, not how fast QuickJS runs the query itself.

## Spec 010 criterion 11: smart format

`smartFormat(text, format)` (FracturedJson 5.1.0 with spec 010 §Layout, 010 T2) beside
Format's `getAdapter(format).prettyPrint(text)`, on the same files at 1 MiB and at the 5 MiB
threshold above which smart format is off (criterion 10). Each call parses the text it formats.
HYPOTHESIS: the 5 MiB median is under 5,000 ms on the CI runner.

| Format | Size | smartFormat | prettyPrint | smartFormat ÷ prettyPrint | output size |
|---|---|---|---|---|---|
| json | 1 MiB | **272** (278, 272, 237) | **95** (94, 95, 99) | 2.9× | 0.92 MiB |
| json | 5 MiB | **1,059** (1,138, 1,059, 980) | **427** (438, 427, 426) | 2.5× | 4.61 MiB |
| jsonc | 1 MiB | **298** (307, 298, 260) | **92** (92, 88, 93) | 3.2× | 1.06 MiB |
| jsonc | 5 MiB | **1,097** (1,149, 1,097, 1,003) | **397** (396, 397, 397) | 2.8× | 5.29 MiB |
| json5 | 1 MiB | **359** (379, 359, 306) | **80** (80, 83, 80) | 4.5× | 1.06 MiB |
| json5 | 5 MiB | **1,483** (1,578, 1,483, 1,358) | **455** (443, 465, 455) | 3.3× | 5.31 MiB |

Verdict: the hypothesis holds in this run (every 5 MiB median is under 5,000 ms).

## Against UNK-014's edit budget (< 500 ms)

applyPatch is only the host part of an edit: the UI, the message and `workspace.applyEdit` come on
top (`bench/vscode-open.md`). So a cell over 500 ms here misses the budget whatever else happens;
one under it is necessary, not sufficient. The cells use the host's case, a text already parsed.

| Size | json | json-ids | jsonc | json5 | jsonl |
|---|---|---|---|---|---|
| 1 MiB | within, slowest op 26 | within, slowest op 35 | within, slowest op 34 | within, slowest op 39 | within, slowest op 2 |
| 10 MiB | within, slowest op 391 | within, slowest op 383 | within, slowest op 322 | within, slowest op 243 | within, slowest op 21 |
| 50 MiB | over, slowest op 2,456 | over, slowest op 2,062 | over, slowest op 1,159 | over, slowest op 1,366 | within, slowest op 109 |

Medians relative to parse, over all sizes and formats (edit ÷ parse): replace 0.1–1.1×, add 0.1–1.0×, remove 0.1–1.0×, move 0.1–1.9×.

An edit on a text core has not parsed parses it once (tree and tokens) before it edits, so its
time grows with file size like parse time does. On a parsed text, replace, add and remove only
compute the change and write the new text; move also shifts the tree and tokens after the
removed record.

To reproduce: `pnpm --filter @chr-json-editor/core build`, then
`pnpm --filter @chr-json-editor/bench bench:core` (or the `bench` workflow, `.github/workflows/bench.yml`),
which also runs the query benchmark (`bench/query/run.mjs`).
