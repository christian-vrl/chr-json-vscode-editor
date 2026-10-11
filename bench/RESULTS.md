# Core benchmark: parse and one edit per format (002 T8)

> Spec 002 criterion 7 and spec 008 criterion 7. Written by `bench/core/report.mjs` from one benchmark run; do not edit
> by hand. Re-run it (the `bench` workflow) whenever `packages/core/src/formats` changes speed.

## Run

- Where: GitHub Actions, [run 38169445043](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/38169445043); commit `83bba5a4d1b27e3d585d2e19bd01cd87510c854f`.
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

Records per file:

| Size | json | jsonc | json5 |
|---|---|---|---|
| 1 MiB (1,048,576 B) | 4,372 | 4,323 | 4,305 |
| 10 MiB (10,485,760 B) | 43,361 | 42,702 | 42,530 |
| 50 MiB (52,428,800 B) | 215,488 | 211,612 | 210,767 |

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

### json

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **120** (122, 112, 120) | **6** (6, 6, 6) | **82** (82, 83, 81) | **86** (88, 86, 83) | **84** (83, 89, 84) | **125** (128, 125, 123) |
| 10 MiB | **1,069** (1,252, 997, 1,069) | **59** (60, 58, 59) | **757** (732, 775, 757) | **715** (715, 733, 701) | **721** (720, 756, 721) | **1,120** (1,120, 1,144, 1,111) |
| 50 MiB | **8,331** (9,501, 7,464, 8,331) | **357** (366, 356, 357) | **6,505** (6,505, 6,585, 5,964) | **5,901** (5,730, 6,812, 5,901) | **6,406** (6,406, 5,767, 6,712) | **9,463** (10,005, 9,463, 9,224) |

After the text was parsed (json):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **42** (42, 39, 42) |
| 10 MiB | **0** (0, 0, 0) | **3** (2, 3, 3) | **0** (0, 0, 0) | **398** (398, 387, 401) |
| 50 MiB | **0** (0, 0, 0) | **18** (18, 19, 18) | **0** (0, 0, 0) | **2,262** (2,297, 2,262, 2,210) |

### jsonc

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **111** (122, 111, 110) | **51** (51, 47, 53) | **87** (84, 87, 89) | **89** (85, 90, 89) | **85** (85, 88, 85) | **116** (121, 116, 115) |
| 10 MiB | **939** (1,070, 939, 924) | **312** (315, 312, 312) | **633** (639, 633, 632) | **649** (652, 649, 649) | **640** (640, 642, 639) | **815** (815, 820, 813) |
| 50 MiB | **7,694** (8,250, 7,694, 6,575) | **1,551** (1,551, 1,558, 1,546) | **6,196** (6,312, 5,228, 6,196) | **5,192** (6,340, 5,139, 5,192) | **6,142** (5,435, 6,142, 6,181) | **8,813** (9,054, 8,813, 7,804) |

After the text was parsed (jsonc):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **36** (36, 35, 38) |
| 10 MiB | **0** (0, 0, 0) | **3** (3, 3, 3) | **0** (0, 0, 0) | **188** (192, 184, 188) |
| 50 MiB | **0** (0, 0, 0) | **18** (18, 17, 18) | **0** (0, 0, 0) | **1,403** (1,403, 1,430, 1,387) |

### json5

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **61** (75, 61, 61) | **39** (44, 25, 39) | **58** (58, 62, 58) | **61** (58, 62, 61) | **58** (66, 57, 58) | **103** (104, 103, 101) |
| 10 MiB | **528** (696, 528, 514) | **265** (261, 265, 275) | **526** (526, 544, 519) | **539** (554, 539, 523) | **535** (535, 533, 549) | **740** (752, 740, 732) |
| 50 MiB | **6,246** (6,648, 4,954, 6,246) | **1,341** (1,341, 1,336, 1,349) | **5,076** (5,076, 5,053, 5,987) | **5,013** (4,888, 5,919, 5,013) | **5,627** (5,692, 5,627, 4,545) | **9,103** (9,831, 8,579, 9,103) |

After the text was parsed (json5):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **40** (44, 39, 40) |
| 10 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **208** (208, 210, 206) |
| 50 MiB | **0** (1, 0, 0) | **1** (1, 1, 0) | **0** (0, 0, 0) | **2,323** (2,323, 2,339, 2,218) |

