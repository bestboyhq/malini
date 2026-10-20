# 0014 - Malini ships gh and signs it in from setup

Status: accepted

## Context

ADR 0001 reaches GitHub only through the user's own `gh`, so it assumed every user had installed it and run `gh auth login`.
A user without `gh` could not use Malini: git signs in to GitHub only through `gh auth git-credential` (`GH_CREDENTIAL_HELPER_CONFIG` in `src/main/git/credentials.ts`), so cloning a private repository, fetching a base branch and pushing all failed, and every error told them to run a command they did not have.
Setup checked Claude Code but never GitHub.
GitHub still comes through `gh`; what changes is where `gh` comes from and who signs it in.

## Decision

- Packaged builds carry `gh` at `Resources/vendor/gh/bin/gh`.
  `scripts/fetch-gh.mjs` downloads the pinned `GH_VERSION` for macOS arm64, refuses it unless its sha256 matches `GH_SHA256`, and writes it to `apps/malini/vendor/gh` (gitignored); `pnpm dist`, `release` and `test:update` run it before electron-builder, and `extraResources` copies it.
- At boot, `src/main/index.ts` appends that directory to `PATH` with `withBundledGh`, last, so a user's own `gh` still wins, and Malini's `gh` calls, git's credential helper and the agents' shells all find a `gh`.
- Setup's first step, `accounts`, shows Claude Code and GitHub side by side.
  `GitHubSetup` in `$shared/repositories` signs in with `gh auth login --web --hostname github.com --git-protocol https --skip-ssh-key`, run without a terminal so `gh` prints its one-time code instead of opening a browser.
  `repositories.start-github-sign-in` returns the code, the renderer copies it and opens `https://github.com/login/device`, and `repositories.finish-github-sign-in` resolves when GitHub approves the device.
- The same card sits on the Repositories page, in Settings and in the clone dialog, and every sign-in error points there instead of at `gh auth login`.
- `gh` keeps its login where it always does (`~/.config/gh` and the Keychain), so a `gh` the user installs later shares it.

## Consequences

- A Mac with only git and Claude Code can clone private repositories, push and ship pull requests without a terminal.
- The app grows by the `gh` binary, about 14 MB compressed and 38 MB on disk, and electron-builder signs it with Malini's Developer ID.
- Updating `gh` means changing `GH_VERSION` and `GH_SHA256` together; `scripts/fetch-gh.test.mjs` pins the checksum check.
- The PATH order is pinned by `src/main/process/gh.test.ts`, the device flow by `github-sign-in.service.test.ts`, and setup's sign-in end to end by `tests/e2e/github-sign-in.spec.ts`.
- GitHub shows the sign-in as GitHub CLI, the OAuth app `gh` uses, not as Malini.
