# TASKS 001 — Repo foundation and CI guards

> Derives from the plan. `[ ]` pending · `[~]` awaiting human gate · `[x]` done.
> No gate is crossed with open UNKNOWNS that affect the result.

## Phase A — Repo (requires approval)
- [x] **T0** Owner creates the empty private GitHub repo `christian-vrl/chr-json-vscode-editor` (UNK-001) and connects it to the project. — *gate: an agent can push a branch to it* (done 2026-10-08, owner message cmsg_01Wz9SKzwQD2da69nuNGPcid3K4RGSy7h8sbdzyH34wRho; baseline commit `524da52` pushed to `main`)
- [x] **T1** Run `bootstrap.sh --dry-run .` then `bootstrap.sh . "<name>"` from `sdd-starter-kit.zip`; commit. Copy `AGENTS.md`, `spec/`, `skills/` from the shared folder `sdd/`; add `LICENSE` (UNK-003), `.editorconfig`, `.gitattributes`, `.gitignore`; keep only the `CLAUDE.md` and `.github/copilot-instructions.md` adapters; export the architecture and feature-map Claude Docs to `docs/research/architecture.md` and `docs/research/feature-map.md`. Commit. — *gate: `test "$(cat governance/VERSION)" = 1.2.0 && ! grep -q '<fill in' AGENTS.md && test -s docs/research/feature-map.md`*

## Phase B — Skeleton (risk-free / additive)
- [x] **T2** pnpm workspace, `tsconfig.base.json` (strict), five packages per ADR-002 with `build`; root scripts for every standard script name (stubs that exit 0 where nothing exists yet). Extension `package.json`: `name`/`displayName`/`publisher` per UNK-002, `repository`, `license`, `engines.vscode: ^1.95.0` (provisional, UNK-016), `vsce package --no-dependencies`. — *gate: `pnpm install --frozen-lockfile && pnpm build` exit 0*
- [x] **T3** ESLint (typescript-eslint) + Prettier. — *gate: `pnpm lint` exit 0*
- [ ] **T4** Vitest for `test:unit`; `test:golden` with loader `tests/golden/load.ts` returning `{format, name, input, patch, expected, tags}` and one trivial case per format. — *gate: `pnpm test:unit && pnpm test:golden` green; loader test asserts ≥ 3 cases*
- [ ] **T5** Extension host bundle (esbuild), `activate` registers a no-op command; `pnpm package`; `test:e2e` with `@vscode/test-electron` installs the `.vsix` and asserts activation (criterion 2). — *gate: `pnpm package && xvfb-run pnpm test:e2e` green*
- [ ] **T6** `test:web`: Playwright serves `app-shell`'s Vite build from a local static server and aborts every request to any other origin. — *gate: `pnpm test:web` green on a sample page*

## Phase C — Guards (risk-free / additive)
- [ ] **T7** `check:licenses` per `AGENTS.md` rule 4 (SPDX AND/OR evaluation) over production deps of shipped packages; generates `THIRD_PARTY_LICENSES.md` into the `.vsix`. Fixture `tests/fixtures/bad-license` (`GPL-3.0`). — *gate: passes on repo, fails on fixture, Font Awesome passes (criterion 3)*
- [ ] **T8** `check:offline`: (a) scan `dist/**` for `https?://` not in `offline-allowlist.txt`; (b) `test:web` fails on any request outside the local origin. Fixture page calling `fetch('https://example.com')`. — *gate: passes on repo, fails on fixture*
- [ ] **T9** `gate-review` workflow: on `pull_request` and `issue_comment`, pass only if a comment `Gate review <NNN>-<Tn>: PASS @ <head sha>` exists from a collaborator with write access for the current head SHA. — *gate: criterion 4 shown on two test PRs (one without, one with the comment)*

## Phase D — CI (requires approval for repo settings)
- [ ] **T10** `.github/workflows/ci.yml` running every standard script plus the expected-failure fixture jobs; uploads the `.vsix` as an artifact. — *gate: green on `main`*
- [~] **T11** When the repo turns public after the beta (UNK-001), the owner (or an agent with the owner's go-ahead) protects `main`: required checks = CI jobs + `gate-review`; allow auto-merge (UNK-006). Until then agents merge only when CI is green and `gate-review` passes. — *gate: `gh api repos/christian-vrl/chr-json-vscode-editor/branches/main/protection` lists the required checks*

## Off the critical path
- UNK-016 final minimum version (matrix run can follow v1).
