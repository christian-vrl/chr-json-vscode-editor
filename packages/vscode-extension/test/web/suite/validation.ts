// Web e2e, spec 013 criterion 5 (013 T4): spec 004's validation in the web host. A document whose
// `$schema` is a relative path (limits.jsonc) and documents matched by the workspace folder's
// `json.schemas` / `json5.schemas` (people.*, settings in run.mjs's .vscode/settings.json, urls
// relative to the folder: criterion 6) get the errors the desktop e2e expects (inline.cjs). Ajv
// runs in the web host (ADR-010). A `$schema` or setting naming an `https:` URL is never fetched
// (the network check of criterion 11 covers the whole run) and shows the desktop message. A
// `$schema` that is an absolute path names a file on the document's own scheme and authority.
/// <reference types="mocha" />
import * as vscode from 'vscode';
import {
  activateHooks,
  closeAll,
  deepEqual,
  equal,
  fixture,
  FORMATS,
  match,
  openCustom,
  probeUntil,
  revert,
  sleep,
  view,
  waitFor,
  writeToCase,
} from './util';
import type { TestHooks } from '../../../src/extension';

/** people.* break people.schema.json at these pointers (inline.cjs). */
const PEOPLE_ERRORS = [
  { instancePath: '/1/age', keyword: 'type' },
  { instancePath: '/1/name', keyword: 'minLength' },
];
const UNDERLINED = {
  json: ['"age"', '"name"'],
  jsonc: ['"age"', '"name"'],
  json5: ['age', 'name'],
};

const keys = (errors: { instancePath: string; keyword: string }[] | null | undefined) =>
  (errors ?? []).map(({ instancePath, keyword }) => ({ instancePath, keyword }));

function shown(hooks: TestHooks, uri: vscode.Uri) {
  return view(hooks, uri).validationsShown;
}

function last(hooks: TestHooks, uri: vscode.Uri) {
  return shown(hooks, uri).at(-1);
}

