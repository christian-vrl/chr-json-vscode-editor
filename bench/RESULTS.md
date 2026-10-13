# Core benchmark: parse and one edit per format (002 T8)

> Spec 002 criterion 7, spec 008 criterion 7, spec 010 criterion 11, spec 012 criterion 12 and spec 011 criterion 12. Written by `bench/core/report.mjs` from one benchmark run; do not edit
> by hand. Re-run it (the `bench` workflow) whenever `packages/core/src/formats` or `packages/app-shell/src/query` changes speed.

## Run

- Where: GitHub Actions, [run 38402504833](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/38402504833); commit `d448ce584250a1ea79dc7df0ad0f30f6cd611aa8`.
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
| 1 MiB | **124** (161, 119, 124) | **6** (6, 6, 6) | **92** (91, 96, 92) | **93** (92, 94, 93) | **95** (91, 95, 100) | **127** (122, 128, 127) |
| 10 MiB | **1,140** (1,375, 1,074, 1,140) | **59** (59, 60, 57) | **765** (765, 778, 757) | **777** (777, 815, 768) | **782** (782, 816, 772) | **1,256** (1,246, 1,291, 1,256) |
| 50 MiB | **9,273** (9,782, 8,656, 9,273) | **357** (361, 353, 357) | **6,403** (6,354, 6,403, 7,094) | **6,682** (7,662, 6,682, 6,226) | **7,384** (7,384, 7,565, 6,344) | **10,663** (11,714, 10,663, 10,513) |

After the text was parsed (json):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **32** (34, 32, 31) |
| 10 MiB | **0** (0, 0, 0) | **3** (2, 3, 3) | **0** (0, 0, 0) | **483** (489, 483, 461) |
| 50 MiB | **0** (0, 0, 0) | **20** (20, 20, 19) | **0** (0, 0, 0) | **2,875** (2,875, 2,872, 2,923) |

### jsonc

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **124** (137, 124, 121) | **46** (46, 25, 54) | **91** (93, 89, 91) | **94** (94, 96, 91) | **91** (91, 89, 94) | **129** (129, 128, 131) |
| 10 MiB | **1,027** (1,191, 1,027, 1,026) | **325** (324, 325, 329) | **724** (729, 722, 724) | **734** (750, 734, 725) | **731** (731, 734, 722) | **1,131** (1,131, 1,127, 1,137) |
| 50 MiB | **8,217** (9,546, 8,217, 8,088) | **1,669** (1,631, 1,669, 1,677) | **7,249** (7,328, 6,380, 7,249) | **6,337** (7,071, 6,337, 6,089) | **7,150** (7,263, 6,458, 7,150) | **9,273** (9,273, 9,847, 8,880) |

After the text was parsed (jsonc):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **43** (45, 40, 43) |
| 10 MiB | **0** (0, 0, 0) | **3** (2, 3, 3) | **0** (0, 0, 0) | **387** (391, 387, 384) |
| 50 MiB | **0** (0, 0, 0) | **19** (19, 20, 18) | **0** (0, 0, 0) | **1,441** (1,428, 1,441, 1,487) |

### json5

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **71** (83, 71, 71) | **27** (31, 27, 27) | **68** (68, 64, 69) | **73** (64, 73, 76) | **77** (78, 73, 77) | **119** (118, 119, 122) |
| 10 MiB | **654** (792, 654, 624) | **201** (199, 201, 201) | **643** (663, 643, 627) | **659** (659, 646, 673) | **656** (656, 656, 654) | **925** (942, 918, 925) |
| 50 MiB | **6,420** (6,344, 6,626, 6,420) | **1,016** (1,031, 1,016, 999) | **6,787** (6,787, 6,831, 5,564) | **6,011** (5,391, 6,344, 6,011) | **6,513** (6,513, 6,903, 6,422) | **9,989** (9,989, 10,416, 8,882) |

After the text was parsed (json5):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **45** (48, 45, 45) |
| 10 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **304** (304, 282, 308) |
| 50 MiB | **0** (0, 1, 0) | **1** (1, 1, 0) | **0** (0, 0, 0) | **2,031** (2,034, 2,031, 2,015) |

