// Runs the 002 T11 spike over fixtures/ and writes results.md and results.json.
//
// Per fixture it checks the three conditions REPORT.md §How this report reads UNK-018's rule sets:
// the output parses in the fixture's format, its data equals plain jsonrepair's, and every comment
// is kept (reading A: text, in order; reading B: text, in order, at the hand-written anchor).
// Comments and anchors in the output are found with jsonc-parser, not with the engine's own scanner.
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import JSON5 from 'json5';
import { getNodeValue, parseTree, type Node, type ParseError } from 'jsonc-parser';
import { jsonrepair } from 'jsonrepair';
import { repairKeepingComments, scanComments } from './engine.ts';
import { anchorOf, outputComments, sameAnchor, type Anchor } from './measure.ts';

interface ExpectedComment extends Anchor {
  text: string;
}
interface Case {
  format: 'jsonc' | 'json5';
  breakage: string;
  jsonrepairClass: string;
  comments: ExpectedComment[];
}

const here = import.meta.dirname;
const fixturesDir = path.join(here, 'fixtures');

interface Row {
  id: string;
  format: string;
  breakage: string;
  scannerFindsInputComments: boolean;
  parses: boolean;
  parseError?: string;
  dataEqual: boolean;
  comments: number;
  textsKept: number;
  anchorsKept: number;
  insertedNotOverwritten: number;
  keptA: boolean;
  keptB: boolean;
  baselineTextsKept: number;
  misses: string[];
  output: string;
}

function runCase(id: string): Row {
  const dir = path.join(fixturesDir, id);
  const spec = JSON.parse(fs.readFileSync(path.join(dir, 'case.json'), 'utf8')) as Case;
  const input = fs.readFileSync(path.join(dir, `input.${spec.format}`), 'utf8');
  const expectedTexts = spec.comments.map((c) => c.text);
  const scannerFindsInputComments = isDeepStrictEqual(
    scanComments(input).map((c) => c.text),
    expectedTexts,
  );

  const baselineText = jsonrepair(input);
  const baselineData: unknown = JSON.parse(baselineText);
  const baselineTextsKept = expectedTexts.filter((t) => baselineText.includes(t)).length;

  const misses: string[] = [];
  let output = '';
  let inserted = 0;
  try {
    const r = repairKeepingComments(input);
    output = r.text;
    inserted = r.inserted;
  } catch (e) {
    misses.push(`engine threw: ${(e as Error).message}`);
  }

  // Condition 1: parses in the fixture's format.
  let parses = false;
  let parseError: string | undefined;
  let data: unknown;
  let root: Node | undefined;
  if (output) {
    const errors: ParseError[] = [];
    root = parseTree(output, errors, { disallowComments: false, allowTrailingComma: false });
    try {
      // JSONC: jsonc-parser with no errors; JSON5: the reference json5 parser. getNodeValue builds
      // objects with a null prototype, so it goes through JSON to compare with plain objects.
      data =
        spec.format === 'json5'
          ? JSON5.parse(output)
          : root && (JSON.parse(JSON.stringify(getNodeValue(root))) as unknown);
      parses = errors.length === 0 && root !== undefined;
      if (!parses) parseError = `jsonc-parser error code ${errors[0]?.error} at ${errors[0]?.offset}`;
    } catch (e) {
      parseError = (e as Error).message;
    }
  }
  // Condition 2: data equals plain jsonrepair's.
  const dataEqual = parses && isDeepStrictEqual(data, baselineData);
  if (parses && !dataEqual) misses.push('data differs from plain jsonrepair');
  if (!parses && output) misses.push(`does not parse: ${parseError}`);

  // Condition 3: comments kept.
  const found = output ? outputComments(output) : [];
  const foundTexts = found.map((c) => c.text);
  const textsInOrder = isDeepStrictEqual(foundTexts, expectedTexts);
  let textsKept = 0;
  for (let i = 0; i < expectedTexts.length; i++) if (foundTexts[i] === expectedTexts[i]) textsKept++;
  if (!textsInOrder) misses.push(`comments found ${JSON.stringify(foundTexts)}`);
  let anchorsKept = 0;
  if (root && textsInOrder) {
    spec.comments.forEach((want, i) => {
      const got = anchorOf(output, root, found[i]!.start, found[i]!.end);
      if (sameAnchor(got, want)) anchorsKept++;
      else misses.push(`${want.text}: anchor ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    });
  }
  const valid = parses && dataEqual;
  return {
    id,
    format: spec.format,
    breakage: spec.breakage,
    scannerFindsInputComments,
    parses,
    ...(parseError ? { parseError } : {}),
    dataEqual,
    comments: expectedTexts.length,
    textsKept,
    anchorsKept,
    insertedNotOverwritten: inserted,
    keptA: valid && textsInOrder,
    keptB: valid && textsInOrder && anchorsKept === expectedTexts.length,
    baselineTextsKept,
    misses,
    output,
  };
}

const rows = fs
  .readdirSync(fixturesDir)
  .filter((d) => fs.statSync(path.join(fixturesDir, d)).isDirectory())
  .sort()
  .map(runCase);

const keptA = rows.filter((r) => r.keptA).length;
const keptB = rows.filter((r) => r.keptB).length;
const baselineAll = rows.filter((r) => r.baselineTextsKept === r.comments).length;
const total = rows.reduce((n, r) => n + r.comments, 0);

const yes = (b: boolean) => (b ? 'yes' : '**no**');
const md = [
  '# 002 T11 results (generated by `run.ts`; do not edit)',
  '',
  `- Fixtures kept, reading B (parse + data + every comment at its anchor): **${keptB} of ${rows.length}**`,
  `- Fixtures kept, reading A (parse + data + every comment's text, in order): **${keptA} of ${rows.length}**`,
  `- Baseline, plain \`jsonrepair\` 3.15.0: every comment kept on ${baselineAll} of ${rows.length} fixtures (${rows.reduce((n, r) => n + r.baselineTextsKept, 0)} of ${total} comments)`,
  '',
  '| Fixture | Format | Parses | Data = jsonrepair | Comment texts kept | Anchors kept | Inserted (placeholder lost) | Kept (A) | Kept (B) |',
  '|---|---|---|---|---|---|---|---|---|',
  ...rows.map(
    (r) =>
      `| ${r.id} | ${r.format} | ${yes(r.parses)} | ${yes(r.dataEqual)} | ${r.textsKept}/${r.comments} | ${r.anchorsKept}/${r.comments} | ${r.insertedNotOverwritten} | ${yes(r.keptA)} | ${yes(r.keptB)} |`,
  ),
  '',
  `Sanity check: the engine's scanner finds exactly the comments listed in \`case.json\` on ${rows.filter((r) => r.scannerFindsInputComments).length} of ${rows.length} inputs.`,
  '',
  '## Misses',
  '',
  ...(rows.some((r) => r.misses.length)
    ? rows.flatMap((r) => r.misses.map((m) => `- ${r.id}: ${m}`))
    : ['None.']),
  '',
  '## Outputs',
  '',
  ...rows.flatMap((r) => [`### ${r.id}`, '', '```' + r.format, r.output.replace(/\n$/, ''), '```', '']),
];
fs.writeFileSync(path.join(here, 'results.md'), md.join('\n'));
fs.writeFileSync(
  path.join(here, 'results.json'),
  JSON.stringify({ node: process.version, keptA, keptB, baselineAll, rows }, null, 2) + '\n',
);
console.log(`kept (B) ${keptB}/${rows.length}, kept (A) ${keptA}/${rows.length}, baseline ${baselineAll}/${rows.length}`);
