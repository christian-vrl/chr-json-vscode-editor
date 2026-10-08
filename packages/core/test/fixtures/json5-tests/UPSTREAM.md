# json5-tests (vendored)

Copied unchanged from https://github.com/json5/json5-tests at commit
`ceb24d4080137d70833f86c25659c1331b80a387` (MIT, see `LICENSE.md`) by 002 T5, as the conformance
fixture for our JSON5 parser (ADR-009). The upstream `todo/` folder, whose files upstream does not
run, is left out. Test-only: nothing here ships.

Upstream's rule (its `README.md`): `.json` and `.json5` files must parse; `.js` and `.txt` files
must be rejected. `packages/core/test/json5.test.ts` applies it, and checks the data against the
`json5` package.
