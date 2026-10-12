// Parser costs (plan 015 R1), run the same way in Node and in the VS Code webview: each method on
// each text, median of `runs`. Every method's result is checked once against the expected count
// of big numbers, so a fast method that reads the text wrongly cannot look good.
import { getAdapter, parseData } from '@chr-json-editor/core';
import {
  LosslessNumber,
  PLAN_SCAN,
  TOKEN_SCAN,
  losslessParse,
  losslessParseAll,
  losslessStringify,
  reviverHasSource,
  reviverParse,
  scanLoop,
  spikeParser,
} from './parser';

export interface BenchText {
  id: string;
  /** Big numbers the text holds (0 for the plain documents). */
  bigNumbers: number;
  text: string;
}

export interface MethodResult {
  median: number;
  min: number;
  max: number;
  runs: number[];
  /** What the method returned on its first run: a scan's verdict, or a parse's big-number count. */
  answer: boolean | number | string;
  error?: string;
}

interface Method {
  id: string;
  run(text: string, data: () => unknown): unknown;
  /** Each run needs a text it has not seen (the method caches by text). */
  fresh?: boolean;
  /** Skipped at this size (memory). */
  skip?: (bytes: number) => boolean;
}

const countBig = (value: unknown): number => {
  let n = 0;
  const walk = (v: unknown): void => {
    if (v instanceof LosslessNumber) n++;
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  return n;
};

const FIFTY_MIB = 50 * 1024 * 1024;

export const METHODS: Method[] = [
  { id: 'JSON.parse', run: (t) => JSON.parse(t) as unknown },
  { id: 'scan: plan regex', run: (t) => PLAN_SCAN.test(t) },
  { id: 'scan: token regex', run: (t) => TOKEN_SCAN.test(t) },
  { id: 'scan: char loop', run: (t) => scanLoop(t) },
  { id: 'spike parser (token scan + route)', run: (t) => spikeParser.parse(t) },
  { id: 'lossless-json parse, big only', run: (t) => losslessParse(t) },
  { id: 'lossless-json parse, all numbers', run: (t) => losslessParseAll(t) },
  { id: 'JSON.parse + source reviver', run: (t) => reviverParse(t) },
  { id: 'core parseData(json)', run: (t) => parseData('json', t) },
  {
    id: 'core getAdapter(json).parse',
    run: (t) => getAdapter('json').parse(t),
    // core caches the last parse by text: each run gets its own text (one more trailing space).
    fresh: true,
    // A full parse of 50 MiB holds about 1.1 GB (bench/RESULTS.md); the webview may not have it.
    skip: (bytes) => bytes >= FIFTY_MIB,
  },
  { id: 'JSON.stringify (data)', run: (_t, data) => JSON.stringify(data()) },
  { id: 'lossless-json stringify (data)', run: (_t, data) => losslessStringify(data()) },
];

function answerOf(id: string, value: unknown): boolean | number | string {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return `${value.length} chars`;
  if (id.startsWith('core')) {
    const v = value as { data?: unknown; error?: unknown };
    return 'error' in v && v.error ? 'error' : countBig(v.data);
  }
  return countBig(value);
}

const round = (x: number): number => Math.round(x * 10) / 10;

export async function benchText(
  input: BenchText,
  runs: number,
  onMethod?: (id: string) => void,
): Promise<Record<string, MethodResult | { skipped: string }>> {
  const out: Record<string, MethodResult | { skipped: string }> = {};
  let cached: unknown;
  const data = (): unknown => (cached ??= spikeParser.parse(input.text));
  for (const method of METHODS) {
    onMethod?.(method.id);
    if (method.skip?.(input.text.length)) {
      out[method.id] = { skipped: 'memory (full parse of 50 MiB)' };
      continue;
    }
    if (method.id.includes('reviver') && !reviverHasSource()) {
      out[method.id] = { skipped: 'this engine gives revivers no source text' };
      continue;
    }
    if (method.id.includes('stringify')) data();
    const times: number[] = [];
    let answer: MethodResult['answer'] = '';
    let error: string | undefined;
    for (let r = 0; r < runs; r++) {
      // Give the page a turn (and the collector a chance) between runs.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const text = method.fresh ? input.text + ' '.repeat(r) : input.text;
      const t0 = performance.now();
      let value: unknown;
      try {
        value = method.run(text, data);
      } catch (e) {
        error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        break;
      }
      times.push(performance.now() - t0);
      if (r === 0) answer = answerOf(method.id, value);
    }
    const sorted = [...times].sort((a, b) => a - b);
    out[method.id] = {
      median: round(sorted[Math.floor(sorted.length / 2)] ?? NaN),
      min: round(sorted[0] ?? NaN),
      max: round(sorted.at(-1) ?? NaN),
      runs: times.map(round),
      answer,
      ...(error ? { error } : {}),
    };
  }
  cached = undefined;
  return out;
}
