// Spike 011 T1 editor page: the engine inside the main bundle (R7 route c), compiled when a task
// first needs it. Tasks: `load` (route c), `probes` (criteria 4 and 5, driven one probe at a time by
// the host so it can time a round trip after each), `bench` (criterion 12's queries) and `typing`
// (R2: the library's real Transform dialog with JavaScript on this engine, a query typed one key at
// a time).
import {
  createJSONEditor,
  javascriptQueryLanguage,
  jsonQueryLanguage,
  lodashQueryLanguage,
  type JsonEditor,
  type QueryLanguage,
} from 'vanilla-jsoneditor';
import { loadEngine, QueryError, type Engine } from './engine';
import { BENCH_QUERIES, NEXT_QUERY, PROBES } from './probes';
import type { BenchResult, LoadResult, ProbeResult, StartMessage, TypingResult } from './protocol';
import { describe, onStart, pageInfo, settle, vscode } from './pageCommon';
import { fnv1a } from './hash';

let data: unknown;

async function load(start: StartMessage): Promise<void> {
  const t0 = performance.now();
  const result: LoadResult = {
    type: 'loadResult',
    route: 'c',
    loaded: false,
    error: null,
    loadMs: 0,
    check: null,
    info: pageInfo(),
  };
  try {
    const engine = await loadEngine();
    result.loadMs = performance.now() - t0;
    result.check = engine.runQuery(
      'javascript',
      JSON.parse(start.text),
      'function query (data) { return data.length }',
    );
    result.loaded = true;
  } catch (error) {
    result.loadMs = performance.now() - t0;
    result.error = describe(error);
  }
  await settle();
  result.info = pageInfo();
  vscode.postMessage(result);
}

function runProbe(engine: Engine, index: number): ProbeResult {
  const probe = PROBES[index]!;
  const t0 = performance.now();
  const result: ProbeResult = {
    type: 'probeResult',
    id: probe.id,
    ms: 0,
    next: null,
    info: pageInfo(),
  };
  try {
    result.value = engine.runQuery(probe.language, data, probe.query);
  } catch (error) {
    result.error = error instanceof QueryError ? error.message : describe(error);
    if (error instanceof QueryError) result.engineError = error.engineError;
  }
  result.ms = performance.now() - t0;
  try {
    result.next = engine.runQuery('javascript', data, NEXT_QUERY);
  } catch (error) {
    result.next = `failed: ${describe(error)}`;
  }
  result.info = pageInfo();
  return result;
}

function bench(engine: Engine, runs: number): void {
  for (const query of BENCH_QUERIES) {
    const result: BenchResult = {
      type: 'benchResult',
      id: query.id,
      language: query.language,
      runs: [],
      resultHash: '',
      resultLength: 0,
    };
    for (let i = 0; i < runs; i++) {
      const { timings, resultText } = engine.runQueryTimed(query.language, data, query.query);
      result.runs.push(timings);
      result.resultHash = fnv1a(resultText);
      result.resultLength = resultText.length;
    }
    vscode.postMessage(result);
  }
}

// R2: 40 characters typed one at a time after the anchor in the wizard's query of each language.
const TYPING = {
  javascript: { anchor: 'return data', typed: '.filter(item => item.total > 500).length' },
  lodash: { anchor: '_.chain(data)', typed: ".filter(i => i.total > 50).orderBy('id')" },
} as const;

function waitFor<T>(find: () => T | null | undefined, timeoutMs = 30_000): Promise<T> {
  const t0 = performance.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const found = find();
      if (found) resolve(found);
      else if (performance.now() - t0 > timeoutMs) reject(new Error('waitFor timed out'));
      else setTimeout(tick, 20);
    };
    tick();
  });
}

