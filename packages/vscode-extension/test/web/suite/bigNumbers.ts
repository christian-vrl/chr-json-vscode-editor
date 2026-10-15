// Web e2e, spec 015 criterion 13 (015 T6): criterion 4's open-and-edit case in the web worker host,
// with the same expected bytes as the desktop e2e (test/e2e/bigNumbers.cjs). Each fixture of
// tests/e2e/fixtures/big-numbers/ opens with its big numbers' digits shown (the tree for JSON, JSONC
// and JSON5, the table for JSON Lines), and a patch whose value is typed text with more digits than
// a float holds writes `expected-edit.*` byte for byte, saved as such. Each case edits a copy under
// work/.
/// <reference types="mocha" />
import {
  activateHooks,
  closeAll,
  copyToCase,
  equal,
  fixture,
  ok,
  openCustom,
  readText,
  sleep,
  view,
  waitFor,
} from './util';

/** Shown in every fixture (the JSON5 one writes it in hex too). */
const SHOWN = ['12345678901234567890', '0.1000000000000000000001', '1e400', '9007199254740993'];
const EDITS = {
  json: { mode: 'tree', path: '/a' },
  jsonc: { mode: 'tree', path: '/a' },
  json5: { mode: 'tree', path: '/a' },
  jsonl: { mode: 'table', path: '/0/id' },
} as const;

describe('big numbers on the virtual scheme (spec 015 criterion 13)', () => {
  it("opens and edits criterion 4's fixtures with the desktop's expected bytes", async () => {
    const hooks = await activateHooks();
    for (const [format, { mode, path }] of Object.entries(EDITS)) {
      const from = fixture('fixtures', 'big-numbers', `input.${format}`);
      const uri = await copyToCase('big-numbers', from);
      const expected = await readText(
        fixture('fixtures', 'big-numbers', `expected-edit.${format}`),
      );
      const document = await openCustom(hooks, uri, mode);
      const [read] = await hooks.dom(uri.toString(), [{ readAll: `.jse-${mode}-mode .jse-value` }]);
      const values = JSON.parse(read ?? '[]') as string[];
      for (const big of SHOWN) ok(values.includes(big), `input.${format}: shows no ${big}`);

      const before = document.version;
      const patch = `[{"op": "replace", "path": "${path}", "value": 98765432109876543210}]`;
      equal(hooks.patch(uri.toString(), patch), true, `input.${format}: patch`);
      await waitFor(`input.${format} to be edited`, () => document.version > before);
      await sleep(300);
      equal(document.getText(), expected, `input.${format}: the edit`);
      equal(view(hooks, uri).editsReceived, 1, `input.${format}: edits sent`);
      await hooks.whenSettled(uri.toString());
      equal(await document.save(), true, `input.${format}: save`);
      equal(await readText(uri), expected, `input.${format}: saved bytes`);
      await closeAll();
      console.log(`criterion 13: input.${format} shows big numbers; the edit writes expected-edit`);
    }
  });
});
