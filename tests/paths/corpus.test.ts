// Spec 018 criterion 1 (018 T1): for every case in tests/paths/, `nodeAt(format, text, offset)`
// gives each listed node, as P1 and P2 text, or the listed error's line and column, and
// `placeOf(format, text, path)` gives each listed place. A place's pointer is read as P3 reads it
// against the case's data (its steps into arrays are indices); when the text has no data, every
// step that is an array index token (RFC 6901 §4) is read as an index.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { jsonPath, jsonPointer, nodeAt, parseData, placeOf, readPath } from '@chr-json-editor/core';
import { pathCases, pathsRoot } from './cases';

describe('copy path corpus (spec 018 criterion 1)', () => {
  const cases = pathCases();

  it('has cases', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const c of cases) {
    describe(c.name, () => {
      it.each(c.nodes)('node at offset $offset', (node) => {
        const result = nodeAt(c.format, c.text, node.offset);
        if ('error' in node) {
          expect('error' in result ? result.error : result).toMatchObject(node.error);
        } else {
          expect('path' in result ? result.path : result, 'nodeAt').toBeInstanceOf(Array);
          const steps = 'path' in result ? result.path : [];
          expect({ jsonpath: jsonPath(steps), pointer: jsonPointer(steps) }).toEqual({
            jsonpath: node.jsonpath,
            pointer: node.pointer,
          });
        }
      });

      if (c.places.length > 0)
        it.each(c.places)('place of $pointer', (place) => {
          const parsed = parseData(c.format, c.text);
          const read = readPath(place.pointer, 'data' in parsed ? parsed.data : undefined);
          if (!('path' in read)) throw new Error(read.error);
          const steps =
            'data' in parsed
              ? read.path
              : read.path.map((s) =>
                  typeof s === 'string' && /^(0|[1-9][0-9]*)$/.test(s) ? Number(s) : s,
                );
          expect(placeOf(c.format, c.text, steps)).toBe('none' in place ? undefined : place.offset);
        });
    });
  }

  it('every case folder holds only its own files', () => {
    for (const c of cases) {
      const extra = readdirSync(path.join(pathsRoot, c.name)).filter(
        (f) => !['case.json', 'expected.json', c.file].includes(f),
      );
      expect(extra, c.name).toEqual([]);
    }
  });
});
