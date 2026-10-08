// Spec 002 criterion 8 (002 T10): golden cases of whole-document actions. `compact` (R12) and
// `sort` (R13) run through the case's format adapter; the output is byte-equal to `expected`, and
// every comment of the input is in the output (none is attached to a removed member, since these
// actions remove none). `pnpm test:golden -- --op compact,sort` runs only these cases.
import { getAdapter } from '../../packages/core/src/index.js';
import { describe, expect, it } from 'vitest';
import { commentsOf } from './facts.js';
import { filterFromEnv, selectGoldenCases } from './filter.js';
import { loadGoldenCases, wholeDocumentOps, type GoldenCase } from './load.js';

const cases = selectGoldenCases(loadGoldenCases(), filterFromEnv()).filter((c) =>
  wholeDocumentOps.includes(c.tags.op),
);

function run(c: GoldenCase): string {
  const adapter = getAdapter(c.format);
  const action = c.patch[0]!;
  switch (c.tags.op) {
    case 'compact':
      return adapter.compact(c.input);
    case 'sort':
      return adapter.sort(c.input, action);
    default:
      throw new Error(`no runner for op "${c.tags.op}"`);
  }
}

// The comment's text without its delimiters, since R12 writes a line comment as a block comment.
const commentText = (comment: string) =>
  comment.startsWith('//') ? comment.slice(2).trim() : comment.slice(2, -2).trim();

if (cases.length === 0) it.skip('no whole-document case selected', () => {});

describe.each(cases.map((c) => [`${c.format}/${c.name}`, c] as const))('%s', (_, c) => {
  it('has one action', () => {
    expect(c.patch).toHaveLength(1);
    expect(c.patch[0]!.op).toBe(c.tags.op);
  });

  it('is byte-equal to expected', () => {
    expect(run(c)).toBe(c.expected);
  });

  it('keeps every comment of the input', () => {
    const output = commentsOf(run(c)).map((comment) =>
      commentText(comment).replace(/\*\\\//g, '*/'),
    );
    for (const comment of commentsOf(c.input)) expect(output).toContain(commentText(comment));
  });
});
