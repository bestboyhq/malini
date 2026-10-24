# 0070 - Chats keep the images they showed

Status: accepted

## Context

0051 told agents to delete a prototype once the user picked one, and agents read that, with 0045's rule that `.context` holds only what they show, as leave to clean `.context` up.
The live database held 402 agent shell commands that removed or moved something under `.context`, among them screenshots the chat had shown, such as `rm .context/zoom-changed-word.png`.
Across the chats of active workstreams, 18 images the agent had read were gone from disk; in archived ones, 254 embedded `.context` images were gone, and so were 206 embedded `browser_screenshot` captures, because archiving keeps `.context` but not `.malini/sandbox`.
The gallery then shows "This file no longer exists", and the user called that a pretty bad experience.
The user also felt that Malini cleans up too eagerly, and left aging old chats out, such as moving chats older than 30 days to storage, for the future.

## Decision

- When a `chat:agent-event` shows an image or a recording, Malini keeps its own copy of the file (`src/lib/shared/repositories/platform/image-protocol.ts`).
  Shown means a `Read` of a `.png`, `.jpg`, `.jpeg`, `.gif` or `.webp` file, or a markdown image of those or of an `.mp4`, `.m4v`, `.mov` or `.webm` file in an `assistant.message`, outside code (`shownMediaPaths` in `src/lib/chat/platform/events.repository.ts`).
- The copy lives at `workstreams/.kept/<workstream id>/shown/<sha256 of the path>` in the app data folder, cloned with `COPYFILE_FICLONE` and renamed into place (`keepShownFile` in `kept-folders.ts`); a link is never copied.
  The path is the worktree-relative path, or the absolute path of a file outside the worktree that the agent read.
  A later event that shows the same path replaces the copy.
- `malini-image://` and `repositories.read-workstream-image` resolve through one function, `workstreamMedia`: the worktree file while it exists, otherwise the kept copy, otherwise missing.
  0022's path checks still run first, so a kept copy answers only a path the live file would have.
- The copies go with their workstream: archiving and restoring keep them, and deleting the workstream, or the startup sweep of a workstream that no longer exists, removes them with the rest of `.kept/<workstream id>`.
- The agent instructions (`packages/agent-bridge/src/claude/instructions.ts`) keep 0051's prototype rule without its last step: variants, mock-ups and every other prototype live only under `.context/`, never in tracked source, and a picked one is built into the real code path on real data, replacing what it supersedes; the prototype stays.
- They also ask for a new name for every capture, forbid deleting, moving or overwriting a file under `.context/`, and send scratch work such as builds, logs and repository copies to a `mktemp -d` folder outside the worktree.
  `.agents/rules/agent-behavior.mdc` says the same for this repository.

## Consequences

- A picture stays in its chat and gallery after the agent deletes it, moves it or archives the workstream; only images shown before this change can still go missing.
- The live file wins while it exists, so an overwritten file shows its newest pixels in older turns too; the instructions' new-name rule is what keeps older turns right.
- Copies cost no space on APFS until the original changes or goes, and nothing ages them out yet: a workstream's copies last until it is deleted, as the `ponytail:` note in `kept-folders.ts` says.
- Enforced by `image-protocol.test.ts` (keeping, the fallback, links, restore and delete), `runs-events.repository.test.ts` (which events show what), `instructions.test.ts` (the instruction text) and `tests/e2e/image-gallery.spec.ts`, which deletes what the agent showed and opens both pictures in the gallery.
