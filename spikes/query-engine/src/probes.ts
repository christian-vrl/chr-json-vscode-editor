// The spike's queries (spec 011 criteria 4 and 5, plan R3), shared by the webview page and the
// Node preflight. Each probe is one run.
import type { Language } from './engine';

/** Criterion 4's names. */
export const SEALED_NAMES = [
  'window',
  'document',
  'self',
  'globalThis.fetch',
  'XMLHttpRequest',
  'WebSocket',
  'importScripts',
  'postMessage',
  'acquireVsCodeApi',
  'require',
  'process',
  'setTimeout',
  'WebAssembly',
  'Worker',
  'navigator',
] as const;

export interface Probe {
  id: string;
  language: Language;
  query: string;
  /** What the run must end with: a value check, or one of the limit messages. */
  expect: 'value' | 'time' | 'memory' | 'time-or-memory';
  /** Criterion 5's bound on how long the run may take before it is stopped, in ms. */
  withinMs?: number;
}

const sealedBody = SEALED_NAMES.map((name) => `    ${JSON.stringify(name)}: typeof ${name}`).join(
  ',\n',
);

export const PROBES: Probe[] = [
  {
    id: 'sealed-typeof',
    language: 'javascript',
    expect: 'value',
    query: `function query (data) {\n  return {\n${sealedBody}\n  }\n}`,
  },
  {
    id: 'sealed-typeof-lodash',
    language: 'lodash',
    expect: 'value',
    query: `function query (data) {\n  return {\n    lodash: typeof _.chain,\n${sealedBody}\n  }\n}`,
  },
  {
    id: 'sealed-eval-function',
    language: 'javascript',
    expect: 'value',
    // eval and Function exist inside the engine and see only the engine's global object.
    query: `function query (data) {
  return {
    evalResult: eval('1 + 1'),
    functionWindow: Function('return typeof window')(),
    functionGlobalKeys: Function('return Object.getOwnPropertyNames(globalThis).sort().join(",")')(),
    indirectEvalDocument: (0, eval)('typeof document')
  }
}`,
  },
  {
    id: 'sealed-global-leak',
    language: 'javascript',
    expect: 'value',
    // Q4: stores something on the global object; the next probe looks for it.
    query: `function query (data) { globalThis.leaked = 42; return typeof globalThis.leaked }`,
  },
  {
    id: 'sealed-global-leak-check',
    language: 'javascript',
    expect: 'value',
    query: `function query (data) { return typeof globalThis.leaked }`,
  },
  {
    id: 'locale-compare',
    language: 'javascript',
    expect: 'value',
    // QuickJS has no Intl (011 T2 finding); what a locale sort gives here, for T3 and plan R4.
    query: `function query (data) {
  const words = ['banana', 'Apple', 'cherry', 'apple', 'Ébano', 'eclair', 'Zebra', 'zebra', 'ä', 'b']
  return {
    intl: typeof Intl,
    localeCompareSort: words.slice().sort((a, b) => a.localeCompare(b)),
    defaultSort: words.slice().sort(),
    aVsB: 'a'.localeCompare('B'),
    toLocaleUpperCase: 'straße'.toLocaleUpperCase(),
    numberToLocaleString: (1234567.891).toLocaleString(),
    dateToLocaleDateString: new Date(Date.UTC(2026, 9, 11)).toLocaleDateString()
  }
}`,
  },
  {
    id: 'loop',
    language: 'javascript',
    expect: 'time',
    withinMs: 6000,
    query: `function query (data) { while (true) {} }`,
  },
  {
    id: 'allocate',
    language: 'javascript',
    expect: 'memory',
    withinMs: 15000,
    // Keeps allocating in large blocks: reaches the memory limit before the deadline.
    query: `function query (data) {
  const kept = []
  while (true) kept.push(new Array(1e6).fill(kept.length))
}`,
  },
  {
    id: 'allocate-objects',
    language: 'javascript',
    expect: 'time-or-memory',
    withinMs: 15000,
    // Keeps allocating small objects: whichever limit comes first.
    query: `function query (data) {
  const kept = []
  while (true) kept.push({ index: kept.length, text: 'item ' + kept.length })
}`,
  },
  {
    id: 'builtin-regex',
    language: 'javascript',
    expect: 'time-or-memory',
    withinMs: 15000,
    query: `function query (data) { return /^(a+)+$/.test('a'.repeat(32) + 'b') }`,
  },
  {
    id: 'builtin-repeat',
    language: 'javascript',
    expect: 'time-or-memory',
    withinMs: 15000,
    query: `function query (data) { return 'x'.repeat(2 ** 28).length }`,
  },
  {
    id: 'builtin-join',
    language: 'javascript',
    expect: 'time-or-memory',
    withinMs: 15000,
    query: `function query (data) { return Array(3e7).fill('ab').join(',').length }`,
  },
  {
    id: 'builtin-sort',
    language: 'javascript',
    expect: 'time-or-memory',
    withinMs: 15000,
    query: `function query (data) {
  const numbers = []
  for (let i = 0; i < 3e6; i++) numbers.push((i * 2654435761) % 4294967296)
  while (true) numbers.slice().sort((a, b) => a - b)
}`,
  },
  {
    id: 'lodash-loop',
    language: 'lodash',
    expect: 'time',
    withinMs: 6000,
    query: `function query (data) { _.forEach([1], () => { while (true) {} }) }`,
  },
];

/** A trivial run after each probe: the next query runs (criterion 5). */
export const NEXT_QUERY = `function query (data) { return Array.isArray(data) ? data.length : typeof data }`;

/** The bench queries (criterion 12; T5 commits them as bench/query/*.js). */
export const BENCH_QUERIES: { id: string; language: Language; query: string }[] = [
  {
    id: 'filter-map',
    language: 'javascript',
    query: `function query (data) {
  return data
    .filter(item => item.active && item.total > 500)
    .map(item => ({ id: item.id, name: item.name, city: item.address.city, total: item.total }))
}`,
  },
  {
    id: 'filter-orderBy-map',
    language: 'lodash',
    query: `function query (data) {
  return _.chain(data)
    .filter(item => item.active && item.total > 500)
    .orderBy([item => item.address.city, 'total'], ['asc', 'desc'])
    .map(item => _.pick(item, ['id', 'name', 'total']))
    .value()
}`,
  },
];