### jsonl

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **113** (119, 113, 108) | **10** (10, 10, 10) | **12** (14, 12, 12) | **12** (12, 12, 11) | **12** (12, 12, 11) | **12** (12, 12, 12) |
| 10 MiB | **697** (865, 697, 691) | **116** (115, 116, 116) | **122** (134, 121, 122) | **126** (134, 121, 126) | **124** (133, 122, 124) | **125** (134, 124, 125) |
| 50 MiB | **3,653** (4,655, 3,653, 3,652) | **601** (601, 601, 588) | **658** (764, 658, 652) | **656** (772, 650, 656) | **657** (780, 647, 657) | **656** (781, 655, 656) |

After the text was parsed (jsonl):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **3** (3, 3, 3) | **3** (3, 3, 3) | **2** (2, 2, 2) | **3** (3, 3, 3) |
| 10 MiB | **20** (18, 20, 21) | **19** (19, 21, 19) | **21** (18, 21, 21) | **27** (24, 27, 27) |
| 50 MiB | **112** (112, 125, 112) | **113** (120, 113, 112) | **111** (177, 111, 111) | **138** (138, 138, 138) |

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
| 1 MiB | 31 | 1 | 242 | 30 | 2 | 242 | 26 | 2 | 229 | 21 | 2 | 157 |
| 10 MiB | 406 | 12 | 1,860 | 396 | 20 | 1,777 | 342 | 21 | 1,687 | 269 | 19 | 710 |
| 50 MiB | 2,061 | 58 | 5,757 | 2,007 | 100 | 5,841 | 1,731 | 105 | 5,807 | 1,353 | 90 | 3,121 |

## Spec 008 criterion 7: parseData against parse

For jsonc and json5 at 10 and 50 MiB, `parseData`'s median time and its retained heap must each be
at most 50% of `parse`'s, in this run. json takes `JSON.parse`, so it is shown but not judged.

| Format | Size | time parseData ÷ parse | heap parseData ÷ parse | Result |
|---|---|---|---|---|
| json | 1 MiB | 5% (6 ÷ 124 ms) | 4% (1 ÷ 31 MiB) | not judged |
| json | 10 MiB | 5% (59 ÷ 1,140 ms) | 3% (12 ÷ 406 MiB) | not judged |
| json | 50 MiB | 4% (357 ÷ 9,273 ms) | 3% (58 ÷ 2,061 MiB) | not judged |
| jsonc | 1 MiB | 37% (46 ÷ 124 ms) | 7% (2 ÷ 30 MiB) | not judged |
| jsonc | 10 MiB | 32% (325 ÷ 1,027 ms) | 5% (20 ÷ 396 MiB) | pass |
| jsonc | 50 MiB | 20% (1,669 ÷ 8,217 ms) | 5% (100 ÷ 2,007 MiB) | pass |
| json5 | 1 MiB | 38% (27 ÷ 71 ms) | 8% (2 ÷ 26 MiB) | not judged |
| json5 | 10 MiB | 31% (201 ÷ 654 ms) | 6% (21 ÷ 342 MiB) | pass |
| json5 | 50 MiB | 16% (1,016 ÷ 6,420 ms) | 6% (105 ÷ 1,731 MiB) | pass |
| jsonl | 1 MiB | 8% (10 ÷ 113 ms) | 9% (2 ÷ 21 MiB) | not judged |
| jsonl | 10 MiB | 17% (116 ÷ 697 ms) | 7% (19 ÷ 269 MiB) | not judged |
| jsonl | 50 MiB | 16% (601 ÷ 3,653 ms) | 7% (90 ÷ 1,353 MiB) | not judged |

Verdict: criterion 7 holds in this run.

## Spec 012 criterion 12: JSON Lines against one JSON array

`parseData('jsonl')` at 50 MiB must take a median time at most 1.25 times that of
`parseData('json')` on the same records written as one JSON array (`[`, the lines joined by `,`,
`]`), in this run.

| Size | parseData('jsonl') | parseData('json') on the array | jsonl ÷ array | Result |
|---|---|---|---|---|
| 1 MiB | **10** (10, 10, 10) | **8** (8, 8, 8) | 1.21 | not judged |
| 10 MiB | **116** (115, 116, 116) | **97** (97, 99, 96) | 1.19 | not judged |
| 50 MiB | **601** (601, 601, 588) | **521** (521, 516, 524) | 1.15 | pass |

Verdict: criterion 12 holds in this run.

## Spec 011 criterion 12: JavaScript and Lodash queries

