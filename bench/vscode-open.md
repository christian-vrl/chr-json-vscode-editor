# Large-file benchmark: open, first render, one edit (003 T11)

> Evidence for UNK-014. Written by `bench/report.mjs` from one benchmark run; do not edit by hand.
> Measured end to end in the custom editor's webview (after 003 T5).

## Run

- Where: GitHub Actions, [run 37874204494](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/37874204494); commit `1b50e1d11d99e9a52f158831c148713bc99caf72`.
- Machine: Linux x64 (`ubuntu24`), 2 × AMD EPYC 7763 64-Core Processor, 8 GiB RAM.
- VS Code 1.141.0 (stable at run time, `--disable-gpu`, under xvfb), the e2e .vsix (release build plus test hooks).
- 3 runs per size; each cell is **median** (run 1, run 2, run 3), in milliseconds (the edit on the webview's clock, the rest on the extension host's). The editor is closed between runs, so every run opens the file again in the same VS Code window; the edit runs right after each open.
- Files: `node bench/generate.mjs`, one pretty-printed JSON array of 7-field records per size, exactly N × 2^20 bytes (MiB, the unit of VS Code's own file limits), ASCII only.
- 100 MiB is not measured: VS Code does not hand files above 50 MB to extensions ("Files above 50MB cannot be synchronized with extensions"), so the custom editor never opens it ([run 37844893412](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/37844893412)).

## Results

| Size | Webview ready | First render | One edit | value shown | host applies it | Second edit |
|---|---|---|---|---|---|---|
| 1 MiB (1,048,576 B) | **1,016** (1,823, 529, 1,016) | **1,267** (2,116, 701, 1,267) | **151** (148, 151, 197) | **27** (21, 27, 39) | **90** (75, 90, 94) | **366** (376, 366, 98) |
| 5 MiB (5,242,880 B) | **2,019** (2,019, 2,187, 1,194) | **2,613** (2,651, 2,613, 1,406) | **515** (587, 515, 253) | **36** (55, 36, 14) | **194** (275, 194, 115) | **370** (370, 494, 317) |
| 10 MiB (10,485,760 B) | **2,352** (2,004, 2,352, 2,360) | **2,881** (2,564, 2,901, 2,881) | **588** (601, 588, 550) | **43** (17, 43, 45) | **209** (190, 227, 209) | **553** (894, 553, 418) |
| 50 MiB (52,428,800 B) | **11,323** (11,234, 11,323, 13,361) | **13,087** (13,087, 13,032, 15,033) | **3,737** (4,085, 3,737, 3,394) | **49** (40, 49, 149) | **1,632** (1,938, 1,495, 1,632) | **4,351** (4,351, 4,427, 3,452) |

## Against UNK-014's rule (open < 3 s, one edit < 500 ms)

"Open" is the first render: the time until the user sees the document in the tree.

Both edits count: the slower median of the first and the second edit must be under 500 ms.

| Size | First render | One edit | Second edit | Verdict |
|---|---|---|---|---|
| 1 MiB | 1,267 | 151 | 366 | pass |
| 5 MiB | 2,613 | 515 | 370 | miss: edit too slow |
| 10 MiB | 2,881 | 588 | 553 | miss: edit too slow |
| 50 MiB | 13,087 | 3,737 | 4,351 | miss: open too slow, edit too slow |

Largest size that passes: **1 MiB**.

## The same in a second VS Code launch

Timed again after the first launch closed, on the same runner: how far one launch's medians
can move. The verdict above uses the first launch.

| Size | Webview ready | First render | One edit | value shown | Second edit |
|---|---|---|---|---|---|
| 1 MiB | **474** (1,756, 474, 454) | **600** (2,169, 600, 585) | **143** (143, 132, 143) | **18** (18, 19, 18) | **341** (341, 201, 349) |

## What is measured

- **Webview ready:** from `vscode.openWith(uri, "chrJsonEditor.editor")` until the webview script
  sends `ready`. Covers VS Code reading the file, syncing it to the extension host, creating the
  webview and loading webview.js.
- **First render:** from the same start until the tree shows the root's "<n> items" tag. On top of
  ready: the host sends the text (`init`), the webview parses it (the library's `parser` prop,
  criterion 10: `JSON.parse` for strict JSON, else `core`) and the library renders the tree.
- **One edit:** a `replace` of the first record's `name`, made down the webview's edit path (test
  hook `patch`: the library applies it, as a tree edit does, and the same `edit` message goes to
  the host, without the click and typing). Timed on the webview's clock, where the edit starts,
  until the host's answer is in and the editor is free again: nothing in flight, the document
  shown. The answer carries the whole new text; the webview keeps the data it already shows.
  **Value shown:** until the tree shows the new value, which it does before the host answers.
  **Host applies it:** on the host's clock, from sending the patch until the document changed:
  the message, `core` applyPatch and the WorkspaceEdit. After the change the host parses the new
  text once in the background (format badge, schema validation, the next edit), which can delay
  an edit made right after.
- **Second edit:** the same edit with another value, made as soon as the first settled: the host
  now edits the text its first edit produced, not the one it parsed on open. Run 1 of each size
  is the first open of that file in this VS Code launch (cold); runs 2 and 3 open it again.

To reproduce: `pnpm build && CHR_TEST_HOOKS=1 pnpm package`, then `xvfb-run -a pnpm --filter
@chr-json-editor/bench bench` (or the `bench` workflow, `.github/workflows/bench.yml`).