describe('schema validation in the web host (spec 013 criterion 5)', () => {
  it('validates documents matched by the workspace folder’s json.schemas and json5.schemas', async () => {
    const hooks = await activateHooks();
    for (const format of FORMATS) {
      const uri = fixture('fixtures', 'inline', `people.${format}`);
      await openCustom(hooks, uri);
      await waitFor(`people.${format}: schema errors`, () =>
        shown(hooks, uri).some((v) => v.errors?.length),
      );
      deepEqual(keys(last(hooks, uri)?.errors), PEOPLE_ERRORS, `people.${format}: errors`);
      deepEqual(
        last(hooks, uri)?.dialect,
        { name: 'draft-07', assumed: true, switchable: true },
        `people.${format}: dialect`,
      );
      // Inline in text mode, where the marks are the keys as each format writes them.
      equal(hooks.setMode(uri.toString(), 'text'), true, 'setMode');
      await probeUntil(hooks, uri, `people.${format}: underlines`, (p) => {
        const marks = p.validationMarks.map((m) => m.text).sort();
        return p.mode === 'text' && JSON.stringify(marks) === JSON.stringify(UNDERLINED[format]);
      });
      // An edit is validated again.
      equal(hooks.patch(uri.toString(), [{ op: 'replace', path: '/1/age', value: 7 }]), true, '');
      await waitFor(`people.${format}: one error after the fix`, () => {
        return (
          JSON.stringify(keys(last(hooks, uri)?.errors)) === JSON.stringify([PEOPLE_ERRORS[1]])
        );
      });
      await revert(await vscode.workspace.openTextDocument(uri));
      await closeAll();
    }
  });

  it('validates a document against its relative $schema, with the dialect switch', async () => {
    const hooks = await activateHooks();
    const uri = fixture('fixtures', 'inline', 'limits.jsonc');
    await openCustom(hooks, uri);
    await waitFor('limits.jsonc validated', () => last(hooks, uri)?.reason);
    match(last(hooks, uri)?.reason, /exclusiveMinimum must be number/, 'reason');
    equal(hooks.selectDialect(uri.toString(), 'draft-04'), true, 'selectDialect');
    await waitFor('limits.jsonc as draft-04', () => last(hooks, uri)?.dialect?.name === 'draft-04');
    deepEqual(keys(last(hooks, uri)?.errors), [{ instancePath: '/count', keyword: 'minimum' }], '');
    const probe = await probeUntil(hooks, uri, 'the draft-04 status', (p) => p.schemaStatus !== '');
    equal(probe.schemaStatus, 'draft-04', 'toolbar');
    await closeAll();

    // 004 T2's case: the schema set over the association, three errors keyed by docVersion.
    const person = fixture('fixtures', 'validation', 'person.jsonc');
    const document = await openCustom(hooks, person);
    const schema = JSON.parse(
      new TextDecoder().decode(
        await vscode.workspace.fs.readFile(fixture('fixtures', 'validation', 'person.schema.json')),
      ),
    ) as object;
    equal(hooks.setSchema(person.toString(), schema), true, 'setSchema');
    await waitFor('person.jsonc errors', () => last(hooks, person)?.errors?.length === 3);
    equal(last(hooks, person)?.docVersion, document.version, 'docVersion');
    deepEqual(
      keys(last(hooks, person)?.errors),
      [
        { instancePath: '/age', keyword: 'type' },
        { instancePath: '/email', keyword: 'format' },
        { instancePath: '/name', keyword: 'minLength' },
      ],
      'person.jsonc errors',
    );
    await closeAll();
  });

  it('never loads an https schema and says so, as on desktop', async () => {
    const hooks = await activateHooks();
    // A settings url naming https: the desktop message.
    const remote = await writeToCase('schema-cases', 'remote-schema.json', '{"a": 1}\n');
    await openCustom(hooks, remote);
    await waitFor('remote-schema.json told why', () => last(hooks, remote)?.reason);
    equal(
      last(hooks, remote)?.reason,
      'Remote schemas are not loaded (offline): https://example.com/s.json',
      'reason',
    );
    await closeAll();

    // A `$schema` naming https is not a local path: no schema, nothing fetched.
    const named = await writeToCase(
      'schema-cases-https',
      'named.json',
      '{"$schema": "https://example.com/named.json", "a": 1}\n',
    );
    await openCustom(hooks, named);
    // Validation runs with no schema: the toolbar shows none, and nothing is fetched (the network
    // check of the whole run).
    await sleep(500);
    deepEqual(
      shown(hooks, named).filter((v) => v.dialect !== null || v.errors?.length || v.reason),
      [],
      'named.json: validation shown',
    );
    equal((await hooks.probe(named.toString())).schemaStatus, '', 'toolbar');
    await closeAll();
  });

  it('reads an absolute $schema path on the document’s own scheme and authority', async () => {
    const hooks = await activateHooks();
    const root = fixture();
    const uri = await writeToCase(
      'absolute',
      'people.json',
      JSON.stringify({ $schema: '/fixtures/inline/people.schema.json', list: [] }) + '\n',
    );
    await openCustom(hooks, uri);
    if (root.scheme === 'file') {
      // The local route's folder is file:, where `/x` is the file system's root, as on desktop.
      await waitFor('the unreadable schema', () => last(hooks, uri)?.reason);
      match(
        last(hooks, uri)?.reason,
        /^The schema file:\/\/\/fixtures\/inline\/people\.schema\.json cannot be read/,
        'reason',
      );
    } else {
      // vscode-test-web://mount/fixtures/inline/people.schema.json: the schema applies (its root
      // is an array, so the object fails `type`).
      await waitFor('the schema errors', () => last(hooks, uri)?.errors?.length);
      deepEqual(keys(last(hooks, uri)?.errors), [{ instancePath: '', keyword: 'type' }], 'errors');
    }
    await closeAll();
  });
});