One run of each bench query in the engine (`runQuery` from `packages/app-shell/src/query`: a
fresh QuickJS runtime and context, Lodash loaded for Lodash, the data copied in, the query, the
result copied out) beside the reference (the library's own `executeQuery` of the same language,
in Node, on the data already in memory, so it copies nothing). The documents are
`bench/generate.mjs`'s JSON files at 1 MiB and 5 MiB, parsed once. Same Node process, `--expose-gc`, heap collected before every timed call; 7 runs per
cell after a warm-up on a 256 KiB document; each cell is **median** (runs), in milliseconds. The engine's
WebAssembly was compiled once before the runs (47 ms; criterion 10 compiles it when Transform first opens).

- **filter-map** (JavaScript, `bench/query/filter-map.js`): `filter` on two fields, then `map` to
  four.
- **filter-orderBy-map** (Lodash, `bench/query/filter-orderBy-map.js`): `_.chain`, `filter`,
  `orderBy` on two keys, `map` with `_.pick`, `.value()`.

| Size | Query | Result items | Engine | Reference | Engine ÷ reference | Same result | Within 2.5 s |
|---|---|---|---|---|---|---|---|
| 1 MiB | filter-map (JavaScript) | 1,897 | **48** (54, 53, 52, 48, 48, 48, 48) | **1** (1, 1, 1, 1, 1, 1, 1) | 90× | yes | not judged |
| 1 MiB | filter-orderBy-map (Lodash) | 1,897 | **156** (164, 156, 159, 155, 156, 154, 154) | **4** (11, 6, 4, 5, 3, 4, 3) | 35× | yes | not judged |
| 5 MiB | filter-map (JavaScript) | 9,416 | **224** (230, 225, 223, 224, 222, 225, 224) | **2** (2, 2, 2, 2, 2, 2, 2) | 102× | yes | yes |
| 5 MiB | filter-orderBy-map (Lodash) | 9,416 | **713** (700, 716, 713, 705, 720, 720, 704) | **14** (15, 14, 15, 16, 14, 14, 14) | 49× | yes | yes |

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
| json | 1 MiB | **353** (374, 353, 317) | **118** (116, 118, 129) | 3.0× | 0.92 MiB |
| json | 5 MiB | **1,339** (1,443, 1,339, 1,218) | **572** (547, 572, 572) | 2.3× | 4.61 MiB |
| jsonc | 1 MiB | **388** (389, 388, 337) | **120** (123, 118, 120) | 3.2× | 1.06 MiB |
| jsonc | 5 MiB | **1,416** (1,443, 1,416, 1,297) | **527** (525, 532, 527) | 2.7× | 5.29 MiB |
| json5 | 1 MiB | **476** (500, 476, 388) | **106** (99, 110, 106) | 4.5× | 1.06 MiB |
| json5 | 5 MiB | **1,799** (1,987, 1,799, 1,639) | **512** (519, 504, 512) | 3.5× | 5.31 MiB |

Verdict: the hypothesis holds in this run (every 5 MiB median is under 5,000 ms).

## Against UNK-014's edit budget (< 500 ms)

applyPatch is only the host part of an edit: the UI, the message and `workspace.applyEdit` come on
top (`bench/vscode-open.md`). So a cell over 500 ms here misses the budget whatever else happens;
one under it is necessary, not sufficient. The cells use the host's case, a text already parsed.

| Size | json | jsonc | json5 | jsonl |
|---|---|---|---|---|
| 1 MiB | within, slowest op 32 | within, slowest op 43 | within, slowest op 45 | within, slowest op 3 |
| 10 MiB | within, slowest op 483 | within, slowest op 387 | within, slowest op 304 | within, slowest op 27 |
| 50 MiB | over, slowest op 2,875 | over, slowest op 1,441 | over, slowest op 2,031 | within, slowest op 138 |

Medians relative to parse, over all sizes and formats (edit ÷ parse): replace 0.1–1.1×, add 0.1–1.0×, remove 0.1–1.1×, move 0.1–1.7×.

An edit on a text core has not parsed parses it once (tree and tokens) before it edits, so its
time grows with file size like parse time does. On a parsed text, replace, add and remove only
compute the change and write the new text; move also shifts the tree and tokens after the
removed record.

To reproduce: `pnpm --filter @chr-json-editor/core build`, then
`pnpm --filter @chr-json-editor/bench bench:core` (or the `bench` workflow, `.github/workflows/bench.yml`),
which also runs the query benchmark (`bench/query/run.mjs`).
