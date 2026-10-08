import { describe, expect, it } from 'vitest';
import { decide, parseVerdict, taskFromTitle } from '../../scripts/gate-review/verdict.mjs';

const head = '62d26ab0e3ce28f5de5d625bf46385aa5a03d7de';
const title = '001-T9: gate-review workflow';
const writers = new Set(['christian-vrl']);

function comment(body: string, author = 'christian-vrl', n = 1) {
  return { author, body, url: `https://example.test/c${n}` };
}

describe('parseVerdict', () => {
  it('reads the first line of a Reviewer comment', () => {
    expect(parseVerdict(`Gate review 001-T9: PASS @ ${head}\n\n| table |`)).toEqual({
      task: '001-T9',
      pass: true,
      sha: head,
    });
    expect(parseVerdict('Gate review 002-T13: FAIL @ 62D26AB\r\nfindings')).toEqual({
      task: '002-T13',
      pass: false,
      sha: '62d26ab',
    });
  });

  it('ignores anything that is not exactly the verdict line', () => {
    for (const body of [
      '',
      null,
      undefined,
      `Re: Gate review 001-T9: PASS @ ${head}`,
      `gate review 001-T9: PASS @ ${head}`,
      `Gate review 001-T9: pass @ ${head}`,
      `Gate review 1-T9: PASS @ ${head}`,
      'Gate review 001-T9: PASS @ 62d26a',
      `Gate review 001-T9: PASS @ ${head}0`,
      `Gate review 001-T9: PASS @ ${head} (after rebase)`,
      `Some intro\nGate review 001-T9: PASS @ ${head}`,
    ]) {
      expect(parseVerdict(body), String(body)).toBeNull();
    }
  });
});

describe('taskFromTitle', () => {
  it('reads the task id a PR title starts with', () => {
    expect(taskFromTitle('001-T9: gate-review workflow')).toBe('001-T9');
    expect(taskFromTitle('002-T13: something')).toBe('002-T13');
    expect(taskFromTitle('Bump eslint')).toBeNull();
  });
});

describe('decide (spec 001 criterion 4)', () => {
  it('fails with no verdict comment', () => {
    const d = decide({ headSha: head, title, comments: [comment('LGTM')], writers });
    expect(d.pass).toBe(false);
    expect(d.reason).toMatch(/no .*PASS.* for 62d26ab0e3ce/i);
  });

  it('passes on a PASS for the current head, full or abbreviated', () => {
    for (const sha of [head, head.slice(0, 7)]) {
      const d = decide({
        headSha: head,
        title,
        comments: [comment(`Gate review 001-T9: PASS @ ${sha}`)],
        writers,
      });
      expect(d.pass).toBe(true);
      expect(d.decisive?.url).toBe('https://example.test/c1');
    }
  });

  it('ignores a PASS for an earlier head (a new push needs a new review)', () => {
    const d = decide({
      headSha: head,
      title,
      comments: [comment('Gate review 001-T9: PASS @ 4fd762a')],
      writers,
    });
    expect(d.pass).toBe(false);
    expect(d.ignored).toEqual([
      { url: 'https://example.test/c1', why: 'for 4fd762a, not the head 62d26ab0e3ce' },
    ]);
  });

  it('ignores a PASS from someone without write access', () => {
    const d = decide({
      headSha: head,
      title,
      comments: [comment(`Gate review 001-T9: PASS @ ${head}`, 'drive-by')],
      writers,
    });
    expect(d.pass).toBe(false);
    expect(d.ignored[0]?.why).toBe('drive-by has no write access');
  });

  it('ignores a PASS for another task than the PR title names', () => {
    const d = decide({
      headSha: head,
      title,
      comments: [comment(`Gate review 001-T8: PASS @ ${head}`)],
      writers,
    });
    expect(d.pass).toBe(false);
    expect(d.ignored[0]?.why).toBe('for task 001-T8, but the PR title names 001-T9');
  });

  it('accepts any task when the title names none', () => {
    const d = decide({
      headSha: head,
      title: 'Bump eslint',
      comments: [comment(`Gate review 001-T8: PASS @ ${head}`)],
      writers,
    });
    expect(d.pass).toBe(true);
  });

  it('lets the latest counting verdict win', () => {
    const pass = comment(`Gate review 001-T9: PASS @ ${head}`, 'christian-vrl', 1);
    const fail = comment(`Gate review 001-T9: FAIL @ ${head}`, 'christian-vrl', 2);
    expect(decide({ headSha: head, title, comments: [pass, fail], writers }).pass).toBe(false);
    const d = decide({ headSha: head, title, comments: [fail, pass], writers });
    expect(d.pass).toBe(true);
    expect(d.decisive).toBe(pass);
    const latestFail = decide({ headSha: head, title, comments: [pass, fail], writers });
    expect(latestFail.reason).toMatch(/latest verdict .* is FAIL/);
  });
});
