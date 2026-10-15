# Large-file mode benchmark (008 T5)

> Evidence for spec 008 criterion 11, UNK-041 and plan risks R5 and R6, and for UNK-068 (spec 015 criterion 12). Written by
> `bench/large-file-report.mjs` from one benchmark run (`bench/large-file.mjs`); do not edit by hand.

## Run

- Where: GitHub Actions, [run 38611914239](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/38611914239); commit `3123970f0f4ca03ab9d1ab8ee9be8a4d5141714e`.
- Machine: Linux x64 (`ubuntu24`), 4 × AMD EPYC 9V74 80-Core Processor, 16 GiB RAM.
- VS Code 1.141.2 (`--disable-gpu`, under xvfb), the e2e .vsix (release build plus test hooks). UNK-041's limit in that build: 10,485,760 bytes.
- 3 runs per file; each cell is **median** (run 1, run 2, run 3), in milliseconds unless it says MiB. The editor is closed between runs, so every run opens the file again in the same VS Code window.
- Files: `node bench/generate.mjs --formats`, the same 7-field records as `bench/vscode-open.md` in one pretty-printed array, exactly N × 2^20 bytes, ASCII only: JSON; JSONC with a line comment above each record; JSON5 with unquoted keys, single-quoted strings and a trailing comma in each object. Every file is above the 5 MiB threshold, so it opens in large-file mode (locked).
- Schema: `bench/large-file.schema.json` (draft-07: every record's fields, types, a zip pattern), associated through `json.schemas` (JSON, JSONC) and `json5.schemas` (JSON5) in user settings. Every file is valid against it.

## Open

| File | Webview ready | First render | Render minus ready | Host busy on open | badge | validation |
|---|---|---|---|---|---|---|
| JSON 6 MiB | **943** (1,011, 943, 865) | **1,212** (1,330, 1,212, 1,176) | **311** (319, 268, 311) | **401** (446, 401, 327) | **349** (358, 349, 262) | **65** (87, 52, 65) |
| JSONC 6 MiB | **556** (555, 631, 556) | **948** (1,002, 948, 916) | **361** (447, 316, 361) | **190** (163, 226, 190) | **134** (134, 145, 131) | **59** (29, 81, 59) |
| JSON5 6 MiB | **432** (432, 436, 429) | **617** (617, 604, 656) | **185** (185, 168, 226) | **94** (122, 93, 94) | **58** (76, 41, 58) | **46** (46, 52, 37) |
| JSON 10 MiB | **1,049** (1,295, 1,049, 990) | **1,332** (1,603, 1,332, 1,331) | **308** (308, 282, 341) | **462** (575, 442, 462) | **389** (503, 387, 389) | **73** (73, 55, 73) |
| JSONC 10 MiB | **829** (853, 829, 828) | **1,275** (1,261, 1,275, 1,300) | **446** (408, 446, 472) | **278** (345, 278, 271) | **221** (261, 221, 203) | **68** (84, 57, 68) |
| JSON5 10 MiB | **617** (617, 575, 640) | **858** (843, 858, 875) | **234** (226, 284, 234) | **149** (218, 149, 137) | **79** (80, 78, 79) | **71** (138, 71, 58) |
| JSON 50 MiB | **4,733** (4,560, 4,759, 4,733) | **5,694** (5,684, 5,754, 5,694) | **995** (1,124, 995, 961) | **2,383** (2,383, 2,386, 2,324) | **2,119** (2,133, 2,119, 2,069) | **255** (250, 267, 255) |
| JSONC 50 MiB | **4,027** (4,337, 3,636, 4,027) | **5,601** (5,906, 5,175, 5,601) | **1,569** (1,569, 1,539, 1,574) | **1,380** (1,380, 1,377, 1,558) | **1,158** (1,158, 1,138, 1,168) | **239** (222, 239, 391) |
| JSON5 50 MiB | **2,397** (2,654, 2,362, 2,397) | **3,184** (3,438, 3,159, 3,184) | **787** (784, 797, 787) | **651** (842, 637, 651) | **396** (536, 394, 396) | **255** (306, 243, 255) |

- **Webview ready:** from `vscode.openWith` until the webview script sends `ready` (VS Code reads the file, syncs it to the extension host, creates the webview, loads webview.js). On the extension host's clock.
- **First render:** from the same start until the tree shows the root's "<n> items": the host sends the text (`init`), the webview parses it (`JSON.parse` for JSON, core's `parseData` for JSONC and JSON5) and the library renders the tree, read-only.
- **Render minus ready:** the part our code adds on top of VS Code, per run, then the median.
- **Host busy on open:** the extension host's own time on the tab's format badge and on schema validation, from the open until the webview showed the first validation result and 2.5 s more passed. Validation here is the `$schema` lookup, compiling the schema, the data-only parse, Ajv and posting the result; it runs once when the schema is bound and once more when the webview is ready (spec 004), and the second run parses again when the first parse is older than 2 s (`largeFile.ts` `dataOf`, 008 T3 review finding 2). The benchmark lifts UNK-041's limit so validation runs on open at every size: above the limit (below) only the badge's part stays.

