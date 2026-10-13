# Core benchmark: parse and one edit per format (002 T8)

> Spec 002 criterion 7, spec 008 criterion 7, spec 012 criterion 12 and spec 011 criterion 12. Written by `bench/core/report.mjs` from one benchmark run; do not edit
> by hand. Re-run it (the `bench` workflow) whenever `packages/core/src/formats` or `packages/app-shell/src/query` changes speed.

## Run

- Where: GitHub Actions, [run 38397419182](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/38397419182); commit `a07e661f52eeb54bf34963eac2bfe3bffb2529c3`.
- Machine: Linux x64 (`ubuntu24`), 4 × AMD EPYC 7763 64-Core Processor, 16 GiB RAM.
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
| 1 MiB | **121** (135, 121, 114) | **6** (6, 6, 6) | **83** (83, 83, 84) | **85** (85, 83, 85) | **86** (89, 86, 85) | **124** (124, 124, 123) |
| 10 MiB | **1,058** (1,216, 974, 1,058) | **58** (58, 58, 60) | **720** (722, 720, 686) | **709** (709, 733, 701) | **699** (699, 737, 695) | **1,088** (1,088, 1,106, 1,088) |
| 50 MiB | **8,133** (8,391, 7,129, 8,133) | **356** (363, 356, 351) | **5,536** (5,536, 5,488, 6,650) | **6,350** (6,350, 5,755, 6,796) | **6,633** (6,306, 6,633, 6,675) | **8,159** (8,914, 7,800, 8,159) |

After the text was parsed (json):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **41** (42, 36, 41) |
| 10 MiB | **0** (0, 0, 0) | **3** (2, 3, 3) | **0** (0, 0, 0) | **383** (383, 373, 441) |
| 50 MiB | **0** (0, 0, 0) | **17** (17, 17, 17) | **0** (0, 0, 0) | **1,172** (1,172, 1,137, 1,186) |

### jsonc

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **113** (125, 113, 110) | **50** (50, 51, 48) | **81** (80, 81, 85) | **86** (90, 86, 83) | **85** (81, 88, 85) | **119** (120, 116, 119) |
| 10 MiB | **943** (1,076, 943, 938) | **313** (307, 319, 313) | **638** (638, 638, 643) | **646** (662, 646, 641) | **650** (650, 643, 650) | **815** (824, 815, 805) |
| 50 MiB | **6,755** (7,330, 6,755, 6,749) | **1,598** (1,598, 1,586, 1,628) | **6,283** (6,320, 6,283, 6,196) | **6,273** (6,348, 5,908, 6,273) | **5,131** (5,131, 6,199, 5,060) | **8,732** (7,898, 8,732, 9,014) |

After the text was parsed (jsonc):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **38** (38, 34, 38) |
| 10 MiB | **0** (0, 0, 0) | **5** (5, 3, 6) | **0** (0, 0, 0) | **187** (187, 177, 191) |
| 50 MiB | **0** (0, 0, 0) | **18** (17, 18, 18) | **0** (0, 0, 0) | **1,366** (1,361, 1,366, 1,377) |

### json5

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **83** (83, 88, 59) | **28** (28, 31, 16) | **66** (66, 66, 63) | **62** (59, 62, 65) | **66** (62, 66, 69) | **103** (103, 107, 103) |
| 10 MiB | **510** (682, 503, 510) | **193** (190, 194, 193) | **524** (532, 524, 505) | **558** (558, 564, 545) | **560** (560, 566, 553) | **976** (976, 949, 977) |
| 50 MiB | **5,828** (6,466, 5,828, 5,691) | **961** (961, 958, 967) | **4,591** (4,390, 4,591, 5,003) | **4,727** (4,492, 4,727, 5,997) | **5,031** (5,031, 4,796, 6,066) | **8,644** (8,722, 8,644, 7,730) |

After the text was parsed (json5):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **38** (42, 36, 38) |
| 10 MiB | **0** (0, 0, 0) | **0** (0, 3, 0) | **0** (0, 0, 0) | **410** (410, 406, 435) |
| 50 MiB | **0** (0, 0, 1) | **1** (1, 1, 0) | **0** (0, 0, 0) | **1,549** (1,551, 1,525, 1,549) |

