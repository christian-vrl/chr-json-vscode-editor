// `move` takes the document without the moved member from the parse it already has (`Doc.without`,
// UNK-014) instead of parsing the text again. These tests hold it to that second parse: for every
// member of the golden inputs and of generated documents with comments, the shifted tree, tokens and style must
// equal what opening the new text gives.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { removalAt, type Doc } from '../src/formats/edit.js';
import { open as openJson5 } from '../src/formats/json5-adapter.js';
import { openDocs } from '../src/formats/jsonc-adapter.js';
import { getAdapter, type Format, type FormatNode } from '../src/index.js';
import { dataArbitrary, SEED, styleArbitrary } from './arbitraries.js';
import { printDocument } from './print-document.js';

const GOLDEN = path.resolve(import.meta.dirname, '../../../tests/golden');
const FORMATS: Format[] = ['json', 'jsonc', 'json5'];

const openDoc = (format: Format, text: string): Doc =>
  format === 'json5' ? openJson5(text) : openDocs.get(format)!(text);

/** The fields the edit layer reads, so parser-only fields (jsonc-parser's `parent`) do not count. */
function shape(node: FormatNode | undefined): unknown {
  if (!node) return undefined;
  return {
    type: node.type,
    offset: node.offset,
    length: node.length,
    value: node.value,
    children: node.children?.map(shape),
  };
}

/** Every member's JSON Pointer, from the tree. */
function memberPaths(node: FormatNode, prefix = ''): string[] {
  const paths: string[] = [];
  const escape = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
  (node.children ?? []).forEach((child, i) => {
    const [key, value] =
      child.type === 'property'
        ? [escape(String(child.children![0]!.value)), child.children![1]!]
        : [String(i), child];
    const at = `${prefix}/${key}`;
    paths.push(at, ...memberPaths(value, at));
  });
  return paths;
}

/** Checks `without` against a fresh open for each member; returns how many were shifted. */
function check(format: Format, text: string): number {
  const doc = openDoc(format, text);
  if (!doc.root) return 0;
  let shifted = 0;
  for (const at of memberPaths(doc.root)) {
    const { edits, member } = removalAt(doc, at);
    const after = doc.without(edits, member);
    const expected = openDoc(format, doc.apply(edits));
    // A removal only deletes whole tokens and the member's own nodes, so it always shifts.
    expect(after, `${format} ${at}: shifted`).toBeDefined();
    if (!after) continue;
    shifted++;
    expect(after.text, `${format} ${at}`).toBe(expected.text);
    expect(shape(after.root), `${format} ${at}: tree`).toEqual(shape(expected.root));
    expect(after.tokens, `${format} ${at}: tokens`).toEqual(expected.tokens);
    expect(after.style, `${format} ${at}: style`).toEqual(expected.style);
  }
  return shifted;
}

describe('Doc.without (move without a second parse)', () => {
  for (const format of FORMATS) {
    it(`equals a fresh parse for every member of the ${format} golden inputs`, () => {
      let shifted = 0;
      for (const name of readdirSync(path.join(GOLDEN, format))) {
        const file = path.join(GOLDEN, format, name, `input.${format}`);
        let text: string;
        try {
          text = readFileSync(file, 'utf8');
        } catch {
          continue;
        }
        if (
          getAdapter(format)
            .parse(text)
            .diagnostics.some((d) => d.severity === 'error')
        )
          continue;
        shifted += check(format, text);
      }
      expect(shifted).toBeGreaterThan(20);
    });

    it(`equals a fresh parse for every member of generated ${format} documents`, () => {
      fc.assert(
        fc.property(dataArbitrary(format), styleArbitrary, fc.gen(), (data, style, g) => {
          check(format, printDocument(data, format, style, g));
        }),
        { seed: SEED, numRuns: 300 },
      );
    });
  }
});
