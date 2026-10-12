# Core benchmark: parse and one edit per format (002 T8)

> Spec 002 criterion 7, spec 008 criterion 7, spec 010 criterion 11 and spec 012 criterion 12. Written by `bench/core/report.mjs` from one benchmark run; do not edit
> by hand. Re-run it (the `bench` workflow) whenever `packages/core/src/formats` changes speed.

## Run

- Where: GitHub Actions, [run 38246148065](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/38246148065); commit `e73db85284678fbe23d25c7d8777ac1a4aa00d98`.
- Machine: Linux x64 (`ubuntu24`), 4 × AMD EPYC 9V74 80-Core Processor, 16 GiB RAM.
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
| 1 MiB | **91** (116, 90, 91) | **5** (5, 5, 5) | **67** (67, 70, 65) | **69** (68, 70, 69) | **68** (67, 70, 68) | **95** (95, 96, 92) |
| 10 MiB | **862** (1,123, 862, 832) | **49** (49, 49, 49) | **585** (585, 605, 574) | **595** (595, 628, 594) | **597** (597, 619, 590) | **1,028** (1,028, 1,024, 1,031) |
| 50 MiB | **7,369** (8,268, 7,369, 6,341) | **303** (297, 303, 313) | **6,027** (6,093, 5,996, 6,027) | **5,446** (5,131, 5,446, 6,148) | **6,191** (5,887, 6,344, 6,191) | **8,871** (8,421, 9,591, 8,871) |

After the text was parsed (json):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **26** (26, 25, 26) |
| 10 MiB | **0** (0, 0, 0) | **3** (2, 3, 3) | **0** (0, 0, 0) | **391** (391, 387, 397) |
| 50 MiB | **0** (0, 0, 0) | **8** (8, 7, 9) | **0** (0, 0, 0) | **2,432** (2,426, 2,433, 2,432) |

### jsonc

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **90** (98, 90, 89) | **35** (37, 34, 35) | **65** (69, 65, 65) | **69** (68, 70, 69) | **70** (68, 70, 73) | **101** (101, 98, 105) |
| 10 MiB | **774** (873, 732, 774) | **232** (232, 236, 232) | **535** (540, 530, 535) | **546** (546, 576, 543) | **550** (546, 554, 550) | **911** (997, 876, 911) |
| 50 MiB | **6,898** (7,466, 5,820, 6,898) | **1,205** (1,205, 1,192, 1,242) | **4,767** (5,728, 4,767, 4,545) | **5,613** (5,657, 5,600, 5,613) | **5,725** (5,725, 5,694, 5,775) | **8,162** (8,052, 8,164, 8,162) |

After the text was parsed (jsonc):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **34** (36, 33, 34) |
| 10 MiB | **0** (0, 0, 0) | **3** (2, 3, 3) | **0** (0, 0, 0) | **321** (325, 321, 321) |
| 50 MiB | **0** (0, 3, 0) | **8** (8, 7, 8) | **0** (0, 0, 0) | **1,148** (1,139, 1,148, 1,209) |

### json5

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **54** (72, 54, 51) | **26** (26, 15, 26) | **52** (52, 52, 55) | **57** (57, 50, 57) | **54** (53, 56, 54) | **96** (96, 99, 89) |
| 10 MiB | **473** (603, 473, 462) | **180** (178, 182, 180) | **475** (476, 475, 464) | **471** (469, 473, 471) | **473** (485, 464, 473) | **718** (720, 718, 715) |
| 50 MiB | **5,847** (5,847, 5,334, 6,031) | **931** (931, 984, 930) | **5,216** (5,216, 5,236, 4,972) | **5,789** (5,091, 6,131, 5,789) | **5,809** (5,017, 5,809, 6,069) | **8,849** (8,897, 8,261, 8,849) |

After the text was parsed (json5):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **37** (37, 37, 39) |
| 10 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **245** (251, 238, 245) |
| 50 MiB | **0** (0, 0, 1) | **0** (0, 0, 0) | **0** (0, 0, 0) | **1,647** (1,629, 1,647, 1,654) |

### jsonl

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **88** (94, 88, 87) | **8** (8, 7, 8) | **9** (11, 9, 9) | **10** (11, 10, 10) | **9** (10, 9, 9) | **10** (10, 10, 10) |
| 10 MiB | **605** (714, 584, 605) | **92** (92, 91, 97) | **100** (109, 99, 100) | **103** (106, 101, 103) | **104** (110, 102, 104) | **107** (111, 103, 107) |
| 50 MiB | **3,743** (4,437, 3,738, 3,743) | **476** (476, 472, 476) | **519** (626, 515, 519) | **522** (607, 522, 514) | **520** (630, 520, 516) | **525** (622, 522, 525) |

After the text was parsed (jsonl):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **2** (3, 2, 2) | **2** (2, 2, 2) | **2** (2, 2, 2) | **2** (2, 2, 3) |
| 10 MiB | **16** (15, 16, 17) | **18** (14, 18, 18) | **15** (13, 15, 18) | **22** (19, 22, 22) |
| 50 MiB | **87** (84, 106, 87) | **85** (84, 86, 85) | **86** (85, 86, 112) | **106** (106, 106, 107) |

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
| 1 MiB | 31 | 1 | 254 | 30 | 2 | 243 | 26 | 2 | 222 | 21 | 2 | 157 |
| 10 MiB | 406 | 12 | 1,884 | 396 | 20 | 1,776 | 342 | 21 | 1,697 | 269 | 19 | 710 |
| 50 MiB | 2,061 | 58 | 5,857 | 2,007 | 100 | 5,889 | 1,731 | 105 | 5,665 | 1,353 | 90 | 3,126 |

## Spec 008 criterion 7: parseData against parse

