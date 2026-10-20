# 0022 - The transcript previews every image the agent read

Status: accepted

## Context

A **Read image** chip in the transcript previews its image on hover and opens it in the gallery.
`repositories.read-workstream-image` served only files inside the workstream's worktree, so the renderer marked every other path unpreviewable and drew no hover card at all.
The user reported that some image chips cannot be hovered, and suspected images from background agents.
In the live database 809 of about 2,860 agent image reads were scratch files under `/tmp`, and others sat on the Desktop or in a background agent's own worktree under `.claude/worktrees/agent-*`.
The renderer also stripped any `workstreams/<id>/` or `worktrees/<name>/` prefix, so an image from another worktree was read at the same relative path in this one: a missing file, or the wrong image.
The renderer is sandboxed (0002), so the main process must not read whatever path it names.

## Decision

- A **Read image** chip addresses its image by the path the agent read: relative when it lies under `/workstreams/<this workstream id>/`, absolute otherwise (`tool-image-read.ts`).
- `repositories.read-workstream-image` still confines a relative path, or an absolute one inside the worktree, to the worktree, refusing symlinks out of it (`images.ts`).
- An absolute path outside the worktree is read only when `agentHasReadFile` finds a `tool.started` event of Claude Code's `Read` tool with that exact `file_path` in one of the workstream's own chats (`src/lib/chat/platform/events.repository.ts`).
- Such a file still gets the same checks as one in the worktree: no symlink as the last component, at most `MAX_PREVIEW_BYTES`, and PNG, JPEG, GIF or WebP bytes.

## Consequences

- The renderer can read an image outside the worktree only when that workstream's agent already read it, and never another file type.
- Markdown images take the same path, so `![](/tmp/shot.png)` shows when the agent read `/tmp/shot.png`; the agent instructions still ask for worktree paths, which always show.
- A scratch image that is deleted later answers `missing`, as a deleted worktree file does.
- Enforced by `images.test.ts` and `runs-events.repository.test.ts` in the platform, `tool-image-read.test.ts` and `transcript-gallery.test.ts` in the renderer, and `tests/e2e/image-gallery.spec.ts`, which hovers and opens an image read outside the worktree.
