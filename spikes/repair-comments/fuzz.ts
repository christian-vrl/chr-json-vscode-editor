// Supporting evidence for 002 T11, not part of UNK-018's count: generated documents.
//
// Each case is a random, valid, commented JSONC document (seeded PRNG), broken in one way taken
// from the fixture classes. The expected anchors are measured on the valid document before it is
// broken, so nothing here is written by hand or fitted to the engine. A case passes under the same
// conditions as a fixture (reading B): parses, data equals plain jsonrepair's, every comment's
// text in order and at its anchor. Writes fuzz.md.
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { getNodeValue, parseTree, type Node, type ParseError } from 'jsonc-parser';
import { jsonrepair } from 'jsonrepair';
import { repairKeepingComments } from './engine.ts';
import { anchorOf, outputComments, sameAnchor } from './measure.ts';

const SEED = 20261008;
const CASES = 5000;

// mulberry32
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Gen {
  r: () => number;
  n: number;
}
const pick = <T>(g: Gen, xs: readonly T[]): T => xs[Math.floor(g.r() * xs.length)]!;

const STRINGS = ['x', 'hello world', 'http://example.com/a', 'a /* b */ c', 'it is', ''];
const KEYS = ['name', 'id', 'url', 'items', 'enabled', 'max_size', 'note'];

/** Pretty-prints a random value with comments around its members. */
function value(g: Gen, depth: number, indent: string): string {
  const roll = g.r();
  if (depth < 3 && roll < 0.35) return container(g, depth + 1, indent, g.r() < 0.5);
  return scalar(g);
}
function scalar(g: Gen): string {
  return pick(g, [
    () => String(Math.floor(g.r() * 1000)),
    () => JSON.stringify(pick(g, STRINGS)),
    () => 'true',
    () => 'false',
    () => 'null',
  ])();
}
function comment(g: Gen, kind: 'line' | 'block'): string {
  g.n++;
  return kind === 'line' ? `// c${g.n}` : `/* c${g.n} */`;
}
function container(g: Gen, depth: number, indent: string, isArray: boolean): string {
  const count = 1 + Math.floor(g.r() * 4);
  const inner = indent + '  ';
  const used = new Set<string>();
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    if (g.r() < 0.3) lines.push(inner + comment(g, g.r() < 0.7 ? 'line' : 'block'));
    let key = '';
    if (!isArray) {
      let k = pick(g, KEYS);
      while (used.has(k)) k += '2';
      used.add(k);
      key = JSON.stringify(k) + ': ' + (g.r() < 0.1 ? comment(g, 'block') + ' ' : '');
    }
    const comma = i < count - 1 ? ',' : '';
    const trailing = g.r() < 0.3 ? ' ' + comment(g, g.r() < 0.7 ? 'line' : 'block') : '';
    lines.push(inner + key + value(g, depth, inner) + comma + trailing);
  }
  const [open, close] = isArray ? ['[', ']'] : ['{', '}'];
  return `${open}\n${lines.join('\n')}\n${indent}${close}`;
}

type Breakage = (g: Gen, text: string) => string | null;

// Commas and quotes are found on the valid document with jsonc-parser's tree, so a `,` or `"`
// inside a string or comment is never touched.
function memberEnds(text: string): number[] {
  const root = parseTree(text)!;
  const ends: number[] = [];
  const walk = (n: Node) => {
    const kids = n.children ?? [];
    if (n.type === 'object' || n.type === 'array') kids.slice(0, -1).forEach((k) => ends.push(k.offset + k.length));
    kids.forEach(walk);
  };
  walk(root);
  return ends;
}
function nodesOf(text: string, pred: (n: Node) => boolean): Node[] {
  const out: Node[] = [];
  const walk = (n: Node) => {
    if (pred(n)) out.push(n);
    (n.children ?? []).forEach(walk);
  };
  walk(parseTree(text)!);
  return out;
}
const splice = (text: string, at: number, remove: number, insert: string) =>
  text.slice(0, at) + insert + text.slice(at + remove);