### jsonl

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **108** (111, 103, 108) | **10** (10, 10, 10) | **12** (13, 12, 12) | **12** (13, 11, 12) | **12** (12, 12, 11) | **12** (12, 11, 12) |
| 10 MiB | **709** (855, 709, 693) | **116** (116, 116, 115) | **122** (135, 121, 122) | **122** (131, 119, 122) | **124** (135, 124, 122) | **122** (135, 122, 122) |
| 50 MiB | **3,797** (4,744, 3,793, 3,797) | **581** (581, 582, 577) | **641** (777, 641, 634) | **651** (753, 641, 651) | **639** (772, 638, 639) | **660** (775, 660, 653) |

After the text was parsed (jsonl):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **3** (3, 2, 3) | **3** (2, 3, 3) | **2** (2, 2, 2) | **3** (3, 3, 3) |
| 10 MiB | **19** (19, 19, 19) | **22** (19, 22, 22) | **21** (20, 21, 21) | **24** (24, 24, 25) |
| 50 MiB | **109** (111, 109, 109) | **110** (110, 108, 111) | **110** (110, 109, 140) | **138** (164, 138, 134) |

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
| 1 MiB | 31 | 1 | 251 | 30 | 2 | 246 | 26 | 2 | 231 | 21 | 2 | 156 |
| 10 MiB | 406 | 12 | 1,789 | 396 | 20 | 1,689 | 342 | 21 | 1,633 | 269 | 19 | 710 |
| 50 MiB | 2,061 | 58 | 5,847 | 2,007 | 100 | 5,916 | 1,731 | 105 | 5,711 | 1,353 | 90 | 3,134 |

## Spec 008 criterion 7: parseData against parse

For jsonc and json5 at 10 and 50 MiB, `parseData`'s median time and its retained heap must each be
at most 50% of `parse`'s, in this run. json takes `JSON.parse`, so it is shown but not judged.

| Format | Size | time parseData ÷ parse | heap parseData ÷ parse | Result |
|---|---|---|---|---|
| json | 1 MiB | 5% (6 ÷ 121 ms) | 4% (1 ÷ 31 MiB) | not judged |
| json | 10 MiB | 6% (58 ÷ 1,058 ms) | 3% (12 ÷ 406 MiB) | not judged |
| json | 50 MiB | 4% (356 ÷ 8,133 ms) | 3% (58 ÷ 2,061 MiB) | not judged |
| jsonc | 1 MiB | 45% (50 ÷ 113 ms) | 7% (2 ÷ 30 MiB) | not judged |
| jsonc | 10 MiB | 33% (313 ÷ 943 ms) | 5% (20 ÷ 396 MiB) | pass |
| jsonc | 50 MiB | 24% (1,598 ÷ 6,755 ms) | 5% (100 ÷ 2,007 MiB) | pass |
| json5 | 1 MiB | 34% (28 ÷ 83 ms) | 8% (2 ÷ 26 MiB) | not judged |
| json5 | 10 MiB | 38% (193 ÷ 510 ms) | 6% (21 ÷ 342 MiB) | pass |
| json5 | 50 MiB | 16% (961 ÷ 5,828 ms) | 6% (105 ÷ 1,731 MiB) | pass |
| jsonl | 1 MiB | 9% (10 ÷ 108 ms) | 9% (2 ÷ 21 MiB) | not judged |
| jsonl | 10 MiB | 16% (116 ÷ 709 ms) | 7% (19 ÷ 269 MiB) | not judged |
| jsonl | 50 MiB | 15% (581 ÷ 3,797 ms) | 7% (90 ÷ 1,353 MiB) | not judged |

Verdict: criterion 7 holds in this run.

## Spec 012 criterion 12: JSON Lines against one JSON array

`parseData('jsonl')` at 50 MiB must take a median time at most 1.25 times that of
`parseData('json')` on the same records written as one JSON array (`[`, the lines joined by `,`,
`]`), in this run.

