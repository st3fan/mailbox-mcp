# AGENTS.md

Guidance for AI agents (and humans) working in this repository.

## Project overview

- **Language:** TypeScript on Cloudflare Workers. The project is two Workers
  — `workers/mcp` (the MCP endpoint + message storage) and
  `workers/email-worker` (mail ingestion into R2) — each with its own
  package, vitest tests, and `tsc` type checking. Follow the style of the
  existing worker code; there is no Go in this repository anymore.
- **Packaging:** Workers deploy with `wrangler deploy` per worker directory.
  Configuration lives in wrangler vars and secrets, not environment files.

## Planning work

- Work is planned in **GitHub issues**. Before starting any non-trivial piece of work,
  make sure there is an issue describing it; create one if it does not exist yet.
- For larger work split into a stack, file **one issue per layer** with a *What* section
  and *Done when* acceptance criteria, so each PR can be reviewed against them.
- Reference the issue in commit messages and pull requests (for example `Fixes #12`).
- Write multi-line issue and PR bodies to a file and pass it with `--body-file`; inline
  `\n` sequences in quoted strings do not become newlines and produce mangled markdown.

## Doing work

- All work lands via **pull requests**. Never push directly to the default branch.
- Never open pull requests as **drafts**. PRs are ready for review when submitted.
- **Small work** (a single focused change that is easy to review as one diff) can be a
  **single pull request** on one branch.
- **Larger work** should be split into a **stack of pull requests**: an ordered chain of
  branches where each PR contains one layer of the work and is based on the branch below
  it. Foundational changes go at the bottom of the stack; code that depends on them goes
  above.
- When a task warrants a stack, create the stack **before writing code** — decide the
  layers first, then commit into them. Do not write everything on one branch and try to
  split it afterwards.
- Use the installed `gh-stack` skill to create, navigate, submit, and merge stacks.
  See `.agents/skills/gh-stack/SKILL.md` for the exact commands and its
  `references/` docs for stack design, command details, and troubleshooting.
- Build stacks **bottom-up, one layer at a time**. After committing to a layer, run
  `gh stack rebase` so the layers above it pick up the commit; a child branch checked
  out with `gh stack up` before rebasing does **not** contain the layer below's commits.
- Push and submit with `gh stack push` and `gh stack submit --auto` once the stack is
  ready for review, then rewrite the auto-generated PR bodies with `gh pr edit`. Note
  that `--auto` opens the PRs as drafts; mark them ready with `gh pr ready`.
- Merge stacks with **squash**: `gh stack merge <target> --yes --squash` (never plain
  `gh pr merge`, which cannot merge a stack). Squash keeps one commit per PR as it
  lands on the default branch.
- Prefer branch names of the form `<topic>/<concern>` (for example `server/config`).
- One stack tells one story: keep unrelated work in separate stacks.

## Verifying changes

- Test and type-check before submitting a PR, for every worker you touched:
  ```bash
  cd workers/mcp && npm test && npm run typecheck
  cd workers/email-worker && npm test && npm run typecheck
  ```
  Both must be clean. When a change affects a deployed worker, deploy it to
  verify before requesting review.
- Work is planned in GitHub issues and lands via PRs, preferably as stacks
  (see below); reference the issue in commits and pull requests.