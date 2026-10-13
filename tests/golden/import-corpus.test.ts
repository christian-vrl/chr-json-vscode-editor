// Spec 017 import corpus (017 T1): facts about the hand-written cases that need no importer. The
// golden test itself (criterion 1, `importData` against each case) comes with the importer in T2.
import { describe, expect, it } from 'vitest';
import {
  isBigNumber,
  isOutputNumber,
  jsonTokens,
  loadImportCases,
  outputLayout,
  ruleMessages,
  tomlDateForms,
  type ImportCase,
} from './import.js';

const cases = loadImportCases();
const label = (c: ImportCase) => `${c.kind}/${c.name}`;
const lineCount = (text: string) => text.split(/\r\n|\r|\n/).length;
const numbers = (c: ImportCase) =>
  c.expected === undefined ? [] : jsonTokens(c.expected).filter((t) => /^-?\d/.test(t));
const strings = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : typeof value === 'object' && value !== null
      ? Object.values(value).flatMap(strings)
      : [];
const keys = (value: unknown): string[] =>
  typeof value === 'object' && value !== null
    ? [...(Array.isArray(value) ? [] : Object.keys(value)), ...Object.values(value).flatMap(keys)]
    : [];
const warned = (c: ImportCase, pattern: RegExp) =>
  (c.warnings ?? []).some((w) => pattern.test(w.message));
const data = (c: ImportCase): unknown =>
  c.expected === undefined ? undefined : JSON.parse(c.expected);

