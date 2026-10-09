# Large-file benchmark: open, first render, one edit (003 T11)

> Evidence for UNK-014. Written by `bench/report.mjs` from one benchmark run; do not edit by hand.
> Measured end to end in the custom editor's webview (after 003 T5).

## Run

- Where: GitHub Actions, [run 37867109909](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/37867109909); commit `e8040abc6745c57db8446c7ee354778d012ecbf6`.
- Machine: Linux x64 (`ubuntu24`), 2 × AMD EPYC 7763 64-Core Processor, 8 GiB RAM.
- VS Code 1.141.0 (stable at run time, `--disable-gpu`, under xvfb), the e2e .vsix (release build plus test hooks).
- 3 runs per size; each cell is **median** (run 1, run 2, run 3), in milliseconds (the edit on the webview's clock, the rest on the extension host's). The editor is closed between runs, so every run opens the file again in the same VS Code window; the edit runs right after each open.
- Files: `node bench/generate.mjs`, one pretty-printed JSON array of 7-field records per size, exactly N × 2^20 bytes (MiB, the unit of VS Code's own file limits), ASCII only.
- 100 MiB is not measured: VS Code does not hand files above 50 MB to extensions ("Files above 50MB cannot be synchronized with extensions"), so the custom editor never opens it ([run 37844893412](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/37844893412)).

## Results

| Size | Webview ready | First render | One edit | value shown | host applies it |
|---|---|---|---|---|---|
| 1 MiB (1,048,576 B) | **876** (920, 510, 876) | **1,031** (1,229, 638, 1,031) | **124** (124, 91, 154) | **22** (22, 17, 30) | **74** (77, 50, 74) |
| 5 MiB (5,242,880 B) | **1,385** (2,274, 1,385, 1,170) | **1,654** (2,631, 1,654, 1,525) | **492** (675, 482, 492) | **34** (21, 34, 36) | **197** (246, 197, 197) |
| 10 MiB (10,485,760 B) | **1,364** (2,300, 1,364, 1,249) | **1,940** (2,825, 1,940, 1,629) | **606** (701, 573, 606) | **34** (41, 34, 29) | **215** (215, 272, 205) |
| 50 MiB (52,428,800 B) | **8,435** (11,632, 8,435, 6,624) | **10,230** (13,359, 10,230, 8,088) | **3,897** (3,898, 3,897, 3,229) | **78** (43, 78, 101) | **1,555** (1,822, 1,555, 1,531) |

## Against UNK-014's rule (open < 3 s, one edit < 500 ms)

"Open" is the first render: the time until the user sees the document in the tree.

| Size | First render | One edit | Verdict |
|---|---|---|---|
| 1 MiB | 1,031 | 124 | pass |
| 5 MiB | 1,654 | 492 | pass |
| 10 MiB | 1,940 | 606 | miss: edit too slow |
| 50 MiB | 10,230 | 3,897 | miss: open too slow, edit too slow |

Largest size that passes: **5 MiB**.

## The same in a second VS Code launch

Timed again after the first launch closed, on the same runner: how far one launch's medians
can move. The verdict above uses the first launch.

| Size | Webview ready | First render | One edit | value shown |
|---|---|---|---|---|
| 1 MiB | **480** (1,657, 480, 458) | **610** (2,260, 610, 575) | **105** (275, 105, 96) | **21** (40, 21, 17) |

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

To reproduce: `pnpm build && CHR_TEST_HOOKS=1 pnpm package`, then `xvfb-run -a pnpm --filter
@chr-json-editor/bench bench` (or the `bench` workflow, `.github/workflows/bench.yml`).
