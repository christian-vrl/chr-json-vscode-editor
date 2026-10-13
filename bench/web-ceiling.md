# Web host ceiling (013 T5)

> Evidence for UNK-054 and spec 013 criterion 10. Written by `bench/web-ceiling-report.mjs` from
> one benchmark run (`bench/web-ceiling.mjs`); do not edit by hand.

## Run

- Where: GitHub Actions, [run 38444337977](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/38444337977); commit `ecdb2572be61bd0faf8a46c4b4035aaf9c1eeeff`.
- Machine: Linux x64, 4 × AMD EPYC 9V74 80-Core Processor, 16 GiB RAM.
- The CI route of `pnpm test:e2e:web` (`test/web/run.mjs --ceiling`): `@vscode/test-web` with VS Code stable's web build in headless Chromium (`Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.8078.4 Safari/537.36`), the e2e .vsix, the documents mounted on `vscode-test-web://mount/ceiling/`.
- 3 runs, each a fresh browser and workbench; within a run every document is opened once, smallest first, with "Open in CHR JSON Editor", and the editor is closed before the next.
- Documents: `bench/generate.mjs` `documentText`, the 7-field records of `bench/vscode-open.md` in one pretty-printed JSON array, ASCII only, of exactly the size named.
- Rule (UNK-054): a size passes when, in 3 of 3 runs, the tab opens locked in large-file mode, shows spec 008's banner within 30 s, the webview still answers 5 s after the tree shows every record, and neither the page nor the extension host worker crashes.

## Result

- **Web ceiling: 52,428,800 bytes (50 MiB), VS Code's ceiling.** The web host uses spec 008's ceiling unchanged.
- 52,428,801 bytes (one over the ceiling): refused in every run with spec 008 criterion 9's message.

## Opens

Times are from running the command, on the extension host's clock. The webview heap is Chromium's `performance.memory.usedJSHeapSize`, which Chromium rounds to coarse buckets without `--enable-precise-memory-info`: read it as an order of magnitude.

| Size | Run | Verdict | Large-file mode | Banner (ms) | Webview ready (ms) | Tree shown (ms) | Webview heap |
|---|---|---|---|---|---|---|---|
| 5,242,881 bytes | 1 | pass | locked, 5,242,881 bytes | 835 | 701 | 835 | 347 MiB |
| 5,242,881 bytes | 2 | pass | locked, 5,242,881 bytes | 879 | 737 | 880 | 347 MiB |
| 5,242,881 bytes | 3 | pass | locked, 5,242,881 bytes | 1,076 | 927 | 1,077 | 347 MiB |
| 10 MiB | 1 | pass | locked, 10,485,760 bytes | 1,319 | 1,074 | 1,321 | 347 MiB |
| 10 MiB | 2 | pass | locked, 10,485,760 bytes | 1,373 | 1,118 | 1,374 | 347 MiB |
| 10 MiB | 3 | pass | locked, 10,485,760 bytes | 1,328 | 1,093 | 1,329 | 347 MiB |
| 25 MiB | 1 | pass | locked, 26,214,400 bytes | 2,710 | 2,292 | 2,729 | 347 MiB |
| 25 MiB | 2 | pass | locked, 26,214,400 bytes | 3,040 | 2,611 | 3,059 | 347 MiB |
| 25 MiB | 3 | pass | locked, 26,214,400 bytes | 3,009 | 2,664 | 3,025 | 347 MiB |
| 50 MiB | 1 | pass | locked, 52,428,800 bytes | 5,009 | 4,238 | 5,011 | 347 MiB |
| 50 MiB | 2 | pass | locked, 52,428,800 bytes | 4,950 | 4,166 | 4,952 | 347 MiB |
| 50 MiB | 3 | pass | locked, 52,428,800 bytes | 4,847 | 4,156 | 4,850 | 347 MiB |
| 52,428,801 bytes | 1 | refused (expected) | refused: 52428801.json is 50.0 MiB. VS Code does not pass files above 50 MB to extensions, so CHR JSON Editor can't open it. | — | — | — | — |
| 52,428,801 bytes | 2 | refused (expected) | refused: 52428801.json is 50.0 MiB. VS Code does not pass files above 50 MB to extensions, so CHR JSON Editor can't open it. | — | — | — | — |
| 52,428,801 bytes | 3 | refused (expected) | refused: 52428801.json is 50.0 MiB. VS Code does not pass files above 50 MB to extensions, so CHR JSON Editor can't open it. | — | — | — | — |

