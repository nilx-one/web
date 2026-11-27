# AGENTS.md

Instructions for every coding agent working in this repository (Claude Code,
OpenAI Codex and others). This file is the single source of agent instructions.
Do not add a `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md`: Claude Code
reads `AGENTS.md` only when none of those exist.

This file and the scripts listed in `scripts/check-shared-sync.rb` are shared
across aiaiaiai-org repositories. Everything outside `After authorization, deploy the already verified revision or artifact, perform
the environment transition, activate the release, and verify minimal
post-deploy health.

Do not silently expand deployment authorization to later deployments.

### Engineering behavior

Inspect before modifying.

Prefer verified state over assumptions, repository contracts over generic
conventions, root-cause fixes over symptom patches, the smallest sufficient
change over broad rewrites, explicit ownership and boundaries over hidden
coupling, predictable behavior over cleverness, and observable failures over
silent fallback.

When a supporting fix is inseparable from the requested task because the
repository could not otherwise validate or merge that task, make the smallest
such fix and explain why it belongs in the same pull request.

Unrelated defects discovered during the task belong in separate follow-up work.

### Tool behavior

Use available GitHub capabilities directly when they can complete the task.
Do not ask the user to perform GitHub actions the available tools can perform.

Prefer batched independent reads and precise writes. Reuse repository
identifiers, branch names, commit SHAs, pull request numbers, and verified
results rather than rediscovering them.

Inspect detailed CI logs only for failed or ambiguous checks. Do not poll state
that cannot yet have changed.

Never report repository state, successful writes, merges, CI results, or
deployment results without evidence from the corresponding operation.

<!-- project-specific -->

### Web repository attribution checks

The canonical agent identity and merge rules above take precedence over older generic workflow rules. Retain the following local attribution constraints for this repository:

Commit as the GitHub account that actually did the work, identified by its
account ID:

| GitHub account | Account ID | Git author (ID-based noreply)               |
| -------------- | ---------- | ------------------------------------------- |
| `0x0sky`       | 75973992   | `75973992+0x0sky@users.noreply.github.com`  |
| `x0skai`       | 300452669  | `300452669+x0skai@users.noreply.github.com` |

AI-tool co-authorship is separate from GitHub account credit. Credit only
substantive work incorporated into the exact commit:

- `Co-authored-by: Codex <codex@openai.com>` when OpenAI Codex contributed.
- `Co-authored-by: Claude <noreply@anthropic.com>` when Claude contributed.

`Assisted-by: OpenAI Codex` does **not** produce GitHub co-authorship and must
not replace the Codex `Co-authored-by` trailer. In particular, a commit authored
by `0x0sky` with genuine Codex changes must contain the Codex trailer in the
**commit message**, not only in a pull request description. Do not add tool
co-authors when that tool did not contribute to the commit.

Rules:

- Add the other account as `Co-authored-by: <login> <<ID>+<login>@users.noreply.github.com>`
  only when it contributed code, tests, documentation or an incorporated patch
  to that exact commit. A review, approval, prompt or account ownership alone
  does not qualify.
- Solo authorship is normal. A commit with no real second contributor has no
  account co-author. Do not add one for an achievement or to satisfy a check.
- Never add the primary author as its own co-author, and never duplicate a
  trailer.
- Put trailers in the final paragraph of the commit message, one per line.
- Never label a commit as an unknown author to avoid this rule. If the connected
  GitHub API cannot author as the correct account, commit from a shell with the
  correct repository-local identity. If no such shell exists, state the
  limitation in the PR and do not claim the attribution.
- The commit-attribution check validates identities, trailer format, and
  duplicate or self credit. It cannot prove that a contribution happened; the
  author and reviewers establish that.
- Before merge, inspect the pushed commits: author account ID, trailers and
  co-author IDs. A comment, review or PR body is not a substitute.
- For squash merges, prepare the final message explicitly from verified source
  contributions. Preserve genuine Codex/Claude co-authors; never repeat the
  resulting squash commit's primary author as a co-author. Verify the actual
  merged commit author and trailers afterwards: GitHub does not necessarily
  preserve source commit messages. A PR body or review does not count.
- Do not manufacture commits, rewrite merged history, or change merge methods to
  create credit. Signature verification and achievement status are reported
  separately.

<!-- /project-specific -->

### Reporting

Report outcomes, not tool choreography.

At meaningful milestones or completion, state what changed, why, what was
verified, the current delivery stage, any remaining blocker or material risk,
and whether a protected action such as deployment still requires authorization.

Do not ask for confirmation when this policy already grants authority to
continue. Identity-use authorization is single-use by default; durable
permission requires explicit scope and duration. Obtain explicit authorization
for merge and deploy. If blocked, report the exact state reached.

<!-- © 2026 aiaiaiai · aiaiaiai.org -->
