# TASKS 013 — Web extension (vscode.dev and github.dev)

> Derives from the plan. `[ ]` pending · `[~]` awaiting human gate · `[x]` done.
> No gate is crossed with open UNKNOWNS that affect the result.

## Phase A — Harness and entry (risk-free / additive)
- [x] **T1** Browser entry and both test routes: `src/web/extension.ts` and the second esbuild
  build to `dist/web/extension.js`; `"browser"` and `"capabilities": { "virtualWorkspaces": true }`
  in the manifest; Web Crypto nonce; `@vscode/test-web` (exact version, dev-only), `test/web/run.mjs`
  (CI route and `VSCODE_EXECUTABLE_PATH` local route), the bundled Mocha suite with one smoke test
  (criterion 3 on one `.json` fixture), the `test:e2e:web` script in the package and the root, the
  `ci.yml` job with its cache, `AGENTS.md` §Canonical stack; `test/web/README.md` recording what
  only CI covers, whether desktop runs the suite in the web host (plan R2), and whether vscode.dev
  and github.dev workspaces start trusted (spec §Where we differ). Until T2, the browser entry may
  stub the Git HEAD reader. — *gate: criterion 1; the smoke green in CI and on the local route;
  desktop `pnpm test:e2e` green*

## Phase B — Shared code (risk-free / additive)
- [ ] **T2** Node-free shared host code: `activateShared(context, platform)`, Node-only code under
  `src/node/` (Git HEAD reader), `src/uriPath.ts` for `uri.path` names, the ESLint rule and its
  failing fixture, `!isWeb && !chrJsonEditor.webHost` on every desktop-only menu entry and the
  desktop-only message per UNK-053. — needs: 013 T1, 007 T4, 008 T2 — *gate: criteria 2 and 8
  green; desktop `pnpm test:e2e` green with no expected value changed*
- [x] **T3** Schema files on virtual schemes: `core` association resolves relative `$schema` and
  settings URLs against the document's or folder's scheme and authority; `readSchemaFile` reads any
  non-remote URI. `parallel` with T2 — needs: 013 T1 — *gate: criterion 6 green; every existing
  association and validation test unchanged*

## Phase C — Web suite (risk-free / additive)
- [ ] **T4** The web e2e suite: spec 003 open/edit/save/undo/live cases on the three formats, spec
  004 validation, convert, repair, compare (criterion 9), every other command on `main`;
  `test/web/coverage.json` and its unit test; the network check and its probe fixture (criterion
  11). — needs: 013 T2, T3 — *gate: criteria 3–5, 7, 9, 11 green in CI*

## Phase D — Limits and docs (risk-free / additive)
- [ ] **T5** Large files in the web host (starts last: 008 T3 is still open): on the CI route,
  open the bench generator's documents at 5 MiB + 1 byte, 10, 25 and 50 MiB (and VS Code's
  ceiling) in the web host; commit
  `bench/web-ceiling.md`; resolve UNK-054 per its rule; criterion 10's e2e. — needs: 013 T4, 008 T3,
  008 T4 — *gate: criterion 10 green; UNK-054 resolved per the delegation rule*
- [ ] **T6** README web section per UNK-052 (criterion 14) and the `check:readme` sentence. — needs:
  013 T4, 005 T1 (`check:readme` is a stub until 005 T1 makes it real) — *gate: criterion 14;
  `pnpm check:readme` green and failing on a README without the sentence*

## Off the critical path
- Restricted Mode support (an `untrustedWorkspaces` declaration) is a separate decision on both
  platforms; T1's finding decides whether it is raised.
- Reading Git HEAD in github.dev waits for a public API from its GitHub Repositories extension.
- Specs 009–012 tasks that land after T4 add their commands' web cases to `coverage.json`
  (criterion 7 fails otherwise).