## Spec 008 criterion 11 (at 50 MiB, render minus ready < 5,000 ms per format)

| Format | Render minus ready | Verdict |
|---|---|---|
| JSON | 995 | pass |
| JSONC | 1,569 | pass |
| JSON5 | 787 | pass |

Criterion 11: **holds**.

## UNK-068: big numbers on in large-file mode (spec 015 criterion 12)

The same files with every record's `id` written as 19 digits (10^18 + i, a big number: `node bench/generate.mjs --formats --big-ids`), opened in large-file mode with big numbers kept exact (015 T6): the webview reads strict JSON with core's `readJsonExact` (lossless-json) and JSONC and JSON5 with core's `parseData`, every big id an `EditorNumber`. UNK-068's rule: in one CI run, spec 008 criterion 7 (in `bench/RESULTS.md`, same run) and criterion 11 below both pass with big numbers on.

| File | Webview ready | First render | Render minus ready | Host busy on open | Webview heap (MiB) |
|---|---|---|---|---|---|
| JSON big ids 6 MiB | **860** (871, 795, 860) | **1,120** (1,165, 1,036, 1,120) | **261** (294, 240, 261) | **497** (575, 474, 497) | **138** (107, 138, 168) |
| JSONC big ids 6 MiB | **604** (573, 624, 604) | **951** (887, 1,082, 951) | **347** (314, 457, 347) | **251** (244, 251, 275) | **83** (198, 50, 83) |
| JSON5 big ids 6 MiB | **474** (484, 465, 474) | **681** (746, 674, 681) | **208** (262, 208, 208) | **214** (214, 205, 216) | **84** (49, 84, 116) |
| JSON big ids 10 MiB | **1,286** (1,432, 1,264, 1,286) | **1,699** (1,755, 1,699, 1,627) | **341** (322, 435, 341) | **819** (993, 799, 819) | **190** (190, 235, 85) |
| JSONC big ids 10 MiB | **910** (910, 816, 926) | **1,371** (1,466, 1,272, 1,371) | **456** (556, 456, 445) | **439** (471, 379, 439) | **175** (130, 175, 223) |
| JSON5 big ids 10 MiB | **680** (680, 633, 860) | **988** (988, 923, 1,201) | **308** (308, 290, 342) | **333** (333, 295, 414) | **138** (90, 138, 186) |
| JSON big ids 50 MiB | **6,387** (6,503, 6,332, 6,387) | **7,598** (7,608, 7,431, 7,598) | **1,105** (1,105, 1,099, 1,211) | **4,134** (4,134, 4,293, 4,080) | **153** (151, 153, 206) |
| JSONC big ids 50 MiB | **4,048** (3,995, 4,048, 4,313) | **5,775** (5,742, 5,775, 6,045) | **1,732** (1,747, 1,727, 1,732) | **1,968** (1,968, 1,903, 2,082) | **203** (153, 203, 204) |
| JSON5 big ids 50 MiB | **3,192** (3,192, 3,190, 3,200) | **4,174** (4,217, 4,158, 4,174) | **974** (1,024, 968, 974) | **1,314** (1,340, 1,314, 1,310) | **166** (164, 166, 168) |