## VS Code's sync limit in the web host

`vscode.workspace.openTextDocument` on the two largest documents (008 T4 measured desktop: 50 × 2^20 UTF-16 code units open, one more does not).

| Size | Run | Opens | Text length or error |
|---|---|---|---|
| 50 MiB | 1 | yes | 52,428,800 |
| 52,428,801 bytes | 1 | no | CodeExpectedError: cannot open vscode-test-web://mount/ceiling/52428801.json. Detail: Files above 50MB cannot be synchronized with extensions. |
| 50 MiB | 2 | yes | 52,428,800 |
| 52,428,801 bytes | 2 | no | CodeExpectedError: cannot open vscode-test-web://mount/ceiling/52428801.json. Detail: Files above 50MB cannot be synchronized with extensions. |
| 50 MiB | 3 | yes | 52,428,800 |
| 52,428,801 bytes | 3 | no | CodeExpectedError: cannot open vscode-test-web://mount/ceiling/52428801.json. Detail: Files above 50MB cannot be synchronized with extensions. |

## Crashes and exit codes

- Run 1: exit 0; no page crash, the extension host worker stayed up. Workers started: `blob:http://v--1jik8ed3b5k5h5emvcpnn6ggnndfjv285meevvt7ff2m9p5qu6k5.localhost:3000/5509c413-07aa-4751-93b7-ca4a6aa3bb9b`, `blob:http://v--1jik8ed3b5k5h5emvcpnn6ggnndfjv285meevvt7ff2m9p5qu6k5.localhost:3000/bcd4c9e7-0e82-4154-b2c8-e051c397709b`, `blob:http://localhost:3000/783b5fcc-5a6a-4ddf-a95b-9226ec7b867b`; other workers closed before the end: `blob:http://localhost:3000/783b5fcc-5a6a-4ddf-a95b-9226ec7b867b`.
- Run 2: exit 0; no page crash, the extension host worker stayed up. Workers started: `blob:http://v--045nhrntpk2mq1ou1e98uojsn0qif03h3qe25n1flhkakldbf5tv.localhost:3000/f14ca3be-869d-4439-a1d6-552b13d4836c`, `blob:http://v--045nhrntpk2mq1ou1e98uojsn0qif03h3qe25n1flhkakldbf5tv.localhost:3000/4ae54463-eceb-409d-86ec-cdbb631ffdac`, `blob:http://localhost:3000/acb2c6a3-de68-4a82-b8bb-55fe9fa72215`; other workers closed before the end: `blob:http://localhost:3000/acb2c6a3-de68-4a82-b8bb-55fe9fa72215`.
- Run 3: exit 0; no page crash, the extension host worker stayed up. Workers started: `blob:http://v--05e3e9rqu0d86l8cgdbggnm6ikb3fhfp65shp3a5rp2k3m9mspva.localhost:3000/b5b0c3af-171e-4270-85f6-9ee94b60e87b`, `blob:http://v--05e3e9rqu0d86l8cgdbggnm6ikb3fhfp65shp3a5rp2k3m9mspva.localhost:3000/ef8dc81b-4a41-4901-be5c-b1d9e192768d`, `blob:http://localhost:3000/aef55d88-64bd-4b2f-8d41-f21e10157925`; other workers closed before the end: `blob:http://localhost:3000/aef55d88-64bd-4b2f-8d41-f21e10157925`.
