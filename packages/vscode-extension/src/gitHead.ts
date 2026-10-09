// Reads a file's committed (Git HEAD) bytes for "Compare with HEAD" (spec 007 T2, criterion 5).
// UNK-038 picked VS Code's built-in Git extension API over running `git` ourselves; both are local,
// so nothing here touches the network. This file is free of `vscode` so the outcomes are unit-tested;
// gitHeadVscode.ts binds it to the Git extension.

/** What reading HEAD found for one file. */
export type HeadResult =
  /** The file's bytes in HEAD, exactly as committed. */
  | { kind: 'head'; bytes: Uint8Array }
  /** The file is in a Git repository but not in HEAD: untracked, ignored, or no commit yet. */
  | { kind: 'not-in-head' }
  /** No Git repository contains the file (or it is not a file on disk, e.g. untitled). */
  | { kind: 'no-repository' }
  /** VS Code's Git extension is disabled or missing (`git.enabled: false`, no `git` found). */
  | { kind: 'git-unavailable' };

/** The part of a Git extension `Repository` the reader uses. */
export interface HeadRepository {
  /** `git show HEAD:<path>` as raw bytes; rejects when the object does not exist. */
  buffer(ref: string, absolutePath: string): Promise<Uint8Array>;
}

/** The part of the Git extension API the reader uses, with paths instead of `Uri`s. */
export interface HeadGit {
  /** The repository already open in VS Code that contains `absolutePath`, if any. */
  getRepository(absolutePath: string): HeadRepository | null;
  /** Opens the repository containing the folder `absolutePath`; null when there is none. */
  openRepository(absoluteFolder: string): Promise<HeadRepository | null>;
}

/**
 * Reads `absolutePath` at HEAD. `git` is undefined when the Git extension is unavailable; `folder`
 * is the file's parent folder. A repository that is not open in VS Code yet is opened, which shows
 * it in the Source Control view as opening any file in it would.
 */
export async function readHead(
  git: HeadGit | undefined,
  absolutePath: string | undefined,
  folder: string | undefined,
): Promise<HeadResult> {
  if (absolutePath === undefined || folder === undefined) return { kind: 'no-repository' };
  if (!git) return { kind: 'git-unavailable' };
  const repository = git.getRepository(absolutePath) ?? (await git.openRepository(folder));
  if (!repository) return { kind: 'no-repository' };
  try {
    return { kind: 'head', bytes: await repository.buffer('HEAD', absolutePath) };
  } catch {
    // The Git extension rejects without git's stderr except for one code ("exists on disk, but not
    // in 'HEAD'" → WrongCase), so every failure of `git show HEAD:<path>` in a repository that opened
    // reads as "not in HEAD": an untracked or ignored file, a file deleted from HEAD, or no commit.
    return { kind: 'not-in-head' };
  }
}

/** The message shown instead of a compare panel (criterion 5), or undefined when HEAD was read. */
export function headMessage(name: string, result: HeadResult): string | undefined {
  switch (result.kind) {
    case 'head':
      return undefined;
    case 'not-in-head':
      return `${name} is not in Git HEAD`;
    case 'no-repository':
      return `${name} is not in a Git repository`;
    case 'git-unavailable':
      return `Cannot read ${name} from Git HEAD: the built-in Git extension is disabled`;
  }
}
