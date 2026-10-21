# 0043 - Agent captures live in `.context`

Status: accepted

## Context

Agents saved screenshots and recordings to `/tmp` and embedded those paths, though the instructions already asked for worktree paths (0022).
In one chat of the live database, 582 of the gallery's 792 images lay in `/tmp`; each needs an event scan to be shown (0022), and many were deleted before the gallery opened.
The user asked that agents put workstream images in `.context`, which the Malini repository already ignores and the `test-malini-app` skill writes to.
Other repositories do not ignore `.context`, so a capture there would show as an untracked change and could reach a commit.

## Decision

- The bridge protocol contract names the folder: `agentContextPath: ".context"` in `packages/agent-bridge/protocol/bridge-protocol.json`, generated as `BRIDGE_AGENT_CONTEXT_PATH`.
- The agent instructions (`packages/agent-bridge/src/claude/instructions.ts`) say to save every screenshot, recording or image not taken with `browser_screenshot` under `.context/` in the worktree, never under `/tmp`, and to embed it by that relative path.
- `/.context/` joins `APP_MANAGED_REPOSITORY_EXCLUDES` (`src/main/git/paths.ts`), which Malini writes to the repository's `info/exclude` when it creates a workstream and before it diffs, snapshots, commits or pushes one, without touching the repository's `.gitignore`.
- `.context` is not an app-managed path: Malini still diffs and commits files a repository already tracks there.

## Consequences

- Captures stay with their workstream, load from the worktree with no event scan, and never reach a commit.
- A repository that tracks files under `.context` keeps them; only untracked files there are ignored.
- Enforced by `src/main/git/diff.test.ts` for the exclude rule; nothing tests the instruction text.
