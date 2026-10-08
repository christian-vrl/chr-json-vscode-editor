# Expected-failure fixtures

Inputs that prove a guard fails when it should (spec 001 criterion 3). Each fixture is a tiny
package with a checked-in `node_modules/` holding only `package.json` stubs, so a check can run on it
offline without `pnpm install`.

| Fixture | Command | Expected |
|---|---|---|
| `bad-license/` | `node scripts/check-licenses.mjs --package tests/fixtures/bad-license` | exit 1: production dependency `gpl-fixture` is `GPL-3.0` |
| `fontawesome/` | `node scripts/check-licenses.mjs --package tests/fixtures/fontawesome` | exit 0: `@fortawesome/free-solid-svg-icons` is `(CC-BY-4.0 AND MIT)`, as published on npm (7.3.1) |