const BREAKAGES: Record<string, Breakage> = {
  'missing comma': (g, t) => {
    const ends = memberEnds(t);
    if (!ends.length) return null;
    const end = pick(g, ends);
    return t[end] === ',' ? splice(t, end, 1, '') : null;
  },
  truncated: (_g, t) => t.replace(/[\s\]}]+$/, ''),
  'unquoted key': (g, t) => {
    const keys = nodesOf(t, (n) => n.type === 'string' && n.parent?.type === 'property' && n.parent.children?.[0] === n);
    if (!keys.length) return null;
    const k = pick(g, keys);
    return splice(t, k.offset, k.length, String(k.value));
  },
  'single quotes': (g, t) => {
    const strs = nodesOf(t, (n) => n.type === 'string' && !/['\\]/.test(String(n.value)));
    if (!strs.length) return null;
    const s = pick(g, strs);
    return splice(t, s.offset, s.length, `'${String(s.value)}'`);
  },
  'python constant': (g, t) => {
    const lits = nodesOf(t, (n) => n.type === 'boolean' || n.type === 'null');
    if (!lits.length) return null;
    const l = pick(g, lits);
    return splice(t, l.offset, l.length, l.type === 'null' ? 'None' : l.value ? 'True' : 'False');
  },
  ellipsis: (g, t) => {
    const arrays = nodesOf(t, (n) => n.type === 'array' && !!n.children?.length);
    if (!arrays.length) return null;
    const last = pick(g, arrays).children!.at(-1)!;
    return splice(t, last.offset + last.length, 0, ', ...');
  },
  'markdown fence': (_g, t) => '```json\n' + t + '\n```\n',
  jsonp: (_g, t) => 'callback(' + t + ');\n',
};

interface Tally {
  cases: number;
  passed: number;
  examples: string[];
}

function main() {
  const g: Gen = { r: prng(SEED), n: 0 };
  const tallies = new Map<string, Tally>(Object.keys(BREAKAGES).map((k) => [k, { cases: 0, passed: 0, examples: [] }]));
  let generated = 0;
  while ([...tallies.values()].reduce((n, t) => n + t.cases, 0) < CASES) {
    g.n = 0;
    const valid = container(g, 1, '', g.r() < 0.25);
    generated++;
    const validRoot = parseTree(valid)!;
    const want = outputComments(valid).map((c) => ({ text: c.text, anchor: anchorOf(valid, validRoot, c.start, c.end) }));
    if (!want.length) continue;
    const name = pick(g, Object.keys(BREAKAGES));
    const broken = BREAKAGES[name]!(g, valid);
    if (broken === null || broken === valid) continue;
    let baseline: unknown;
    try {
      baseline = JSON.parse(jsonrepair(broken));
    } catch {
      continue; // plain jsonrepair cannot repair it either: nothing to keep comments through
    }
    const tally = tallies.get(name)!;
    tally.cases++;
    let why = '';
    try {
      const out = repairKeepingComments(broken).text;
      const errors: ParseError[] = [];
      const root = parseTree(out, errors, { disallowComments: false, allowTrailingComma: false });
      const found = outputComments(out);
      if (errors.length || !root) why = 'does not parse';
      else if (!isDeepStrictEqual(JSON.parse(JSON.stringify(getNodeValue(root))), baseline)) why = 'data differs';
      else if (!isDeepStrictEqual(found.map((c) => c.text), want.map((w) => w.text))) why = 'comment texts differ';
      else {
        const bad = want.findIndex((w, i) => !sameAnchor(anchorOf(out, root, found[i]!.start, found[i]!.end), w.anchor));
        if (bad >= 0) why = `anchor of ${want[bad]!.text}`;
      }
      if (why && tally.examples.length < 3) tally.examples.push(`${why}\n\nInput:\n\n${broken}\n\nOutput:\n\n${out}`);
    } catch (e) {
      why = `engine threw: ${(e as Error).message}`;
      if (tally.examples.length < 3) tally.examples.push(`${why}\n\nInput:\n\n${broken}`);
    }
    if (!why) tally.passed++;
  }

  const rows = [...tallies.entries()];
  const total = rows.reduce((n, [, t]) => n + t.cases, 0);
  const passed = rows.reduce((n, [, t]) => n + t.passed, 0);
  const md = [
    '# 002 T11 generated cases (generated by `fuzz.ts`; do not edit)',
    '',
    `Seed ${SEED}, ${total} cases from ${generated} generated documents (skipped: no comment, breakage not applicable, or plain jsonrepair throws). Node ${process.version}.`,
    '',
    `**Passed (reading B): ${passed} of ${total} (${((100 * passed) / total).toFixed(1)}%).**`,
    '',
    '| Breakage | Cases | Passed | % |',
    '|---|---|---|---|',
    ...rows.map(([k, t]) => `| ${k} | ${t.cases} | ${t.passed} | ${t.cases ? ((100 * t.passed) / t.cases).toFixed(1) : '-'} |`),
    '',
    '## Failure examples (up to 3 per breakage)',
    '',
    ...rows.flatMap(([k, t]) => t.examples.map((e, i) => `### ${k} ${i + 1}\n\n\`\`\`\n${e}\n\`\`\`\n`)),
  ];
  fs.writeFileSync(path.join(import.meta.dirname, 'fuzz.md'), md.join('\n'));
  console.log(`generated: passed ${passed}/${total}`);
}

main();
