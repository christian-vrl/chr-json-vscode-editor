# Large-file mode benchmark (008 T5)

> Evidence for spec 008 criterion 11, UNK-041 and plan risks R5 and R6. Written by
> `bench/large-file-report.mjs` from one benchmark run (`bench/large-file.mjs`); do not edit by hand.

## Run

- Where: GitHub Actions, [run 38169445043](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/38169445043); commit `83bba5a4d1b27e3d585d2e19bd01cd87510c854f`.
- Machine: Linux x64 (`ubuntu24`), 4 × AMD EPYC 7763 64-Core Processor, 16 GiB RAM.
- VS Code 1.141.0 (`--disable-gpu`, under xvfb), the e2e .vsix (release build plus test hooks). UNK-041's limit in that build: 5,242,880 bytes.
- 3 runs per file; each cell is **median** (run 1, run 2, run 3), in milliseconds unless it says MiB. The editor is closed between runs, so every run opens the file again in the same VS Code window.
- Files: `node bench/generate.mjs --formats`, the same 7-field records as `bench/vscode-open.md` in one pretty-printed array, exactly N × 2^20 bytes, ASCII only: JSON; JSONC with a line comment above each record; JSON5 with unquoted keys, single-quoted strings and a trailing comma in each object. Every file is above the 5 MiB threshold, so it opens in large-file mode (locked).
- Schema: `bench/large-file.schema.json` (draft-07: every record's fields, types, a zip pattern), associated through `json.schemas` (JSON, JSONC) and `json5.schemas` (JSON5) in user settings. Every file is valid against it.

## Open

| File | Webview ready | First render | Render minus ready | Host busy on open | badge | validation |
|---|---|---|---|---|---|---|
| JSON 6 MiB | **939** (993, 939, 757) | **1,237** (1,252, 1,237, 1,149) | **297** (259, 297, 392) | **359** (379, 359, 274) | **335** (336, 335, 245) | **29** (43, 25, 29) |
| JSONC 6 MiB | **576** (576, 555, 615) | **1,032** (1,032, 921, 1,045) | **430** (456, 366, 430) | **158** (153, 171, 158) | **134** (134, 144, 128) | **27** (19, 27, 30) |
| JSON5 6 MiB | **414** (439, 409, 414) | **644** (644, 668, 621) | **207** (204, 260, 207) | **104** (111, 104, 104) | **84** (89, 84, 83) | **21** (22, 20, 21) |
| JSON 10 MiB | **965** (1,056, 965, 933) | **1,248** (1,402, 1,248, 1,223) | **289** (346, 283, 289) | **405** (481, 399, 405) | **385** (449, 379, 385) | **20** (32, 20, 20) |
| JSONC 10 MiB | **796** (797, 754, 796) | **1,238** (1,328, 1,191, 1,238) | **442** (530, 437, 442) | **242** (251, 242, 241) | **210** (215, 209, 210) | **33** (36, 33, 31) |
| JSON5 10 MiB | **588** (591, 588, 585) | **905** (950, 897, 905) | **320** (359, 309, 320) | **166** (158, 169, 166) | **134** (134, 126, 139) | **27** (25, 43, 27) |
| JSON 50 MiB | **4,657** (4,486, 4,657, 4,687) | **5,518** (5,476, 5,518, 5,748) | **990** (990, 861, 1,061) | **2,139** (2,132, 2,189, 2,139) | **2,070** (2,070, 2,103, 2,067) | **72** (62, 85, 72) |
| JSONC 50 MiB | **3,801** (3,801, 3,877, 3,515) | **5,345** (5,407, 5,345, 5,090) | **1,575** (1,607, 1,469, 1,575) | **1,260** (1,286, 1,260, 1,240) | **1,174** (1,201, 1,174, 1,155) | **85** (85, 86, 84) |
| JSON5 50 MiB | **2,661** (2,661, 2,617, 2,798) | **3,673** (3,673, 3,669, 3,789) | **1,012** (1,012, 1,052, 991) | **754** (754, 753, 788) | **672** (666, 672, 673) | **88** (88, 81, 115) |

- **Webview ready:** from `vscode.openWith` until the webview script sends `ready` (VS Code reads the file, syncs it to the extension host, creates the webview, loads webview.js). On the extension host's clock.
- **First render:** from the same start until the tree shows the root's "<n> items": the host sends the text (`init`), the webview parses it (`JSON.parse` for JSON, core's `parseData` for JSONC and JSON5) and the library renders the tree, read-only.
- **Render minus ready:** the part our code adds on top of VS Code, per run, then the median.
- **Host busy on open:** the extension host's own time on the tab's format badge and on schema validation, from the open until the webview showed the first validation result and 2.5 s more passed. Validation here is the `$schema` lookup, compiling the schema, the data-only parse, Ajv and posting the result; it runs once when the schema is bound and once more when the webview is ready (spec 004), and the second run parses again when the first parse is older than 2 s (`largeFile.ts` `dataOf`, 008 T3 review finding 2). The benchmark lifts UNK-041's limit so validation runs on open at every size: above the limit (below) only the badge's part stays.

