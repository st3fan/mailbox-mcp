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
- Reference the issue in commit messages and pull requests (for example `Fixes #12`).

## Doing work

- All work lands via **pull requests**. Never push directly to the default branch.
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
- Prefer branch names of the form `<topic>/<concern>` (for example `server/config`).
- One stack tells one story: keep unrelated work in separate stacks.

## Verifying changes

- Build and test before submitting a PR:

  ```bash
  go build ./...
  go test ./...
  go vet ./...
  ```

- If you touch the Dockerfile or anything the image depends on, build the image to
  verify it still works before requesting review.