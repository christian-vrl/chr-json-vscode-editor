// The `gate-review` check (001 T9, AGENTS.md rule 2, spec 001 criterion 4). Runs in
// .github/workflows/gate-review.yml on pull_request: passes only when a collaborator with write
// access commented `Gate review <NNN>-<Tn>: PASS @ <sha>` for this run's head commit (rules in
// verdict.mjs). gate-review-rerun.yml re-runs it when a verdict comment is posted, edited or deleted.
//
// Exit codes: 0 PASS · 1 no counting PASS · 2 API or setup error.
import { ApiError, context, runMain, summary } from './github.mjs';
import { decide, parseVerdict } from './verdict.mjs';

const WRITE = new Set(['admin', 'maintain', 'write']);

runMain(async () => {
  const { event, request } = context();
  const number = event.pull_request?.number;
  const headSha = event.pull_request?.head?.sha;
  if (!number || !headSha) throw new Error('error: not a pull_request event');

  // The title is read fresh: a re-run replays the original event, but a renamed PR names its task now.
  const pr = await request(`GET /pulls/${number}`);

  const comments = [];
  for (let page = 1; ; page++) {
    const batch = await request(`GET /issues/${number}/comments`, { per_page: 100, page });
    for (const c of batch) comments.push({ author: c.user.login, body: c.body, url: c.html_url });
    if (batch.length < 100) break;
  }

  const writers = new Set();
  const authors = new Set(comments.filter((c) => parseVerdict(c.body)).map((c) => c.author));
  for (const author of authors) {
    try {
      const { permission } = await request(
        `GET /collaborators/${encodeURIComponent(author)}/permission`,
      );
      if (WRITE.has(permission)) writers.add(author);
    } catch (error) {
      // 404: not a collaborator. Anything else is a real failure.
      if (!(error instanceof ApiError && error.status === 404)) throw error;
    }
  }

  const decision = decide({ headSha, title: pr.title, comments, writers });
  for (const { url, why } of decision.ignored) console.log(`ignored ${url}: ${why}`);
  const verdict = decision.pass ? 'PASS' : 'FAIL';
  const where = decision.decisive ? ` (${decision.decisive.url})` : '';
  console.log(`gate-review: ${verdict} (${decision.reason})${where}`);
  summary(`**gate-review: ${verdict}** (${decision.reason})${where}`);
  if (!decision.pass) {
    console.log(
      `A Reviewer who did not author this PR posts "Gate review <NNN>-<Tn>: PASS @ ${headSha}" ` +
        '(skills/gate-review); the check re-runs on its own.',
    );
  }
  return decision.pass ? 0 : 1;
});
