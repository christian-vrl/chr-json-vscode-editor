# Large-file benchmark: open, first render, one edit (003 T11)

> Evidence for UNK-014. Written by `bench/report.mjs` from one benchmark run; do not edit by hand.
> Measured end to end in the custom editor's webview (after 003 T5).

## Run

- Where: GitHub Actions, [run 37858841314](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/37858841314); commit `8fe26109e0fdcf325686e8797f054727012b46e3`.
- Machine: Linux x64 (`ubuntu24`), 2 × AMD EPYC 7763 64-Core Processor, 8 GiB RAM.
- VS Code 1.141.0 (stable at run time, `--disable-gpu`, under xvfb), the e2e .vsix (release build plus test hooks).
- 3 runs per size; each cell is **median** (run 1, run 2, run 3), in milliseconds on the extension host's clock. The editor is closed between runs, so every run opens the file again in the same VS Code window; the edit runs right after each open.
- Files: `node bench/generate.mjs`, one pretty-printed JSON array of 7-field records per size, exactly N × 2^20 bytes (MiB, the unit of VS Code's own file limits), ASCII only.
- 100 MiB is not measured: VS Code does not hand files above 50 MB to extensions ("Files above 50MB cannot be synchronized with extensions"), so the custom editor never opens it ([run 37844893412](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/37844893412)).

## Results

| Size | Webview ready | First render | One edit | of which host | of which webview |
|---|---|---|---|---|---|
| 1 MiB (1,048,576 B) | **871** (1,887, 833, 871) | **1,451** (2,609, 1,442, 1,451) | **858** (858, 901, 603) | **328** (333, 328, 141) | **525** (525, 572, 463) |
| 10 MiB (10,485,760 B) | **2,779** (5,331, 2,690, 2,779) | **4,349** (7,899, 4,349, 4,334) | **4,486** (4,486, 5,158, 3,891) | **1,136** (986, 1,136, 1,224) | **3,500** (3,500, 4,022, 2,667) |
| 50 MiB (52,428,800 B) | **13,836** (13,836, 14,146, 13,579) | **22,385** (23,393, 22,385, 22,353) | **28,442** (28,664, 28,442, 28,165) | **6,089** (6,071, 6,232, 6,089) | **22,210** (22,593, 22,210, 22,076) |

## Against UNK-014's rule (open < 3 s, one edit < 500 ms)

"Open" is the first render: the time until the user sees the document in the tree.

| Size | First render | One edit | Verdict |
|---|---|---|---|
| 1 MiB | 1,451 | 858 | miss: edit too slow |
| 10 MiB | 4,349 | 4,486 | miss: open too slow, edit too slow |
| 50 MiB | 22,385 | 28,442 | miss: open too slow, edit too slow |

**No measured size passes**, not even 1 MiB.

## webview.js, minified and not (1 MiB)

| Build | webview.js | Webview ready | First render |
|---|---|---|---|
| minified (shipped) | 938 KiB | **871** (1,887, 833, 871) | **1,451** (2,609, 1,442, 1,451) |
| unminified | 1,475 KiB | **813** (1,606, 667, 813) | **1,169** (2,247, 1,003, 1,169) |

## What is measured

- **Webview ready:** from `vscode.openWith(uri, "chrJsonEditor.editor")` until the webview script
  sends `ready`. Covers VS Code reading the file, syncing it to the extension host, creating the
  webview and loading webview.js.
- **First render:** from the same start until the tree shows the root's "<n> items" tag. On top of
  ready: the host sends the text (`init`), the webview parses it with `core` (the library's
  `parser` prop, criterion 10) and the library renders the tree.
- **One edit:** a `replace` of the first record's `name`, sent down the webview's edit path (test
  hook `patch`: the same `edit` message a tree edit sends, without the click and typing). Timed until
  the tree shows the new value. **Host:** until the document changed: the message, `core`
  applyPatch (which parses the whole text) and the WorkspaceEdit. **Webview:** the rest: the
  `update` message with the full text, `core` parsing it again in the webview, and the render.

To reproduce: `pnpm build && CHR_TEST_HOOKS=1 pnpm package`, then `xvfb-run -a pnpm --filter
@chr-json-editor/bench bench` (or the `bench` workflow, `.github/workflows/bench.yml`).
