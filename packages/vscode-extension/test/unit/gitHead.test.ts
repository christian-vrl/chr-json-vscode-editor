// Unit checks for 007 T2's HEAD reader outcomes against a fake Git API. The e2e suite (gitHead.cjs)
// checks the same against VS Code's real Git extension and a temporary repository.
import { describe, expect, it } from 'vitest';
import { headMessage, readHead, type HeadGit, type HeadRepository } from '../../src/gitHead';

const BYTES = new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]);

function repository(buffer: HeadRepository['buffer']): HeadRepository & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    buffer(ref, file) {
      calls.push([ref, file]);
      return buffer(ref, file);
    },
  };
}

function git(open: HeadRepository | null, opened: HeadRepository | null = null) {
  const log: string[] = [];
  const api: HeadGit = {
    getRepository(file) {
      log.push(`get ${file}`);
      return open;
    },
    openRepository(folder) {
      log.push(`open ${folder}`);
      return Promise.resolve(opened);
    },
  };
  return { api, log };
}

describe('readHead', () => {
  it('returns the committed bytes from a repository already open', async () => {
    const repo = repository(() => Promise.resolve(BYTES));
    const { api, log } = git(repo);
    expect(await readHead(api, '/r/a.json', '/r')).toEqual({ kind: 'head', bytes: BYTES });
    expect(repo.calls).toEqual([['HEAD', '/r/a.json']]);
    expect(log).toEqual(['get /r/a.json']);
  });

  it('opens the repository of the file’s folder when none is open', async () => {
    const repo = repository(() => Promise.resolve(BYTES));
    const { api, log } = git(null, repo);
    expect(await readHead(api, '/r/sub/a.json', '/r/sub')).toEqual({ kind: 'head', bytes: BYTES });
    expect(log).toEqual(['get /r/sub/a.json', 'open /r/sub']);
  });

  it('reports a file git show cannot find in HEAD as not in HEAD', async () => {
    const repo = repository(() => Promise.reject(new Error('Could not show object.')));
    expect(await readHead(git(repo).api, '/r/new.json', '/r')).toEqual({ kind: 'not-in-head' });
  });

  it('reports no repository when none contains the folder', async () => {
    expect(await readHead(git(null, null).api, '/tmp/a.json', '/tmp')).toEqual({
      kind: 'no-repository',
    });
  });

  it('reports a document with no file path as outside a repository, even without Git', async () => {
    expect(await readHead(undefined, undefined, undefined)).toEqual({ kind: 'no-repository' });
  });

  it('reports a missing or disabled Git extension', async () => {
    expect(await readHead(undefined, '/r/a.json', '/r')).toEqual({ kind: 'git-unavailable' });
  });
});

describe('headMessage', () => {
  it('words criterion 5’s two messages and none when HEAD was read', () => {
    expect(headMessage('a.json', { kind: 'not-in-head' })).toBe('a.json is not in Git HEAD');
    expect(headMessage('a.json', { kind: 'no-repository' })).toBe(
      'a.json is not in a Git repository',
    );
    expect(headMessage('a.json', { kind: 'head', bytes: BYTES })).toBeUndefined();
    expect(headMessage('a.json', { kind: 'git-unavailable' })).toContain('Git extension');
  });
});