Spec 008 criterion 11 with big ids (at 50 MiB, render minus ready < 5,000 ms per format):

| Format | Render minus ready | Without big ids | Verdict |
|---|---|---|---|
| JSON big ids | 1,105 | 995 | pass |
| JSONC big ids | 1,732 | 1,569 | pass |
| JSON5 big ids | 974 | 787 | pass |

Criterion 11 with big ids: **holds**.

## UNK-041: validation of one large file (< 1,000 ms)

One validation from the text alone, as the paused item's click runs it: core's `parseData` plus Ajv, start to result posted, in the extension host (test hook `timeValidation`, which first drops the data `dataOf` keeps).

| Size | JSON | JSONC | JSON5 | All under 1,000 ms |
|---|---|---|---|---|
| 6 MiB | **46** (46, 52, 41) | **133** (144, 130, 133) | **52** (52, 63, 50) | yes |
| 10 MiB | **74** (66, 74, 77) | **230** (230, 230, 228) | **92** (92, 97, 85) | yes |
| 50 MiB | **367** (369, 367, 359) | **1,225** (1,213, 1,253, 1,225) | **489** (492, 489, 486) | no |

The rule reads "the largest size in `bench/large-file.md` where … the median of 3 runs … is < 1 s"; a size counts when it holds for JSON, JSONC and JSON5 alike, since the limit is one number for every format. Sizes count from the smallest up, so a size above one that fails does not count.

Result: **10 MiB** = 10,485,760 bytes. Up to it a large file validates on open and on change; above it validation is paused and runs once per click on "Schema validation paused: large file".

## Memory (plan R6)

JavaScript heap in use, in MiB, after the open and the timed validation: the extension host's (`process.memoryUsage().heapUsed`, shared with every other extension) and the webview's (Chromium's `performance.memory.usedJSHeapSize`).

| File | Extension host | Webview |
|---|---|---|
| JSON 6 MiB | **91** (67, 91, 128) | **22** (22, 22, 55) |
| JSONC 6 MiB | **112** (155, 74, 112) | **74** (47, 74, 101) |
| JSON5 6 MiB | **170** (162, 170, 209) | **62** (33, 62, 76) |
| JSON 10 MiB | **168** (98, 168, 232) | **76** (156, 76, 61) |
| JSONC 10 MiB | **164** (93, 164, 216) | **112** (112, 148, 70) |
| JSON5 10 MiB | **155** (98, 155, 203) | **113** (113, 110, 146) |
| JSON 50 MiB | **430** (430, 257, 432) | **152** (164, 152, 152) |
| JSONC 50 MiB | **352** (1,616, 294, 352) | **114** (122, 114, 114) |
| JSON5 50 MiB | **2,652** (359, 2,652, 2,690) | **129** (122, 129, 135) |

## "Edit anyway" at 50 MiB (plan R5)

After each open at 50 MiB: "Edit anyway", then one tree edit (a `replace` of the first record's `name`, test hook `patch`) timed as `bench/vscode-open.md` times it: on the webview's clock until the host's answer is in and the editor is free again. The host parses the whole text on this first edit (spec 003's path) and keeps that parse for the next one. Validation is paused, as above UNK-041's limit.

| Format | One edit | value shown | host applies it | Host heap after (MiB) |
|---|---|---|---|---|
| JSON | **7,872** (8,381, 7,872, 7,158) | **11** (11, 10, 12) | **6,462** (6,740, 6,462, 5,875) | **2,737** (2,754, 2,726, 2,737) |
| JSONC | **9,070** (8,908, 9,070, 9,883) | **14** (9, 15, 14) | **6,322** (6,180, 6,322, 7,321) | **2,549** (2,493, 2,549, 2,581) |
| JSON5 | **4,434** (4,434, 4,180, 4,520) | **12** (10, 12, 14) | **3,481** (3,481, 2,986, 3,490) | **2,368** (2,276, 2,368, 2,597) |

## Errors

None: every run of every file completed.
