// Binds the HEAD reader (gitHead.ts) to VS Code's built-in Git extension (`vscode.git`), per UNK-038.
// The types below are the subset of the extension's published API this file calls, copied from
// VS Code's `extensions/git/src/api/git.d.ts` (`GitExtension.enabled`, `getAPI(1)`, `API.state`,
// `onDidChangeState`, `getRepository`, `openRepository`, `Repository.buffer`). `buffer` is used, not
// `show`: `show` decodes the bytes with the `files.encoding` setting (dropping a UTF-8 BOM), and the
// reader must return the committed bytes unchanged (007 T2 gate).
import * as path from 'node:path';
import * as vscode from 'vscode';
import { readHead, type HeadGit, type HeadRepository, type HeadResult } from '../gitHead';

interface GitRepository {
  buffer(ref: string, path: string): Promise<Uint8Array>;
}

interface GitApi {
  readonly state: 'uninitialized' | 'initialized';
  readonly onDidChangeState: vscode.Event<'uninitialized' | 'initialized'>;
  getRepository(uri: vscode.Uri): GitRepository | null;
  openRepository(root: vscode.Uri): Promise<GitRepository | null>;
}

interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): GitApi;
}

const GIT_EXTENSION_ID = 'vscode.git';
/** How long to wait for the Git extension's first repository scan before using it anyway. */
const INITIALIZE_TIMEOUT_MS = 5000;

function headRepository(repository: GitRepository | null): HeadRepository | null {
  return repository && { buffer: (ref, file) => repository.buffer(ref, file) };
}

async function initialized(api: GitApi): Promise<void> {
  if (api.state === 'initialized') return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, INITIALIZE_TIMEOUT_MS);
    const listener = api.onDidChangeState((state) => {
      if (state === 'initialized') done();
    });
    function done(): void {
      clearTimeout(timer);
      listener.dispose();
      resolve();
    }
  });
}

/** The Git extension's API, or undefined when the extension is missing or disabled. */
async function gitApi(): Promise<GitApi | undefined> {
  const extension = vscode.extensions.getExtension<GitExtension>(GIT_EXTENSION_ID);
  if (!extension) return undefined;
  const exports = extension.isActive ? extension.exports : await extension.activate();
  if (!exports?.enabled) return undefined;
  const api = exports.getAPI(1);
  await initialized(api);
  return api;
}

/** Reads `uri`'s bytes at HEAD from its local Git repository (spec 007 criterion 5). */
export async function readHeadOf(uri: vscode.Uri): Promise<HeadResult> {
  if (uri.scheme !== 'file') return readHead(undefined, undefined, undefined);
  const api = await gitApi();
  const git: HeadGit | undefined = api && {
    getRepository: (file) => headRepository(api.getRepository(vscode.Uri.file(file))),
    openRepository: async (folder) =>
      headRepository(await api.openRepository(vscode.Uri.file(folder))),
  };
  return readHead(git, uri.fsPath, path.dirname(uri.fsPath));
}