/** What each tag says about its case, checked against the case's bytes and expected files. */
const tagFacts: Record<string, (c: ImportCase) => boolean> = {
  'big-integer': (c) => numbers(c).some((t) => /^-?\d+$/.test(t) && isBigNumber(t)),
  'big-decimal': (c) => numbers(c).some((t) => !/^-?\d+$/.test(t) && isBigNumber(t)),
  'hex-octal-binary': (c) => /\b0[xob][0-9a-f]/i.test(c.input) || /\b0[0-7]+\b/.test(c.input),
  'non-finite': (c) => warned(c, / has no JSON form; written as null$/),
  'proto-key': (c) => keys(data(c)).includes('__proto__') && keys(data(c)).includes('constructor'),
  'too-deep': (c) => c.error?.message === ruleMessages.A5,
  bom: (c) => c.bytes[0] === 0xef && c.bytes[1] === 0xbb && c.bytes[2] === 0xbf && !c.error,
  'utf16-bom': (c) =>
    ((c.bytes[0] === 0xff && c.bytes[1] === 0xfe) ||
      (c.bytes[0] === 0xfe && c.bytes[1] === 0xff)) &&
    c.error?.message === ruleMessages.A1,
  malformed: (c) =>
    c.error !== undefined && c.error.message === undefined && c.error.column !== undefined,
  'yaml-1.1-booleans': (c) => c.input.startsWith('%YAML 1.1') && /: (?:on|yes|y)$/im.test(c.input),
  'yaml-github-actions-on': (c) => /^on:$/m.test(c.input) && keys(data(c)).includes('on'),
  'yaml-multi-document': (c) =>
    Array.isArray(data(c)) &&
    warned(c, /^The file holds \d+ YAML documents; they became one array$/),
  'yaml-empty': (c) => c.expected === 'null\n' && !/^[^#\s%]/m.test(c.input),
  'yaml-merge-key': (c) => /^\s*<<: /m.test(c.input),
  'yaml-alias-bomb': (c) => c.error?.message === ruleMessages.Y6,
  'yaml-cloudformation-tags': (c) =>
    /!(?:Ref|Sub|GetAtt) /.test(c.input) && warned(c, /^Tag !\S+ was ignored/),
  'yaml-duplicate-key': (c) => warned(c, /^Key ".*" is repeated; its last value is kept$/),
  'yaml-complex-key': (c) => /^\? [[{]/m.test(c.input) && warned(c, /is a sequence or mapping/),
  'toml-dates': (c) =>
    Object.values(tomlDateForms).every((form) => strings(data(c)).some((s) => form.test(s))),
  'toml-array-of-tables': (c) => /^\[\[/m.test(c.input),
  'toml-int64-overflow': (c) => c.error !== undefined && /\b9223372036854775808\b/.test(c.input),
  'xml-attributes': (c) => keys(data(c)).some((k) => k.startsWith('@')),
  'xml-repeated': (c) => /<(\w+)>[^]*<\/\1>\s*<\1>/.test(c.input),
  'xml-interleaved': (c) => warned(c, /are interleaved; their order is lost$/),
  'xml-mixed-content': (c) =>
    keys(data(c)).includes('#text') && warned(c, /is mixed with elements/),
  'xml-cdata': (c) => c.input.includes('<![CDATA['),
  'xml-namespaces': (c) =>
    keys(data(c)).some((k) => /^[^@#]\w*:/.test(k)) &&
    keys(data(c)).some((k) => k.startsWith('@xmlns')),
  'xml-entity-bomb': (c) =>
    /<!ENTITY lol9 /.test(c.input) && warned(c, /^Entity &lol9; was not expanded/),
  'xml-external-entity': (c) =>
    /<!ENTITY \w+ SYSTEM /.test(c.input) && warned(c, /was not expanded/),
  'xml-encoding-latin1': (c) =>
    /^<\?xml[^>]*encoding="ISO-8859-1"/.test(c.input) && c.error?.message === ruleMessages.A1,
  'xml-empty-element': (c) =>
    /<\w+\/>|<(\w+)><\/\1>/.test(c.input) && strings(data(c)).includes(''),
};

describe('import corpus facts (spec 017, 017 T1)', () => {
  it('has a fact check for every tag', () => {
    const all = cases.flatMap((c) => c.tags.tags);
    expect(all.filter((tag) => !(tag in tagFacts))).toEqual([]);
  });

  it.each(cases.map((c) => [label(c), c] as const))('%s: its tags hold', (_, c) => {
    expect(c.tags.tags.filter((tag) => !tagFacts[tag]!(c))).toEqual([]);
  });

  it.each(cases.filter((c) => c.expected !== undefined).map((c) => [label(c), c] as const))(
    '%s: expected.json is the output text (2-space indent, \\n, final newline) with numbers as stringify writes them',
    (_, c) => {
      expect(outputLayout(c.expected!)).toBe(c.expected);
      expect(numbers(c).filter((t) => !isOutputNumber(t))).toEqual([]);
    },
  );

  it.each(cases.map((c) => [label(c), c] as const))(
    '%s: messages name lines of the input, warnings in line order',
    (_, c) => {
      const lines = lineCount(c.input);
      const named = [...(c.warnings ?? []), ...(c.error ? [c.error] : [])].map((m) => m.line);
      expect(named.filter((line) => line > lines)).toEqual([]);
      const order = (c.warnings ?? []).map((w) => w.line);
      expect(order).toEqual([...order].sort((a, b) => a - b));
    },
  );

  it.each(cases.filter((c) => c.error !== undefined).map((c) => [label(c), c] as const))(
    "%s: an error fixed by a rule carries that rule's message on line 1; a parser error has no message",
    (_, c) => {
      const fixed = Object.values(ruleMessages) as string[];
      if (c.error!.message !== undefined && fixed.includes(c.error!.message)) {
        expect(c.error).toEqual({ message: c.error!.message, line: 1 });
      }
      const rule = (Object.keys(ruleMessages) as (keyof typeof ruleMessages)[]).find(
        (r) => ruleMessages[r] === c.error!.message,
      );
      if (rule) expect(c.tags.rules).toContain(rule);
      if (['Y8', 'TM5', 'XM8'].some((r) => c.tags.rules.includes(r))) {
        expect(c.error!.message).toBeUndefined();
        expect(c.error!.column).toBeDefined();
      }
    },
  );

  it('decodes inputs as UTF-8 with the BOM kept and bad bytes as U+FFFD', () => {
    const bom = cases.find((c) => c.kind === 'yaml' && c.name === 'bom')!;
    expect(bom.input.startsWith('﻿')).toBe(true);
    const utf16 = cases.filter((c) => c.tags.tags.includes('utf16-bom'));
    expect(utf16.map((c) => c.input.slice(0, 2))).toEqual(utf16.map(() => '��'));
  });
});

describe('import corpus helpers', () => {
  it('lay out JSON as the output text, keeping number tokens', () => {
    expect(outputLayout('{"a":[1E-400,{}],"b":{"c":"\\u00e9"}}')).toBe(
      '{\n  "a": [\n    1E-400,\n    {}\n  ],\n  "b": {\n    "c": "é"\n  }\n}\n',
    );
    expect(outputLayout('null')).toBe('null\n');
    expect(() => jsonTokens('{"a": x}')).toThrow();
  });

  it('tell big numbers and the numbers stringify writes', () => {
    for (const big of [
      '12345678901234567890',
      '9007199254740993',
      '0.1000000000000000000001',
      '123456789.123456789',
      '1e400',
      '1E-400',
    ]) {
      expect(isBigNumber(big)).toBe(true);
    }
    for (const safe of [
      '9007199254740991',
      '4.0',
      '1e2',
      '-0',
      '0.1',
      '1.5e300',
      '1.0000000000000002',
    ]) {
      expect(isBigNumber(safe)).toBe(false);
    }
    expect(['-0', '5e+22', '1e400', '0.5'].map(isOutputNumber)).toEqual([true, true, true, true]);
    expect(['4.0', '1e2', '5e22', '.5'].map((t) => /^-?\d/.test(t) && isOutputNumber(t))).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});