For jsonc and json5 at 10 and 50 MiB, `parseData`'s median time and its retained heap must each be
at most 50% of `parse`'s, in this run. json takes `JSON.parse`, so it is shown but not judged.

| Format | Size | time parseData ÷ parse | heap parseData ÷ parse | Result |
|---|---|---|---|---|
| json | 1 MiB | 5% (5 ÷ 91 ms) | 4% (1 ÷ 31 MiB) | not judged |
| json | 10 MiB | 6% (49 ÷ 862 ms) | 3% (12 ÷ 406 MiB) | not judged |
| json | 50 MiB | 4% (303 ÷ 7,369 ms) | 3% (58 ÷ 2,061 MiB) | not judged |
| jsonc | 1 MiB | 39% (35 ÷ 90 ms) | 7% (2 ÷ 30 MiB) | not judged |
| jsonc | 10 MiB | 30% (232 ÷ 774 ms) | 5% (20 ÷ 396 MiB) | pass |
| jsonc | 50 MiB | 17% (1,205 ÷ 6,898 ms) | 5% (100 ÷ 2,007 MiB) | pass |
| json5 | 1 MiB | 47% (26 ÷ 54 ms) | 8% (2 ÷ 26 MiB) | not judged |
| json5 | 10 MiB | 38% (180 ÷ 473 ms) | 6% (21 ÷ 342 MiB) | pass |
| json5 | 50 MiB | 16% (931 ÷ 5,847 ms) | 6% (105 ÷ 1,731 MiB) | pass |
| jsonl | 1 MiB | 9% (8 ÷ 88 ms) | 9% (2 ÷ 21 MiB) | not judged |
| jsonl | 10 MiB | 15% (92 ÷ 605 ms) | 7% (19 ÷ 269 MiB) | not judged |
| jsonl | 50 MiB | 13% (476 ÷ 3,743 ms) | 7% (90 ÷ 1,353 MiB) | not judged |

Verdict: criterion 7 holds in this run.

## Spec 012 criterion 12: JSON Lines against one JSON array

`parseData('jsonl')` at 50 MiB must take a median time at most 1.25 times that of
`parseData('json')` on the same records written as one JSON array (`[`, the lines joined by `,`,
`]`), in this run.

| Size | parseData('jsonl') | parseData('json') on the array | jsonl ÷ array | Result |
|---|---|---|---|---|
| 1 MiB | **8** (8, 7, 8) | **7** (7, 9, 7) | 1.06 | not judged |
| 10 MiB | **92** (92, 91, 97) | **82** (82, 83, 81) | 1.12 | not judged |
| 50 MiB | **476** (476, 472, 476) | **465** (465, 465, 446) | 1.02 | pass |

Verdict: criterion 12 holds in this run.

## Spec 010 criterion 11: smart format

`smartFormat(text, format)` (FracturedJson 5.1.0 with spec 010 §Layout, 010 T2) beside
Format's `getAdapter(format).prettyPrint(text)`, on the same files at 1 MiB and at the 5 MiB
threshold above which smart format is off (criterion 10). Each call parses the text it formats.
HYPOTHESIS: the 5 MiB median is under 5,000 ms on the CI runner.

| Format | Size | smartFormat | prettyPrint | smartFormat ÷ prettyPrint | output size |
|---|---|---|---|---|---|
| json | 1 MiB | **278** (288, 278, 246) | **95** (114, 95, 80) | 2.9× | 0.92 MiB |
| json | 5 MiB | **1,067** (1,123, 1,067, 963) | **423** (422, 428, 423) | 2.5× | 4.61 MiB |
| jsonc | 1 MiB | **294** (294, 297, 265) | **1,350** (1,346, 1,362, 1,350) | 0.2× | 1.06 MiB |
| jsonc | 5 MiB | **1,108** (1,160, 1,108, 1,023) | **18,346** (18,382, 18,159, 18,346) | 0.1× | 5.29 MiB |
| json5 | 1 MiB | **371** (401, 371, 304) | **1,291** (1,291, 1,297, 1,288) | 0.3× | 1.06 MiB |
| json5 | 5 MiB | **1,421** (1,567, 1,421, 1,320) | **18,122** (18,122, 18,126, 17,985) | 0.1× | 5.31 MiB |

Verdict: the hypothesis holds in this run (every 5 MiB median is under 5,000 ms).

## Against UNK-014's edit budget (< 500 ms)

applyPatch is only the host part of an edit: the UI, the message and `workspace.applyEdit` come on
top (`bench/vscode-open.md`). So a cell over 500 ms here misses the budget whatever else happens;
one under it is necessary, not sufficient. The cells use the host's case, a text already parsed.

| Size | json | jsonc | json5 | jsonl |
|---|---|---|---|---|
| 1 MiB | within, slowest op 26 | within, slowest op 34 | within, slowest op 37 | within, slowest op 2 |
| 10 MiB | within, slowest op 391 | within, slowest op 321 | within, slowest op 245 | within, slowest op 22 |
| 50 MiB | over, slowest op 2,432 | over, slowest op 1,148 | over, slowest op 1,647 | within, slowest op 106 |

Medians relative to parse, over all sizes and formats (edit ÷ parse): replace 0.1–1.0×, add 0.1–1.1×, remove 0.1–1.0×, move 0.1–1.8×.

An edit on a text core has not parsed parses it once (tree and tokens) before it edits, so its
time grows with file size like parse time does. On a parsed text, replace, add and remove only
compute the change and write the new text; move also shifts the tree and tokens after the
removed record.

To reproduce: `pnpm --filter @chr-json-editor/core build`, then
`pnpm --filter @chr-json-editor/bench bench:core` (or the `bench` workflow, `.github/workflows/bench.yml`).
