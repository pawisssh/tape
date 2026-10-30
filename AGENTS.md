# Agent notes

## Repository scope

This repo is `pawisssh/tape`, a fork of `vivek-nexus/transcriptonic` (the `upstream` remote). All GitHub work — PRs, issues, comments, pushes — targets `pawisssh/tape` and the `origin` remote only.

- Pass `--repo pawisssh/tape` to every `gh` command that creates or changes something (`gh pr create`, `gh issue create`, `gh pr comment`, ...). Without it, `gh` can resolve to the upstream parent and open the PR there.
- `upstream` is read-only: fetch from it if asked, never push, open PRs or issues, or comment on `vivek-nexus/transcriptonic`.
- Auto-fix / CI events about a `vivek-nexus/transcriptonic` PR are a mistake to report to the user, not work to do — never merge upstream `main` into a branch to clear its conflicts.
