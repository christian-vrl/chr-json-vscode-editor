// The two gate-review CLIs against a fake GitHub REST API (001 T9). check.mjs is the pull_request
// job; rerun.mjs is the issue_comment job that re-runs it when a verdict comment changes.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const head = '62d26ab0e3ce28f5de5d625bf46385aa5a03d7de';

interface FakeRun {
  id: number;
  status: string;
}

interface Fake {
  title: string;
  comments: { user: { login: string }; body: string; html_url: string }[];
  permissions: Record<string, string>;
  runs: FakeRun[];
  /** Runs reported in progress this many more times before completing. */
  busyPolls: number;
  reruns: number[];
  requests: string[];
}

let server: Server;
let api: string;
let dir: string;
let fake: Fake;

function json(res: import('node:http').ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'gate-review-'));
  fake = {
    title: '001-T9: gate-review workflow',
    comments: [],
    permissions: { 'christian-vrl': 'admin' },
    runs: [],
    busyPolls: 0,
    reruns: [],
    requests: [],
  };
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    fake.requests.push(`${req.method} ${url.pathname}${url.search}`);
    if (req.headers.authorization !== 'Bearer test-token') return json(res, 401, {});
    let m;
    if (url.pathname === '/repos/o/r/pulls/7') {
      return json(res, 200, { title: fake.title, head: { sha: head } });
    }
    if (url.pathname === '/repos/o/r/issues/7/comments') {
      const page = Number(url.searchParams.get('page') ?? '1');
      const per = Number(url.searchParams.get('per_page') ?? '30');
      return json(res, 200, fake.comments.slice((page - 1) * per, page * per));
    }
    if ((m = /^\/repos\/o\/r\/collaborators\/([^/]+)\/permission$/.exec(url.pathname))) {
      const permission = fake.permissions[decodeURIComponent(m[1] ?? '')];
      return permission ? json(res, 200, { permission }) : json(res, 404, {});
    }
    if (url.pathname === '/repos/o/r/actions/workflows/gate-review.yml/runs') {
      expect(url.searchParams.get('head_sha')).toBe(head);
      expect(url.searchParams.get('event')).toBe('pull_request');
      const busy = fake.busyPolls-- > 0;
      return json(res, 200, {
        workflow_runs: fake.runs.map((r) => ({ ...r, status: busy ? 'in_progress' : r.status })),
      });
    }
    if ((m = /^\/repos\/o\/r\/actions\/runs\/(\d+)\/rerun$/.exec(url.pathname))) {
      fake.reruns.push(Number(m[1]));
      return json(res, 201, {});
    }
    return json(res, 404, { message: 'not faked' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  api = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

function run(script: string, event: unknown): Promise<{ status: number | null; output: string }> {
  const eventPath = path.join(dir, 'event.json');
  writeFileSync(eventPath, JSON.stringify(event));
  const child = spawn(process.execPath, [path.join(repo, 'scripts/gate-review', script)], {
    cwd: repo,
    env: {
      PATH: process.env.PATH,
      GITHUB_TOKEN: 'test-token',
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_API_URL: api,
      GITHUB_EVENT_PATH: eventPath,
      GATE_REVIEW_POLL_MS: '1',
    },
  });
  let output = '';
  child.stdout.on('data', (d: Buffer) => (output += d.toString()));
  child.stderr.on('data', (d: Buffer) => (output += d.toString()));
  return new Promise((resolve) => child.on('close', (status) => resolve({ status, output })));
}

function verdict(body: string, login = 'christian-vrl') {
  fake.comments.push({
    user: { login },
    body,
    html_url: `https://github.test/c${fake.comments.length + 1}`,
  });
}

const prEvent = { pull_request: { number: 7, head: { sha: head } } };

describe('check.mjs (the gate-review check, spec 001 criterion 4)', () => {
  it('fails a PR with no verdict comment', async () => {
    verdict('Thanks!');
    const { status, output } = await run('check.mjs', prEvent);
    expect(output).toMatch(/gate-review: FAIL/);
    expect(status).toBe(1);
  });

  it('passes once a collaborator posts a PASS for the head SHA', async () => {
    verdict(`Gate review 001-T9: PASS @ ${head}\n\nrubric`);
    const { status, output } = await run('check.mjs', prEvent);
    expect(output).toMatch(/gate-review: PASS .*https:\/\/github\.test\/c1/);
    expect(status).toBe(0);
  });

  it('does not count a PASS from a read-only collaborator or a stranger', async () => {
    fake.permissions['reader'] = 'read';
    verdict(`Gate review 001-T9: PASS @ ${head}`, 'reader');
    verdict(`Gate review 001-T9: PASS @ ${head}`, 'stranger');
    const { status, output } = await run('check.mjs', prEvent);
    expect(output).toMatch(/reader has no write access/);
    expect(output).toMatch(/stranger has no write access/);
    expect(status).toBe(1);
  });

  it('reads every page of comments', async () => {
    for (let i = 0; i < 150; i++) verdict(`comment ${i}`);
    verdict(`Gate review 001-T9: PASS @ ${head}`);
    const { status } = await run('check.mjs', prEvent);
    expect(fake.requests.filter((r) => r.includes('/issues/7/comments'))).toHaveLength(2);
    expect(status).toBe(0);
  });

  it('exits 2 when the API refuses', async () => {
    const { status, output } = await run('check.mjs', {
      pull_request: { number: 8, head: { sha: head } },
    });
    expect(output).toMatch(/error/i);
    expect(status).toBe(2);
  });
});

describe('rerun.mjs (re-evaluates the check when a verdict comment changes)', () => {
  const commentEvent = (body: string, extra: object = {}) => ({
    action: 'created',
    issue: { number: 7, pull_request: { url: 'x' } },
    comment: { body },
    ...extra,
  });

  it('re-runs the latest gate-review run for the PR head', async () => {
    fake.runs = [
      { id: 30, status: 'completed' },
      { id: 20, status: 'completed' },
    ];
    const { status } = await run('rerun.mjs', commentEvent(`Gate review 001-T9: PASS @ ${head}`));
    expect(fake.reruns).toEqual([30]);
    expect(status).toBe(0);
  });

  it('waits for a run still in progress, then re-runs it', async () => {
    fake.runs = [{ id: 30, status: 'completed' }];
    fake.busyPolls = 2;
    const { status } = await run('rerun.mjs', commentEvent(`Gate review 001-T9: PASS @ ${head}`));
    expect(fake.reruns).toEqual([30]);
    expect(status).toBe(0);
  });

  it('re-runs when an edit removes a verdict line', async () => {
    fake.runs = [{ id: 30, status: 'completed' }];
    const event = commentEvent('withdrawn', {
      action: 'edited',
      changes: { body: { from: `Gate review 001-T9: PASS @ ${head}` } },
    });
    const { status } = await run('rerun.mjs', event);
    expect(fake.reruns).toEqual([30]);
    expect(status).toBe(0);
  });

  it('does nothing for an ordinary comment or an issue', async () => {
    fake.runs = [{ id: 30, status: 'completed' }];
    expect((await run('rerun.mjs', commentEvent('LGTM'))).status).toBe(0);
    const onIssue = { ...commentEvent(`Gate review 001-T9: PASS @ ${head}`), issue: { number: 7 } };
    expect((await run('rerun.mjs', onIssue)).status).toBe(0);
    expect(fake.reruns).toEqual([]);
  });

  it('does nothing when the head has no gate-review run yet', async () => {
    const { status, output } = await run(
      'rerun.mjs',
      commentEvent(`Gate review 001-T9: PASS @ ${head}`),
    );
    expect(output).toMatch(/no gate-review run/);
    expect(fake.reruns).toEqual([]);
    expect(status).toBe(0);
  });
});
