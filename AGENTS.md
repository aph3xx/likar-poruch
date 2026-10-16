# Лікар Поруч agent rules

These rules apply to every human or agent working in this repository, including isolated Git worktrees and Hermes Kanban tasks.

## Product and production

- «Лікар Поруч» is a private medical center, not an aggregator or marketplace.
- Production is the Tailscale-only site at `https://sur.kyiv.ua/likar-poruch/`.
- Caddy serves production from `/home/sgdt1a/.local/share/likar-poruch-site`.
- GitHub repository of record is `git@github.com:aph3xx/likar-poruch.git`.
- GitHub Pages is not the production deployment target.

## Definition of done

A code or design task is not complete merely because it passes in a worktree. All of the following must be true:

1. The intended changes are committed with a Conventional Commit.
2. The commit exists on `aph3xx/likar-poruch`, either on the task branch for review or on `main` after integration.
3. The exact commit intended for release is integrated into `main`. Never deploy an uncommitted diff or an unmerged task branch.
4. Required gates pass on that exact commit:
   - `npm run check`
   - `npm test`
   - `npm run build`
   - `npm audit --omit=dev`
   - `git diff --check`
   - `npm run qa:browser` for user-interface changes
5. `origin/main` contains the release commit.
6. The exact `main` commit is deployed to SUR with `npm run deploy:sur`.
7. The live Tailscale URL is verified after deployment, including page identity, important routes, changed interactions, asset loading, and absence of console/layout regressions.
8. The completion report names the commit SHA, push target, deployed URL, and live verification evidence.

If any item is missing, report the task as incomplete or blocked. Never say “done,” “deployed,” or “implemented” based only on a staged diff, local build, preview server, screenshot, or frozen worktree snapshot.

## Worktree and Git safety

- Use one isolated Git worktree and one branch per implementation task.
- Never assign multiple editing tasks to the same worktree.
- Reviewers are read-only and must not restore, rewrite, stage, or mutate an implementation worktree.
- Before editing, record `git status --short --branch`, the current branch, and `git rev-parse HEAD`.
- Before completion, require a clean worktree. Untracked, unstaged, or staged-but-uncommitted production changes are a hard failure.
- Push task branches before handoff so work cannot exist only on this server.
- Integrate deliberately into `main`; do not silently overwrite unrelated concurrent work.
- Use the repository-local identity `Aphex <aph3xx@users.noreply.github.com>` and Conventional Commits.
- Never push Aphex-created work to `sgoridotla1`; use only the `aph3xx/likar-poruch` repository.

## SUR deployment rules

- Deploy only from a clean `main` checkout whose `HEAD` equals `origin/main`.
- Build with `PUBLIC_SITE_URL=https://sur.kyiv.ua` so canonical, Open Graph, JSON-LD, robots, RSS, and sitemap URLs match production.
- Use `npm run deploy:sur`; do not manually copy selected files.
- Deployment must publish the complete `dist/` artifact atomically to `/home/sgdt1a/.local/share/likar-poruch-site` and record the released commit.
- Verify through the real gateway after publication. A localhost Astro preview is not production evidence.
- Keep `sur.kyiv.ua` private and do not modify DNS, Tailscale, Caddy, mail, or unrelated hub routes for an ordinary site release.

## Contact data and redaction

- The approved clinic phone must remain a real dialable E.164 value in source and runtime `tel:` targets.
- Hermes may redact phone digits as asterisks in displayed tool output. Never infer source corruption from rendered output.
- Validate phone data programmatically using shape and exact equality without printing the raw number. Check that it is 13 characters, begins with `+`, contains digits after the plus, and has no asterisks.

## Verification discipline

- Run checks against the exact commit being handed off or deployed.
- For browser QA, verify the server belongs to the intended worktree and port before trusting results.
- For production QA, verify `https://sur.kyiv.ua/likar-poruch/`, not GitHub Pages.
- A task that changes visible design must include before/after live evidence or a deterministic DOM/style assertion proving production changed.
- Do not block for “human review” after implementation unless the user explicitly requested an approval gate. Route normal code through reviewer tasks, then integrate and deploy when green.
