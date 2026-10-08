// Types for verdict.mjs, so TypeScript tests can import the plain-JavaScript check (001 T9).
export interface Verdict {
  /** e.g. `001-T9` */
  task: string;
  pass: boolean;
  /** Lower-case hex, 7 to 40 characters, as written in the comment. */
  sha: string;
}

export interface GateComment {
  author: string;
  body: string;
  url: string;
}

export interface GateDecision {
  pass: boolean;
  /** One line saying why, for the job log. */
  reason: string;
  /** The comment that decided it, when one did. */
  decisive?: GateComment;
  /** Verdict comments that did not count, each with why. */
  ignored: { url: string; why: string }[];
}

/** Parses a comment's first line, `Gate review <NNN>-<Tn>: PASS|FAIL @ <sha>`; null otherwise. */
export function parseVerdict(body: string | null | undefined): Verdict | null;

/** The `<NNN>-<Tn>` a PR title starts with, or null. */
export function taskFromTitle(title: string): string | null;

/**
 * Decides the gate for one head commit. `comments` are in posting order; `writers` holds the
 * logins with write access. The latest counting verdict wins.
 */
export function decide(input: {
  headSha: string;
  title: string;
  comments: readonly GateComment[];
  writers: ReadonlySet<string>;
}): GateDecision;
