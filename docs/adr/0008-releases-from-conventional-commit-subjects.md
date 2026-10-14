# 0008 - Releases come from Conventional Commit subjects

Status: accepted

## Context

malini ships from squash-merged pull requests, often several a day.
Users run a signed app that should update itself without anyone choosing a version number or writing release notes by hand.

## Decision

- Commit subjects and pull request titles are Conventional Commits; a squash merge makes the title the subject.
- Every push to `main` that passes CI runs `apps/malini/scripts/version.mjs`: a breaking change bumps the major, a `feat` the minor, a `fix` or `perf` the patch, and anything else releases nothing.
- CI signs and notarizes the app, proves a signed build updates itself (`test:update`), then publishes it to GitHub Releases with generated notes.
- A packaged build checks GitHub Releases for updates through `electron-updater` every four hours.
  `pnpm dev`, the e2e harness and `pnpm dist` never check.

## Consequences

- The pull request title is the release decision: `feat`, `fix` and `perf` ship, the other types do not.
- The `version` in `package.json` is a placeholder CI overwrites.
- Enforced by `.github/workflows/pr-title.yml`, which checks the title, and by the `release`, `update` and `publish` jobs in `.github/workflows/ci.yml`.
- The pipeline in detail, with its secrets, is in `docs/packaging.md`.
