// Spike 015 T1's page: vanilla-jsoneditor 3.13.0 with the lossless parser (plan 015 R2), driven
// through its own DOM the way a user would (double-click, Enter, paste, Ctrl+C, Ctrl+F, the sort
// dialog, a table header), and the parser bench (plan R1). Every probe reports what it saw; the
// host side (suite.cjs) writes it to results/ and REPORT.md reads it from there.
import {
  createJSONEditor,
  createValueSelection,
  jmespathQueryLanguage,
  jsonQueryLanguage,
  jsonpathQueryLanguage,
  valueType,
  type Content,
  type JSONEditorPropsOptional,
  type JsonEditor,
  type QueryLanguage,
} from 'vanilla-jsoneditor';
import { benchText } from './bench';
import {
  LosslessNumber,
  bigNumberTexts,
  nearestValueParser,
  reviverHasSource,
  spikeParser,
} from './parser';
import type { BenchMessage, PageInfo, ProbeResult, ProbesMessage } from './protocol';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();

const pageErrors: string[] = [];
window.addEventListener('error', (event) => pageErrors.push(event.message));
window.addEventListener('unhandledrejection', (event) =>
  pageErrors.push(describeError(event.reason)),
);

const violations: PageInfo['violations'] = [];
document.addEventListener('securitypolicyviolation', (event) => {
  violations.push({
    directive: event.effectiveDirective,
    blockedURI: event.blockedURI,
    sample: event.sample,
  });
});

function pageInfo(): PageInfo {
  return {
    policy:
      document
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute('content') ?? '',
    userAgent: navigator.userAgent,
    violations: [...violations],
  };
}

const describeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(get: () => T | null | undefined | false, what: string, ms = 5000) {
  const end = performance.now() + ms;
  for (;;) {
    const value = get();
    if (value) return value;
    if (performance.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}

/** A value as plain JSON for the report: big numbers as `{big: "<digits>"}`. */
function plain(value: unknown): unknown {
  if (value instanceof LosslessNumber) return { big: value.value };
  if (typeof value === 'bigint') return { bigint: value.toString() };
  if (typeof value === 'number') {
    return Number.isFinite(value) && !Object.is(value, -0) ? value : { number: String(value) };
  }
  if (Array.isArray(value)) return value.map(plain);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  }
  return value;
}

// ---- The editor under test -------------------------------------------------------------------

const target = document.createElement('div');
target.style.height = '600px';
document.body.append(target);

let editor: JsonEditor | undefined;
interface Change {
  json: unknown;
  redo: unknown;
  /** The sort dialog's controls as the DOM shows them when the change arrives. */
  sortDialog: unknown;
  /** The table header the library marks as sorted when the change arrives. */
  sortedHeader: unknown;
}
let changes: Change[] = [];
let sortModalPropCalls = 0;

function sortDialogState(): unknown {
  const dialog = document.querySelector('.jse-modal.jse-sort-modal');
  if (!dialog) return null;
  return {
    open: (dialog as HTMLDialogElement).open ?? true,
    path: dialog.querySelector<HTMLInputElement>('input.jse-path')?.value,
    selects: [...dialog.querySelectorAll('.svelte-select .selected-item, .svelte-select input')]
      .map((e) => (e instanceof HTMLInputElement ? e.value : e.textContent?.trim()))
      .filter(Boolean),
    text: dialog.textContent?.replace(/\s+/g, ' ').trim().slice(0, 200),
  };
}

function sortedHeaderState(): unknown {
  const icon = target.querySelector('.jse-column-header .jse-column-sort-icon');
  if (!icon) return null;
  const header = icon.closest('.jse-column-header');
  return {
    column: header?.querySelector('.jse-column-name')?.textContent?.trim(),
    title: icon.getAttribute('title'),
  };
}

async function mount(content: Content, mode: 'tree' | 'table', extra: object = {}) {
  await editor?.destroy();
  target.replaceChildren();
  changes = [];
  const props: JSONEditorPropsOptional & Record<string, unknown> = {
    content,
    mode: mode as JSONEditorPropsOptional['mode'],
    parser: spikeParser,
    validationParser: spikeParser,
    queryLanguages: [jsonQueryLanguage, jmespathQueryLanguage, jsonpathQueryLanguage],
    onChange: (updated, _previous, status) => {
      changes.push({
        json: 'json' in updated ? updated.json : spikeParser.parse(updated.text),
        redo: status.patchResult?.redo,
        sortDialog: sortDialogState(),
        sortedHeader: sortedHeaderState(),
      });
    },
    ...extra,
  };
  editor = createJSONEditor({ target, props });
  await until(() => target.querySelector(`.jse-${mode}-mode`), `${mode} mode`);
  await sleep(100);
}

function json(): unknown {
  const content = editor!.get();
  return 'json' in content ? content.json : spikeParser.parse(content.text);
}

function renderedValues(): string[] {
  return [...target.querySelectorAll('.jse-value')].map((e) => e.textContent?.trim() ?? '');
}

function numberValues(): { text: string; numberClass: boolean }[] {
  return [...target.querySelectorAll('.jse-value')].map((e) => ({
    text: e.textContent?.trim() ?? '',
    numberClass: e.classList.contains('jse-number'),
  }));
}

const valueElement = (pointer: string) =>
  target.querySelector(`[data-path="${encodeURIComponent(pointer)}"] .jse-value`);

function key(element: Element, keyName: string, ctrl = false) {
  element.dispatchEvent(
    new KeyboardEvent('keydown', { key: keyName, ctrlKey: ctrl, bubbles: true, cancelable: true }),
  );
}

const hiddenInput = () =>
  target.querySelector<HTMLInputElement>('.jse-hidden-input') ??
  (() => {
    throw new Error('no hidden input');
  })();

/** Big numbers of `value` (any depth) as their texts, in walk order. */
function bigTexts(value: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (v instanceof LosslessNumber) out.push(v.value);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  return out;
}

// ---- Clipboard: every write the library makes, then passed on ----------------------------------

const clipboardWrites: string[] = [];
const clipboardErrors: string[] = [];
if (navigator.clipboard) {
  const write = navigator.clipboard.writeText.bind(navigator.clipboard);
  navigator.clipboard.writeText = async (text: string) => {
    clipboardWrites.push(text);
    try {
      await write(text);
    } catch (error) {
      clipboardErrors.push(describeError(error));
      throw error;
    }
  };
}

// ---- Sorting ---------------------------------------------------------------------------------

const withoutOverflow = (text: string) => text.replace('"ids": [1e400, ', '"ids": [');
/** label, array, sort property (null: the items themselves), fixture variant, parser props. */
const SORT_CASES: [string, string, string | null, (text: string) => string, object][] = [
  ['ids', 'ids', null, (t) => t, {}],
  ['ids without 1e400', 'ids', null, withoutOverflow, {}],
  ['records by id', 'records', 'id', (t) => t, {}],
  // Big numbers whose valueOf never throws (parser.ts NearestValueNumber): does the library's
  // sort then hand over a change for the app to re-sort?
  [
    'ids, valueOf never throws',
    'ids',
    null,
    (t) => t,
    { parser: nearestValueParser, validationParser: nearestValueParser },
  ],
];

async function sortCase(run: () => Promise<unknown>): Promise<unknown> {
  const before = pageErrors.length;
  try {
    return await run();
  } catch (error) {
    return {
      error: describeError(error),
      pageErrors: pageErrors.slice(before),
      changes: changes.length,
      dialog: sortDialogState(),
    };
  }
}

function sortOutcome(array: unknown[], property: string | null) {
  return {
    order: array.map((item) =>
      plain(property ? (item as Record<string, unknown>)[property] : item),
    ),
    redoOps: (changes[0]!.redo as { op: string; path: string }[] | undefined)?.map(
      (op) => `${op.op} ${op.path}`,
    ),
  };
}

/** Picks `property` in the sort dialog's property select (svelte-select). */
async function pickSortProperty(dialog: Element, property: string) {
  const input = dialog.querySelector<HTMLInputElement>('.svelte-select input');
  if (!input) throw new Error(`no property select: ${dialog.innerHTML.slice(0, 1500)}`);
  input.focus();
  input.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
  input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  input.click();
  const item = await until(
    () =>
      [
        ...document.querySelectorAll<HTMLElement>('.svelte-select-list .item, .list-item .item'),
      ].find((e) => e.textContent?.trim() === property),
    `the ${property} item`,
    2000,
  ).catch(() => {
    throw new Error(
      `no ${property} item: ${document.querySelector('.jse-modal.jse-sort-modal')?.innerHTML.slice(0, 2500)}`,
    );
  });
  item.click();
  await sleep(50);
}

// ---- Probes ----------------------------------------------------------------------------------

/** The array `"<name>": [...]` of the fixture, copied as text (digits as written). */
function arrayText(text: string, name: string): string {
  const start = text.indexOf(`"${name}": [`);
  if (start === -1) throw new Error(`no ${name} array`);
  let depth = 0;
  for (let i = text.indexOf('[', start); i < text.length; i++) {
    if (text[i] === '[') depth++;
    else if (text[i] === ']' && --depth === 0) return text.slice(text.indexOf('[', start), i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

const PROBES: Record<string, (text: string) => unknown> = {
  parse(text) {
    const data = spikeParser.parse(text);
    return {
      bigNumbersInText: bigNumberTexts(text),
      bigNumbersInData: bigTexts(data),
      data: plain(data),
      valueTypeOfBig: valueType(new LosslessNumber('12345678901234567890'), spikeParser),
      stringify: spikeParser.stringify(data),
      reviverHasSource: reviverHasSource(),
    };
  },

  async 'tree render'(text) {
    await mount({ text }, 'tree');
    editor!.expand([], () => true);
    await sleep(200);
    const values = numberValues();
    const expected = bigNumberTexts(text);
    return {
      expected,
      missing: expected.filter((t) => !values.some((v) => v.text === t)),
      notNumberClass: values.filter((v) => expected.includes(v.text) && !v.numberClass),
      rendered: values.map((v) => v.text),
    };
  },

  async 'table render'(text) {
    const out: Record<string, unknown> = {};
    for (const name of ['ids', 'records']) {
      const array = arrayText(text, name);
      await mount({ text: array }, 'table');
      const cells = renderedValues();
      const expected = bigNumberTexts(array);
      out[name] = {
        expected,
        missing: expected.filter((t) => !cells.includes(t)),
        cells,
      };
    }
    return out;
  },

  async 'inline edit'(text) {
    await mount({ text }, 'tree');
    const typed = '123456789012345678901';
    const value = await until(() => valueElement('/a'), '/a');
    value.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const field = await until(
      () => target.querySelector<HTMLElement>('.jse-editable-div'),
      'the value field',
    );
    field.textContent = typed;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    key(field, 'Enter');
    await until(() => changes.length > 0, 'a change');
    await sleep(100);
    const a = (json() as Record<string, unknown>).a;
    return {
      typed,
      redo: plain(changes[0]!.redo),
      valueIsLosslessNumber: a instanceof LosslessNumber,
      value: plain(a),
      rendered: valueElement('/a')?.textContent?.trim(),
    };
  },

  async paste(text) {
    const out: Record<string, unknown> = {};
    for (const [pointer, pasted] of [
      ['/b', '123456789012345678901'],
      ['/plain', '[123456789012345678901, 1, 0.1000000000000000000001]'],
    ] as const) {
      await mount({ text }, 'tree');
      editor!.select(createValueSelection([pointer.slice(1)]));
      await sleep(50);
      const input = hiddenInput();
      input.focus();
      const data = new DataTransfer();
      data.setData('text/plain', pasted);
      input.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
      await until(() => changes.length > 0, 'a change');
      await sleep(100);
      const value = (json() as Record<string, unknown>)[pointer.slice(1)];
      out[pointer] = {
        pasted,
        redo: plain(changes[0]!.redo),
        value: plain(value),
        bigTexts: bigTexts(value),
      };
    }
    return out;
  },

  async copy(text) {
    const out: Record<string, unknown> = {};
    for (const pointer of ['/a', '/ids']) {
      await mount({ text }, 'tree');
      editor!.select(createValueSelection([pointer.slice(1)]));
      await sleep(50);
      const input = hiddenInput();
      input.focus();
      const before = clipboardWrites.length;
      key(input, 'c', true);
      await until(() => clipboardWrites.length > before, 'a clipboard write', 3000).catch(() => 0);
      await sleep(100);
      out[pointer] = {
        written: clipboardWrites.slice(before),
        clipboardErrors: [...clipboardErrors],
      };
    }
    return out;
  },

  async search(text) {
    await mount({ text }, 'tree');
    const out: Record<string, unknown> = {};
    hiddenInput().focus();
    key(hiddenInput(), 'f', true);
    const input = await until(
      () => target.querySelector<HTMLInputElement>('.jse-search-input'),
      'the search box',
    );
    for (const query of ['12345678901234567890', '0.1000000000000000000001', '1e400', '4.0']) {
      input.value = query;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(600);
      out[query] = {
        count: target.querySelector('.jse-search-count')?.textContent?.trim(),
        highlighted: [...target.querySelectorAll('.jse-highlight')].map((e) => e.textContent),
      };
    }
    return out;
  },

  async 'sort dialog'(text) {
    const out: Record<string, unknown> = {};
    for (const [label, name, property, variant, parserProps] of SORT_CASES) {
      console.log(`sort case ${label}`);
      out[label] = await sortCase(async () => {
        sortModalPropCalls = 0;
        await mount({ text: variant(text) }, 'tree', {
          ...parserProps,
          // Not in JSONEditorPropsOptional (index.d.ts:483-523): does the root take it anyway?
          onSortModal: () => sortModalPropCalls++,
        });
        // The menu's sort button sorts the root (TreeMode handleSortAll); the selection's context
        // menu sorts the selected array (handleSortSelection, findRootPath).
        editor!.select(createValueSelection([name]));
        await sleep(50);
        const pointer = await until(
          () => target.querySelector<HTMLButtonElement>('.jse-context-menu-pointer'),
          'the context menu pointer',
        );
        pointer.click();
        const sortItem = await until(
          () =>
            [...document.querySelectorAll<HTMLButtonElement>('.jse-contextmenu button')].find(
              (b) => b.textContent?.trim() === 'Sort',
            ),
          'the context menu Sort item',
        );
        sortItem.click();
        const dialog = await until(
          () => document.querySelector('.jse-modal.jse-sort-modal'),
          'the sort dialog',
        );
        if (property) await pickSortProperty(dialog, property);
        const sort = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(
          (b) => b.textContent?.trim() === 'Sort',
        )!;
        sort.click();
        await until(() => changes.length > 0, 'a change', 2000);
        await sleep(100);
        return {
          ...sortOutcome((json() as Record<string, unknown>)[name] as unknown[], property),
          dialogWhenChangeArrived: changes[0]!.sortDialog,
          onSortModalPropCalls: sortModalPropCalls,
        };
      });
    }
    return out;
  },

  async 'table header sort'(text) {
    const out: Record<string, unknown> = {};
    for (const [label, name, property, variant, parserProps] of SORT_CASES) {
      const column = property ?? 'values';
      console.log(`sort case ${label}`);
      out[label] = await sortCase(async () => {
        await mount({ text: arrayText(variant(text), name) }, 'table', parserProps);
        const header = await until(
          () =>
            [...target.querySelectorAll<HTMLElement>('.jse-column-header')].find(
              (e) => e.querySelector('.jse-column-name')?.textContent?.trim() === column,
            ),
          `the ${column} header`,
        );
        header.click();
        await until(() => changes.length > 0, 'a change', 2000);
        await sleep(100);
        return {
          ...sortOutcome(json() as unknown[], property),
          sortedHeaderWhenChangeArrived: changes[0]!.sortedHeader,
          sortedHeaderAfter: sortedHeaderState(),
        };
      });
    }
    return out;
  },

  queries(text) {
    const data = spikeParser.parse(text);
    const rounded = JSON.parse(spikeParser.stringify(data)!) as unknown;
    const cases: [QueryLanguage, string][] = [
      [jsonQueryLanguage, '.records | filter(.id > 5) | map(.id)'],
      [jsonQueryLanguage, '.records | sort(.id) | map(.id)'],
      [jsonQueryLanguage, '.records | map(.id) | max()'],
      [jmespathQueryLanguage, 'records[?id > `5`].id'],
      [jmespathQueryLanguage, 'sort(records[*].id)'],
      [jmespathQueryLanguage, 'max_by(records, &id).id'],
      [jsonpathQueryLanguage, '$.records[?(@.id > 5)].id'],
      [jsonpathQueryLanguage, '$.ids[?(@ > 5)]'],
      [jsonpathQueryLanguage, '$.ids[*]'],
    ];
    const run = (language: QueryLanguage, query: string, input: unknown) => {
      try {
        const result = language.executeQuery(input, query, spikeParser);
        return { result: plain(result), bigTexts: bigTexts(result) };
      } catch (error) {
        return { error: describeError(error) };
      }
    };
    return cases.map(([language, query]) => ({
      language: language.id,
      query,
      // What the library does with the lossless parser as it is (the Transform dialog's path).
      onEditorData: run(language, query, data),
      // B7's input: a copy with every big number its nearest number.
      onRoundedCopy: run(language, query, rounded),
    }));
  },
};

async function runProbes(message: ProbesMessage) {
  const results: ProbeResult[] = [];
  for (const [id, probe] of Object.entries(PROBES)) {
    console.log(`probe ${id}`);
    const t0 = performance.now();
    try {
      results.push({ id, observed: await probe(message.text), ms: performance.now() - t0 });
    } catch (error) {
      results.push({
        id,
        observed: { changes: changes.length },
        error: describeError(error),
        ms: performance.now() - t0,
      });
    }
    await editor?.destroy();
    editor = undefined;
    document.querySelectorAll('.jse-modal').forEach((m) => m.remove());
    target.replaceChildren();
  }
  vscode.postMessage({ type: 'probesResult', results, info: pageInfo() });
}

async function runBench(message: BenchMessage) {
  const results = await benchText(message, message.runs, (method) =>
    vscode.postMessage({ type: 'benchProgress', id: message.id, method }),
  );
  vscode.postMessage({ type: 'benchResult', id: message.id, results, info: pageInfo() });
}

window.addEventListener('message', (event: MessageEvent<{ type: string }>) => {
  const message = event.data;
  if (message?.type === 'probes') void runProbes(message as ProbesMessage);
  if (message?.type === 'bench') void runBench(message as BenchMessage);
});
vscode.postMessage({ type: 'pageReady', info: pageInfo() });
