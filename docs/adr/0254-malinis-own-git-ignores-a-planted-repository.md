# 0254 - Malini's own git ignores a planted repository, and the sandbox protects every git pointer

Status: accepted

## Context

Malini runs git itself, outside the sandbox, on a checkout the sandboxed agent writes to (0167, 0193).
The sandbox already refuses writes to a git folder's `hooks` and `config`, so a command cannot point git at code of its own.
Two holes were left.
A command could write `commondir` or `gitdir` inside the git folder, which redirect git to another git folder, and on macOS the profile protected neither; the Linux rules of 0249 did.
A command could also add a gitlink to the index and put a repository at that path, whose `.git/config` sets `core.fsmonitor`; git runs that value as a command in the child process it starts for the submodule, so Malini's own `git status`, `git diff` or `git add -A` ran it.
Both turn a write Malini allows into code outside the sandbox, which is the one thing the sandbox exists to prevent.

## Decision

`ranOutside` in `packages/agent-bridge/src/sandbox.ts` denies `commondir` and `gitdir` next to `config` and `config.worktree`, under the checkout's git folders and under a folder the user allowed, and denies the checkout's `.git` itself, so a command cannot replace the pointer or the folder.
The same entries were already in the Linux `protectedPaths`, so the two engines now protect the same files, and 0249's Seatbelt profile is no longer byte for byte the one before it.
Seatbelt denies the two pointers whether or not they exist; bubblewrap keeps them read-only only where they exist, which 0249 records.
`spawnGit` in `apps/malini/src/main/git/run.ts` appends `core.fsmonitor=false` to `GIT_CONFIG_COUNT` for every git Malini runs, on top of the existing `GIT_OPTIONAL_LOCKS=0`.
Git gives `GIT_CONFIG_*` the weight of `-c`, and passes it to the child processes it starts for a submodule, so a repository inside the checkout cannot run its own command.
Appending keeps whatever a caller already set, such as the empty `credential.helper`.

## Consequences

Malini loses a file system monitor a user configured for their own repository, inside Malini only, which costs `git status` time on a huge checkout and nothing else.
The sandbox refuses two more writes, which no agent needs: git writes `commondir` and `gitdir` when it creates a worktree, and Malini creates every worktree itself, outside the sandbox.
`core.fsmonitor` is the one config value git runs as a command while reading a repository's state; a nested repository's `filter.*` or `diff.external` still runs when git walks into it, so a later `git diff --submodule` deserves the same look.
Two checks hold the decision: `keeps a repository planted in the checkout from running its own fsmonitor` in `apps/malini/src/main/git/run.test.ts` plants the gitlink, proves the fsmonitor runs for an unguarded git and not for `runGit`, and `keeps a command from writing the git common dir` in `packages/agent-bridge/src/sandbox.test.ts` runs in both the Seatbelt and the bubblewrap block.
