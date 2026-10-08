// Re-runs the `gate-review` check when a verdict comment changes (001 T9). Runs in
// .github/workflows/gate-review-rerun.yml on issue_comment, which GitHub attaches to the default
// branch, not to the PR head; so instead of judging here, it re-runs the latest gate-review.yml run
// for the PR's head commit, whose check is the one the PR shows. A run still in progress is waited
// for, since GitHub refuses to re-run it.
//
// Exit codes: 0 re-run requested or nothing to do · 2 API or setup error, or the wait timed out.
import { context, runMain } from './github.mjs';
import { parseVerdict } from './verdict.mjs';

const POLL_MS = Number(process.env.GATE_REVIEW_POLL_MS ?? 10_000);
const MAX_POLLS = 60;

runMain(async () => {
  const { event, request } = context();
  if (!event.issue?.pull_request) {
    console.log('not a pull request comment; nothing to do');
    return 0;
  }
  // An edit or deletion matters when either the old or the new body was a verdict.
  if (!parseVerdict(event.comment?.body) && !parseVerdict(event.changes?.body?.from)) {
    console.log('not a gate review verdict; nothing to do');
    return 0;
  }

  const pr = await request(`GET /pulls/${event.issue.number}`);
  const headSha = pr.head.sha;
  for (let poll = 0; poll < MAX_POLLS; poll++) {
    const { workflow_runs: runs } = await request('GET /actions/workflows/gate-review.yml/runs', {
      event: 'pull_request',
      head_sha: headSha,
      per_page: 1,
    });
    const latest = runs[0];
    if (!latest) {
      console.log(`no gate-review run for ${headSha} yet; the next one will read this comment`);
      return 0;
    }
    if (latest.status === 'completed') {
      await request(`POST /actions/runs/${latest.id}/rerun`);
      console.log(`re-running gate-review run ${latest.id} for ${headSha}`);
      return 0;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`error: gate-review run for ${headSha} did not finish in time`);
});
