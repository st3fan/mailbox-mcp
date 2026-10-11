# AGENTS.md

Guidance for AI agents (and humans) working in this repository.

## Project overview

- **Language:** Go. All new code is written in Go and follows standard Go conventions
  (`gofmt` formatting, idiomatic package layout, table-driven tests).
- **Packaging:** The project is packaged with Docker. Changes that affect how the binary
  builds or runs must keep the Dockerfile working.

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

- Build and test before submitting a PR:

  ```bash
  go build ./...
  go test ./...
  go vet ./...
  gofmt -l .
  ```

  All four must be clean; `gofmt -l .` prints files that are not formatted (empty
  output means clean).

- If you touch the Dockerfile or anything the image depends on, build the image to
  verify it still works before requesting review.