| Size | parseData('jsonl') | parseData('json') on the array | jsonl ÷ array | Result |
|---|---|---|---|---|
| 1 MiB | **10** (10, 10, 10) | **8** (8, 8, 8) | 1.21 | not judged |
| 10 MiB | **116** (116, 116, 115) | **97** (96, 98, 97) | 1.19 | not judged |
| 50 MiB | **581** (581, 582, 577) | **504** (504, 504, 512) | 1.15 | pass |

Verdict: criterion 12 holds in this run.

## Spec 011 criterion 12: JavaScript and Lodash queries

One run of each bench query in the engine (`runQuery` from `packages/app-shell/src/query`: a
fresh QuickJS runtime and context, Lodash loaded for Lodash, the data copied in, the query, the
result copied out) beside the reference (the library's own `executeQuery` of the same language,
in Node, on the data already in memory, so it copies nothing). The documents are
`bench/generate.mjs`'s JSON files at 1 MiB and 5 MiB, parsed once. Same Node process, `--expose-gc`, heap collected before every timed call; 7 runs per
cell after a warm-up on a 256 KiB document; each cell is **median** (runs), in milliseconds. The engine's
WebAssembly was compiled once before the runs (51 ms; criterion 10 compiles it when Transform first opens).

- **filter-map** (JavaScript, `bench/query/filter-map.js`): `filter` on two fields, then `map` to
  four.
- **filter-orderBy-map** (Lodash, `bench/query/filter-orderBy-map.js`): `_.chain`, `filter`,
  `orderBy` on two keys, `map` with `_.pick`, `.value()`.

| Size | Query | Result items | Engine | Reference | Engine ÷ reference | Same result | Within 2.5 s |
|---|---|---|---|---|---|---|---|
| 1 MiB | filter-map (JavaScript) | 1,897 | **50** (55, 52, 52, 50, 49, 48, 48) | **1** (1, 0, 1, 1, 1, 1, 1) | 95× | yes | not judged |
| 1 MiB | filter-orderBy-map (Lodash) | 1,897 | **156** (163, 162, 160, 155, 156, 152, 155) | **4** (11, 6, 4, 5, 3, 4, 3) | 36× | yes | not judged |
| 5 MiB | filter-map (JavaScript) | 9,416 | **223** (222, 227, 223, 222, 223, 224, 222) | **2** (2, 2, 2, 2, 2, 2, 2) | 99× | yes | yes |
| 5 MiB | filter-orderBy-map (Lodash) | 9,416 | **700** (698, 691, 695, 701, 702, 711, 700) | **15** (17, 15, 17, 16, 14, 13, 15) | 47× | yes | yes |

Verdict: every bench query at 5 MiB takes at most 2.5 s in this run (criterion 12).

The reference is V8 running the query on data already in memory; most of the engine's time is
copying the data in and the result out (011 T1 REPORT §3), so the ratio says what the sealed engine
costs, not how fast QuickJS runs the query itself.

## Against UNK-014's edit budget (< 500 ms)

applyPatch is only the host part of an edit: the UI, the message and `workspace.applyEdit` come on
top (`bench/vscode-open.md`). So a cell over 500 ms here misses the budget whatever else happens;
one under it is necessary, not sufficient. The cells use the host's case, a text already parsed.

| Size | json | jsonc | json5 | jsonl |
|---|---|---|---|---|
| 1 MiB | within, slowest op 41 | within, slowest op 38 | within, slowest op 38 | within, slowest op 3 |
| 10 MiB | within, slowest op 383 | within, slowest op 187 | within, slowest op 410 | within, slowest op 24 |
| 50 MiB | over, slowest op 1,172 | over, slowest op 1,366 | over, slowest op 1,549 | within, slowest op 138 |

Medians relative to parse, over all sizes and formats (edit ÷ parse): replace 0.1–1.0×, add 0.1–1.1×, remove 0.1–1.1×, move 0.1–1.9×.

An edit on a text core has not parsed parses it once (tree and tokens) before it edits, so its
time grows with file size like parse time does. On a parsed text, replace, add and remove only
compute the change and write the new text; move also shifts the tree and tokens after the
removed record.

To reproduce: `pnpm --filter @chr-json-editor/core build`, then
`pnpm --filter @chr-json-editor/bench bench:core` (or the `bench` workflow, `.github/workflows/bench.yml`),
which also runs the query benchmark (`bench/query/run.mjs`).