## Spec 008 criterion 11 (at 50 MiB, render minus ready < 5,000 ms per format)

| Format | Render minus ready | Verdict |
|---|---|---|
| JSON | 990 | pass |
| JSONC | 1,575 | pass |
| JSON5 | 1,012 | pass |

Criterion 11: **holds**.

## UNK-041: validation of one large file (< 1,000 ms)

One validation from the text alone, as the paused item's click runs it: core's `parseData` plus Ajv, start to result posted, in the extension host (test hook `timeValidation`, which first drops the data `dataOf` keeps).

| Size | JSON | JSONC | JSON5 | All under 1,000 ms |
|---|---|---|---|---|
| 6 MiB | **23** (24, 23, 23) | **137** (137, 152, 124) | **87** (81, 89, 87) | yes |
| 10 MiB | **38** (38, 38, 39) | **228** (248, 228, 228) | **131** (124, 131, 131) | yes |
| 50 MiB | **224** (230, 218, 224) | **1,233** (1,233, 1,286, 1,179) | **682** (668, 688, 682) | no |

The rule reads "the largest size in `bench/large-file.md` where … the median of 3 runs … is < 1 s"; a size counts when it holds for JSON, JSONC and JSON5 alike, since the limit is one number for every format. Sizes count from the smallest up, so a size above one that fails does not count.

Result: **10 MiB** = 10,485,760 bytes. Up to it a large file validates on open and on change; above it validation is paused and runs once per click on "Schema validation paused: large file".

## Memory (plan R6)

JavaScript heap in use, in MiB, after the open and the timed validation: the extension host's (`process.memoryUsage().heapUsed`, shared with every other extension) and the webview's (Chromium's `performance.memory.usedJSHeapSize`).

| File | Extension host | Webview |
|---|---|---|
| JSON 6 MiB | **106** (98, 106, 136) | **21** (21, 21, 27) |
| JSONC 6 MiB | **115** (153, 81, 115) | **29** (26, 55, 29) |
| JSON5 6 MiB | **166** (131, 166, 200) | **56** (56, 72, 34) |
| JSON 10 MiB | **153** (141, 153, 246) | **47** (77, 47, 43) |
| JSONC 10 MiB | **161** (104, 161, 219) | **55** (55, 105, 51) |
| JSON5 10 MiB | **146** (93, 146, 206) | **96** (96, 96, 131) |
| JSON 50 MiB | **425** (248, 425, 425) | **95** (156, 95, 95) |
| JSONC 50 MiB | **414** (414, 360, 2,933) | **113** (113, 113, 113) |
| JSON5 50 MiB | **2,587** (2,890, 2,530, 2,587) | **127** (122, 572, 127) |

## "Edit anyway" at 50 MiB (plan R5)

After each open at 50 MiB: "Edit anyway", then one tree edit (a `replace` of the first record's `name`, test hook `patch`) timed as `bench/vscode-open.md` times it: on the webview's clock until the host's answer is in and the editor is free again. The host parses the whole text on this first edit (spec 003's path) and keeps that parse for the next one. Validation is paused, as above UNK-041's limit.

| Format | One edit | value shown | host applies it | Host heap after (MiB) |
|---|---|---|---|---|
| JSON | **9,046** (9,444, 8,586, 9,046) | **11** (12, 11, 9) | **7,895** (8,152, 7,346, 7,895) | **2,638** (2,618, 2,638, 2,638) |
| JSONC | **10,042** (9,953, 10,087, 10,042) | **11** (11, 10, 18) | **7,539** (7,417, 7,539, 7,559) | **2,462** (2,508, 2,461, 2,462) |
| JSON5 | **4,542** (4,542, 4,318, 4,571) | **12** (12, 12, 9) | **3,258** (3,414, 3,080, 3,258) | **2,183** (2,044, 2,183, 2,191) |

## Errors

None: every run of every file completed.
