// XML import (spec 017 XM1–XM8, UNK-075 ★ "Compact"): `saxes` 6.0.0 checks well-formedness and
// reports events; our handlers build the shape on an explicit stack of open elements, so A5 is a
// counter. `saxes` decodes the predefined entities and character references only; it reports any
// other entity reference as an "undefined entity" error and keeps it as written, which XM7 turns
// into a warning. Every other error event ends the conversion (XM8).
import { SaxesParser } from 'saxes';
import { asNumber } from '../csv/values.js';
import {
  A1_MESSAGE,
  ImportFailure,
  Lines,
  MAX_DEPTH,
  setMember,
  tooDeep,
  Warnings,
  type ImportResult,
} from './common.js';

interface Open {
  name: string;
  /** Offset of the start tag's `<`. */
  offset: number;
  attributes: [string, string][];
  /** Child values by name, in order of first appearance (XM3). */
  children: Map<string, unknown[]>;
  /** The name of the last child element, for XM3's interleaving check. */
  last: string | undefined;
  interleaved: boolean;
  /** Runs of text between child elements (XM4, corpus README reading 10). */
  runs: string[];
  /** Whether this element is an object, so a level of A5's depth. */
  container: boolean;
}

const WHITE_SPACE = /^[ \t\r\n]+|[ \t\r\n]+$/g;

export function importXml(text: string): ImportResult {
  const lines = new Lines(text);
  const warnings = new Warnings(lines);
  const entities = new Set<string>();
  const stack: Open[] = [];
  let root: Record<string, unknown> | undefined;
  let tagStart = 0;

  const parser = new SaxesParser({ xmlns: false, position: true });
  const fail = (message: string): never => {
    throw new ImportFailure(message.replace(/^\d+:\d+: /, ''), parser.line, parser.column);
  };

  parser.on('xmldecl', (decl) => {
    // A1: a declared encoding other than UTF-8.
    if (decl.encoding !== undefined && decl.encoding.toLowerCase() !== 'utf-8')
      throw new ImportFailure(A1_MESSAGE, 1);
  });
  parser.on('error', (error) => {
    if (!/undefined entity/.test(error.message)) fail(error.message);
    // XM7: the reference ends just before the parser's position.
    const end = parser.position;
    const start = text.lastIndexOf('&', end - 1);
    const name = text.slice(start, end);
    if (!entities.has(name)) {
      entities.add(name);
      warnings.add(`Entity ${name} was not expanded and is kept as written`, start);
    }
  });
  parser.on('opentagstart', () => {
    tagStart = text.lastIndexOf('<', parser.position - 1);
  });
  parser.on('opentag', (tag) => {
    const parent = stack[stack.length - 1];
    // The XM1 object is level 1 and an element with `a` open ancestors is level a + 2 once it is an
    // object (corpus README, reading 6).
    if (parent && !parent.container) {
      parent.container = true;
      if (stack.length + 1 > MAX_DEPTH) throw tooDeep();
    }
    const attributes = Object.entries(tag.attributes as Record<string, string>);
    const element: Open = {
      name: tag.name,
      offset: tagStart,
      attributes,
      children: new Map(),
      last: undefined,
      interleaved: false,
      runs: [''],
      container: attributes.length > 0,
    };
    if (element.container && stack.length + 2 > MAX_DEPTH) throw tooDeep();
    if (parent) {
      if (parent.last !== undefined && parent.last !== tag.name && parent.children.has(tag.name))
        parent.interleaved = true;
      parent.last = tag.name;
      parent.runs.push('');
    }
    stack.push(element);
  });
  const addText = (chunk: string) => {
    const element = stack[stack.length - 1];
    if (element) element.runs[element.runs.length - 1] += chunk;
  };
  parser.on('text', addText);
  parser.on('cdata', addText);
  parser.on('closetag', () => {
    const element = stack.pop()!;
    const value = elementValue(element, warnings);
    const parent = stack[stack.length - 1];
    if (parent) {
      const values = parent.children.get(element.name);
      if (values) values.push(value);
      else parent.children.set(element.name, [value]);
    } else {
      root = {};
      setMember(root, element.name, value);
    }
  });

  parser.write(text).close();
  return { data: root ?? null, warnings: warnings.sorted() };
}

/** XM2–XM4, XM6: the value of a closed element. */
function elementValue(element: Open, warnings: Warnings): unknown {
  const runs = element.runs.map((run) => run.replace(WHITE_SPACE, '')).filter((run) => run !== '');
  if (element.attributes.length === 0 && element.children.size === 0)
    return runs.length === 0 ? '' : textValue(runs.join(' '));
  const object: Record<string, unknown> = {};
  for (const [name, value] of element.attributes) setMember(object, `@${name}`, textValue(value));
  for (const [name, values] of element.children)
    setMember(object, name, values.length === 1 ? values[0] : values);
  if (element.interleaved) {
    warnings.add(
      `Child elements of <${element.name}> with different names are interleaved; their order is lost`,
      element.offset,
    );
  }
  if (runs.length > 0) {
    setMember(object, '#text', textValue(runs.join(' ')));
    if (element.children.size > 0) {
      warnings.add(
        `Text in <${element.name}> is mixed with elements; it became "#text" and its place is lost`,
        element.offset,
      );
    }
  }
  return object;
}

/** XM6: a number, `true`, `false`, or the text. */
function textValue(text: string): unknown {
  if (text === 'true') return true;
  if (text === 'false') return false;
  return asNumber(text) ?? text;
}
