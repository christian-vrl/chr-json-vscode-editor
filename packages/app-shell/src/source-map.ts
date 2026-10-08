// Stand-in for the `json-source-map` package inside vanilla-jsoneditor (004 T5). The library's text
// mode finds where a validation error sits with `jsonSourceMap.parse(text).pointers` (its
// jsonUtils.ts `findTextLocation`), and `json-source-map` reads strict JSON only: in a JSONC or
// JSON5 document it throws, and every error lands at the start of the text. Both Vite builds alias
// the package to this module (vite.config.mts, vite.lib.config.mts), which maps the text with
// core's JSON5 parser instead. JSON5 accepts every JSON and JSONC text (comments, trailing
// commas), so one parser serves all three formats. Only `parse` is provided: it is the only
// function the library calls (vanilla-jsoneditor 3.13.0 index.js, `import W from"json-source-map"`
// and its two `W.parse` calls).
import { getAdapter, type FormatNode } from '@chr-json-editor/core';

/** A position as `json-source-map` reports it: zero-based line and column, and the offset. */
export interface Location {
  line: number;
  column: number;
  pos: number;
}

/** Where one JSON Pointer's key (object members only) and value start and end. */
export interface PointerLocations {
  key?: Location;
  keyEnd?: Location;
  value: Location;
  valueEnd: Location;
}

export interface SourceMap {
  data: unknown;
  pointers: Record<string, PointerLocations>;
}

/** Parses `text` like `json-source-map`'s `parse`; throws a SyntaxError when it does not parse. */
export function parse(text: string): SourceMap {
  const result = getAdapter('json5').parse(text);
  const error = result.diagnostics.find((d) => d.severity === 'error');
  if (error) throw new SyntaxError(`${error.message} at position ${error.offset}`);
  if (result.tree === undefined) throw new SyntaxError('The text holds no value');
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const at = (pos: number): Location => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= pos) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo, column: pos - lineStarts[lo]!, pos };
  };
  const pointers: Record<string, PointerLocations> = {};
  const visit = (node: FormatNode, pointer: string, key?: FormatNode): void => {
    pointers[pointer] = {
      ...(key && { key: at(key.offset), keyEnd: at(key.offset + key.length) }),
      value: at(node.offset),
      valueEnd: at(node.offset + node.length),
    };
    if (node.type === 'object') {
      for (const property of node.children ?? []) {
        const [name, value] = property.children ?? [];
        if (!name || !value) continue;
        visit(value, `${pointer}/${escape(String(name.value))}`, name);
      }
    } else if (node.type === 'array') {
      (node.children ?? []).forEach((item, i) => visit(item, `${pointer}/${i}`));
    }
  };
  visit(result.tree, '');
  return { data: result.data, pointers };
}

/** RFC 6901 escaping, as the library's `compileJSONPointer` writes the pointers it looks up. */
function escape(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

export default { parse };
