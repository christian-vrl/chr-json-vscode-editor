# Expected-failure fixtures

Inputs that prove a guard fails when it should (spec 001 criterion 3). The license fixtures are tiny
packages with a checked-in `node_modules/` holding only `package.json` stubs, so a check can run on
them offline without `pnpm install`. `offline-fetch/web/` is a page calling `fetch('https://example.com')`.

| Fixture | Command | Expected |
|---|---|---|
| `bad-license/` | `node scripts/check-licenses.mjs --package tests/fixtures/bad-license` | exit 1: production dependency `gpl-fixture` is `GPL-3.0` |
| `fontawesome/` | `node scripts/check-licenses.mjs --package tests/fixtures/fontawesome` | exit 0: `@fortawesome/free-solid-svg-icons` is `(CC-BY-4.0 AND MIT)`, as published on npm (7.3.1) |
| `offline-fetch/web/` | `node scripts/check-offline.mjs --dist tests/fixtures/offline-fetch/web` | exit 1: `index.html` names `https://example.com`, which is not in `offline-allowlist.txt` |
| `offline-fetch/` | `pnpm exec playwright test -c tests/fixtures/offline-fetch/playwright.config.mts` | exit 1: the `test:web` fixture blocks the page's request to `https://example.com/` and fails the test |
