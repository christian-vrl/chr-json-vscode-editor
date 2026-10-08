// Gate-review verdict rules (001 T9, AGENTS.md rule 2, spec 001 criterion 4).
//
// A Reviewer signs a PR with a comment whose first line is exactly
// `Gate review <NNN>-<Tn>: PASS @ <head sha>` (or `FAIL`), per skills/gate-review. A comment counts
// for a head commit when its SHA (7 to 40 hex characters) is a prefix of that commit's SHA, its
// author has write access, and its task matches the `<NNN>-<Tn>` the PR title starts with (any task
// when the title names none). The latest counting comment decides, so a later FAIL withdraws a PASS.

const VERDICT_LINE = /^Gate review (\d{3}-T\d+): (PASS|FAIL) @ ([0-9a-fA-F]{7,40})[ \t]*$/;
const TITLE_TASK = /^(\d{3}-T\d+)\b/;

/** @param {string | null | undefined} body */
export function parseVerdict(body) {
  const first = (body ?? '').split(/\r?\n/, 1)[0] ?? '';
  const match = VERDICT_LINE.exec(first);
  if (!match) return null;
  const [, task = '', verdict, sha = ''] = match;
  return { task, pass: verdict === 'PASS', sha: sha.toLowerCase() };
}

/** @param {string} title */
export function taskFromTitle(title) {
  return TITLE_TASK.exec(title)?.[1] ?? null;
}

/**
 * @param {{
 *   headSha: string,
 *   title: string,
 *   comments: readonly { author: string, body: string, url: string }[],
 *   writers: ReadonlySet<string>,
 * }} input
 */
export function decide({ headSha, title, comments, writers }) {
  const head = headSha.toLowerCase();
  const short = head.slice(0, 12);
  const titleTask = taskFromTitle(title);
  /** @type {{ url: string, why: string }[]} */
  const ignored = [];
  let decisive;
  let decisivePass = false;

  for (const comment of comments) {
    const verdict = parseVerdict(comment.body);
    if (!verdict) continue;
    let why;
    if (!head.startsWith(verdict.sha)) why = `for ${verdict.sha}, not the head ${short}`;
    else if (!writers.has(comment.author)) why = `${comment.author} has no write access`;
    else if (titleTask && verdict.task !== titleTask) {
      why = `for task ${verdict.task}, but the PR title names ${titleTask}`;
    }
    if (why) {
      ignored.push({ url: comment.url, why });
      continue;
    }
    decisive = comment;
    decisivePass = verdict.pass;
  }

  if (!decisive) {
    return {
      pass: false,
      reason: `no counting "Gate review …: PASS @ <sha>" comment for ${short}`,
      ignored,
    };
  }
  return {
    pass: decisivePass,
    reason: decisivePass
      ? `signed for ${short} by ${decisive.author}`
      : `the latest verdict for ${short} is FAIL (by ${decisive.author})`,
    decisive,
    ignored,
  };
}