## Memory

**Retained heap** is what one parse result (data, tree, tokens, style, diagnostics) keeps alive
after a full collection, so what a host holding the parsed document pays; **parseData heap** is
the same for `parseData`'s result (the data alone), measured first. **Max RSS** is the
peak resident memory of the measuring process over the whole cell (source text, every parse and
edit), in MiB. The heap ceiling is raised because with the GitHub runner's default (about 2 GiB)
the first run of this benchmark ran out of heap in the json 50 MiB cell
([run 37852960823](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/37852960823)).

| Size | json retained heap | json parseData heap | json max RSS | jsonc retained heap | jsonc parseData heap | jsonc max RSS | json5 retained heap | json5 parseData heap | json5 max RSS |
|---|---|---|---|---|---|---|---|---|---|
| 1 MiB | 31 | 1 | 248 | 30 | 2 | 244 | 26 | 2 | 229 |
| 10 MiB | 406 | 12 | 1,791 | 396 | 20 | 1,693 | 342 | 21 | 1,643 |
| 50 MiB | 2,061 | 58 | 5,929 | 2,007 | 100 | 5,786 | 1,731 | 105 | 5,732 |

## Spec 008 criterion 7: parseData against parse

For jsonc and json5 at 10 and 50 MiB, `parseData`'s median time and its retained heap must each be
at most 50% of `parse`'s, in this run. json takes `JSON.parse`, so it is shown but not judged.

| Format | Size | time parseData ÷ parse | heap parseData ÷ parse | Result |
|---|---|---|---|---|
| json | 1 MiB | 5% (6 ÷ 120 ms) | 4% (1 ÷ 31 MiB) | not judged |
| json | 10 MiB | 5% (59 ÷ 1,069 ms) | 3% (12 ÷ 406 MiB) | not judged |
| json | 50 MiB | 4% (357 ÷ 8,331 ms) | 3% (58 ÷ 2,061 MiB) | not judged |
| jsonc | 1 MiB | 46% (51 ÷ 111 ms) | 7% (2 ÷ 30 MiB) | not judged |
| jsonc | 10 MiB | 33% (312 ÷ 939 ms) | 5% (20 ÷ 396 MiB) | pass |
| jsonc | 50 MiB | 20% (1,551 ÷ 7,694 ms) | 5% (100 ÷ 2,007 MiB) | pass |
| json5 | 1 MiB | 64% (39 ÷ 61 ms) | 8% (2 ÷ 26 MiB) | not judged |
| json5 | 10 MiB | 50% (265 ÷ 528 ms) | 6% (21 ÷ 342 MiB) | **fail** |
| json5 | 50 MiB | 21% (1,341 ÷ 6,246 ms) | 6% (105 ÷ 1,731 MiB) | pass |

Verdict: **criterion 7 does not hold** in this run.

## Against UNK-014's edit budget (< 500 ms)

applyPatch is only the host part of an edit: the UI, the message and `workspace.applyEdit` come on
top (`bench/vscode-open.md`). So a cell over 500 ms here misses the budget whatever else happens;
one under it is necessary, not sufficient. The cells use the host's case, a text already parsed.

| Size | json | jsonc | json5 |
|---|---|---|---|
| 1 MiB | within, slowest op 42 | within, slowest op 36 | within, slowest op 40 |
| 10 MiB | within, slowest op 398 | within, slowest op 188 | within, slowest op 208 |
| 50 MiB | over, slowest op 2,262 | over, slowest op 1,403 | over, slowest op 2,323 |

Medians relative to parse, over all sizes and formats (edit ÷ parse): replace 0.7–1.0×, add 0.7–1.0×, remove 0.7–1.0×, move 0.9–1.7×.

An edit on a text core has not parsed parses it once (tree and tokens) before it edits, so its
time grows with file size like parse time does. On a parsed text, replace, add and remove only
compute the change and write the new text; move also shifts the tree and tokens after the
removed record.

To reproduce: `pnpm --filter @chr-json-editor/core build`, then
`pnpm --filter @chr-json-editor/bench bench:core` (or the `bench` workflow, `.github/workflows/bench.yml`).