async function typing(
  engine: Engine,
  language: 'javascript' | 'lodash',
  intervalMs: number,
): Promise<TypingResult> {
  const { anchor, typed: TYPED } = TYPING[language];
  let typingStarted = Infinity;
  const runs: TypingResult['runs'] = [];
  let lastQuery = '';
  const traced = (language: 'javascript' | 'lodash', base: QueryLanguage): QueryLanguage => ({
    ...base,
    executeQuery(json, query) {
      const t0 = performance.now();
      try {
        return engine.runQuery(language, json, query);
      } finally {
        if (t0 >= typingStarted)
          runs.push({
            at: t0 - typingStarted,
            ms: performance.now() - t0,
            queryLength: query.length,
          });
        lastQuery = query;
      }
    },
  });
  const target = document.createElement('div');
  target.style.height = '100vh';
  document.body.append(target);
  const editor: JsonEditor = createJSONEditor({
    target,
    props: {
      content: { json: data },
      mode: 'tree' as never,
      queryLanguages: [
        jsonQueryLanguage,
        traced('javascript', javascriptQueryLanguage),
        traced('lodash', lodashQueryLanguage),
      ],
      queryLanguageId: language,
    },
  });
  try {
    await settle(500);
    editor.transform();
    const textarea = await waitFor(() =>
      document.querySelector<HTMLTextAreaElement>('.jse-transform-modal textarea.jse-query'),
    );
    // The dialog's first preview (the wizard's query) runs 300 ms after it opens.
    await settle(3000);
    const base = textarea.value;
    const at = base.indexOf(anchor) + anchor.length;
    if (at < anchor.length) throw new Error(`unexpected wizard query: ${base}`);
    const keyAt: number[] = [];
    typingStarted = performance.now();
    await new Promise<void>((resolve) => {
      const key = (i: number) => {
        keyAt.push(performance.now() - typingStarted);
        const typed = TYPED.slice(0, i + 1);
        textarea.value = base.slice(0, at) + typed + base.slice(at);
        textarea.setSelectionRange(at + typed.length, at + typed.length);
        textarea.dispatchEvent(
          new InputEvent('input', { bubbles: true, inputType: 'insertText', data: TYPED[i] }),
        );
        if (i + 1 === TYPED.length) {
          resolve();
          return;
        }
        // Each key is due `intervalMs` after the first key's due time; a blocked page makes it late.
        const due = (i + 1) * intervalMs;
        setTimeout(() => key(i + 1), Math.max(0, due - (performance.now() - typingStarted)));
      };
      key(0);
    });
    // Let the last preview run (300 ms debounce, then the run itself).
    await settle(4000);
    let longestKeyGapMs = 0;
    for (let i = 1; i < keyAt.length; i++)
      longestKeyGapMs = Math.max(longestKeyGapMs, keyAt[i]! - keyAt[i - 1]!);
    const finalText = base.slice(0, at) + TYPED + base.slice(at);
    const preview = document.querySelector('.jse-transform-modal .jse-preview-data');
    return {
      type: 'typingResult',
      language,
      intervalMs,
      typed: TYPED,
      keyAt,
      runs,
      longestKeyGapMs,
      finalPreviewMatches: lastQuery === finalText,
      previewText: (preview?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
    };
  } finally {
    void editor.destroy();
    target.remove();
  }
}

let engine: Engine | undefined;
window.addEventListener('message', (event: MessageEvent<{ type: string; index?: number }>) => {
  if (event.data?.type === 'probe' && engine)
    vscode.postMessage(runProbe(engine, event.data.index ?? 0));
});

onStart(async (start) => {
  const task = start.task;
  if (task.kind === 'load') return load(start);
  data = JSON.parse(start.text);
  engine = await loadEngine();
  if (task.kind === 'probes') {
    vscode.postMessage({ type: 'probesReady', count: PROBES.length, info: pageInfo() });
  } else if (task.kind === 'bench') {
    bench(engine, task.runs);
    await settle();
    vscode.postMessage({ type: 'done', info: pageInfo() });
  } else if (task.kind === 'typing') {
    for (const { language, intervalMs } of task.runs) {
      try {
        vscode.postMessage(await typing(engine, language, intervalMs));
      } catch (error) {
        vscode.postMessage({ type: 'typingError', language, intervalMs, error: describe(error) });
      }
    }
    await settle();
    vscode.postMessage({ type: 'done', info: pageInfo() });
  }
});
