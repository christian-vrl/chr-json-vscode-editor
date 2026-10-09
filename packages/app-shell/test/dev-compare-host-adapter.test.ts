// DevCompareHostAdapter (007 T3): what the standalone compare page's host sends, checked against the
// compare fixtures (tests/compare, spec 007 criterion 3), and how it applies, refuses and reports
// copies and edits.
import { describe, expect, it } from 'vitest';
import { compareCases } from '../../../tests/compare/cases.js';
import type { CompareState } from '../src/compare-host-adapter.js';
import { DevCompareHostAdapter } from '../src/dev-compare-host-adapter.js';

const cases = compareCases();

/** The next state the host sends. */
function nextUpdate(host: DevCompareHostAdapter): Promise<CompareState> {
  return new Promise((resolve) => {
    const subscription = host.onUpdate((state) => {
      subscription.dispose();
      resolve(state);
    });
  });
}

describe('DevCompareHostAdapter', () => {
  it('has compare fixtures to run', () => {
    expect(cases.map((c) => c.name)).toEqual(
      expect.arrayContaining(['equal', 'values', 'arrays', 'formats', 'comments']),
    );
  });

  for (const c of cases) {
    it(`sends the fixture's expected differences: ${c.name}`, async () => {
      const host = new DevCompareHostAdapter(c.left, c.right);
      const state = await host.open();
      expect(state.left.content.kind).toBe('data');
      expect(state.right.content.kind).toBe('data');
      expect(state.differences).toEqual(c.expected);
      expect(state.left).toMatchObject({
        name: c.left.name,
        format: c.left.format,
        writable: true,
      });
    });
  }

  it('copies a difference into either side with the format kept, until both sides are equal', async () => {
    const c = cases.find((x) => x.name === 'comments')!;
    const host = new DevCompareHostAdapter(c.left, c.right);
    let state = await host.open();
    // /target changed: copy right → left; the left keeps its comments.
    const update = nextUpdate(host);
    host.copy(state.version, state.differences[0]!, 'left');
    state = await update;
    expect(host.text('left')).toContain('"target": "es2020", // newest supported');
    expect(host.text('left')).toContain('/* Paths to include */');
    expect(state.differences).toHaveLength(c.expected.length - 1);
    // Then the rest, alternating sides.
    let to: 'left' | 'right' = 'right';
    while (state.differences.length > 0) {
      const next = nextUpdate(host);
      host.copy(state.version, state.differences[0]!, to);
      state = await next;
      to = to === 'left' ? 'right' : 'left';
    }
    expect(host.notices).toEqual([]);
    expect(host.copies).toHaveLength(c.expected.length);
  });

  it('refuses a copy into a read-only side, on a stale state, or with a side that does not parse', async () => {
    const host = new DevCompareHostAdapter(
      { name: 'a.json (HEAD)', text: '{"a":1}', format: 'json', writable: false },
      { name: 'a.json', text: '{"a":2}', format: 'json' },
    );
    const state = await host.open();
    expect(state.left.writable).toBe(false);
    const d = state.differences[0]!;
    host.copy(state.version, d, 'left');
    host.copy(state.version - 1, d, 'right');
    host.setText('right', '{"a":');
    const broken = host.state;
    expect(broken.right.content).toMatchObject({ kind: 'error' });
    expect(broken.differences).toEqual([]);
    host.copy(broken.version, d, 'right');
    expect(host.notices.map((n) => n.code)).toEqual(['read-only', 'stale-copy', 'not-compared']);
    expect(host.text('left')).toBe('{"a":1}');
    expect(host.text('right')).toBe('{"a":');
  });

  it('sends a new state with a higher version when a side is edited elsewhere', async () => {
    const host = new DevCompareHostAdapter(
      { name: 'a.json', text: '[1]', format: 'json' },
      { name: 'b.json5', text: '[1]', format: 'json5' },
    );
    const opened = await host.open();
    expect(opened.differences).toEqual([]);
    const update = nextUpdate(host);
    host.setText('right', "[1, 'two'] // JSON5");
    const state = await update;
    expect(state.version).toBeGreaterThan(opened.version);
    expect(state.differences).toEqual([{ kind: 'added', rightPath: '/1' }]);
  });
});
