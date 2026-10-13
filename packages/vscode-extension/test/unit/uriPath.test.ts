// src/uriPath.ts (spec 013 T2): the shared host code's file names from `uri.path`, which replaced
// Node's `path.posix` there, give the same results as `path.posix`.
import * as nodePath from 'node:path';
import { describe, expect, it } from 'vitest';
import { basename, dirname, extname } from '../../src/uriPath';

describe('uriPath matches Node’s path.posix', () => {
  const paths = [
    '',
    '/',
    '//',
    'a',
    '/a',
    '/a/',
    '/a//',
    '/a/b.json',
    '/a/b.tar.gz',
    '/a/.hidden',
    '/a/b.',
    '/a/..',
    '/a/...',
    'a/b',
    '/folder with space/x.json5',
    '/c:/Users/me/data.JSONC',
  ];
  for (const path of paths) {
    it(`for ${JSON.stringify(path)}`, () => {
      expect(basename(path)).toBe(nodePath.posix.basename(path));
      expect(extname(path)).toBe(nodePath.posix.extname(path));
      expect(dirname(path)).toBe(nodePath.posix.dirname(path));
    });
  }
});
