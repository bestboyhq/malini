# 0064 - Agents open files for the user to edit in the File tab

Status: accepted

## Context

The user asked for Malini to "open file that someone should edit", and named the case: "I wanna do it for secrets".
Secrets live in `~/.secrets/<repo>.env`, outside every checkout, and agents must never read or write them (the user's `guard-secrets` hook refuses it), so an agent could only ask in text and the user had to find the file in another editor.
The repository extension's File tab only read worktree files and only showed them.
An external editor was an option, but the user turned down picking one: "We're already rendering files, we can just make them editable, no?"
Extension file access had been worktree-only, and every main-process command is reachable from the renderer, so a command that reads or writes any path would let a compromised renderer read `~/.ssh` or write `~/.zshrc`.
The user records their screen (0020), and an agent can open a secrets file at any moment.

## Decision

- Bridge protocol 38 adds the platform tool `files_open` (`path`, absolute, under `~/` or relative to the worktree, and an optional `line`).
  It is pre-approved, in `PRE_APPROVED_PLATFORM_TOOLS` beside the read tools, and returns only `{ path, created }`, never the file's contents.
  The agent instructions (`packages/agent-bridge/src/claude/instructions.ts`) send agents to it whenever the user has to write something they must not read, and tell them to never ask for a secret in the chat.
- `openFileForUser` in `src/lib/extensions/platform/opened-files.ts`, reached only through `extensions.platform.ts` and never through a command, resolves the path, refuses folders and files inside `.git`, and creates a missing file empty.
  Outside the worktree it creates the file `0600` and new folders `0700`, and records the canonical path in `workstream_opened_files` (migration 61).
  It emits `extensions:file-open-requested` with the workstream, the path (relative inside the worktree, absolute outside it) and the line.
- `extensions.read-workstream-file`, `extensions.write-workstream-file` and `extensions.stat-workstream-file` serve an absolute path only when that workstream has it in `workstream_opened_files`; writes go through symlinks with `atomicReplaceFile`, keeping the file's mode.
- `openRequestedFilesHook` keeps each request in local storage (`malini.requested-files-v1`) until the extension runtime runs for its workstream and `malini.repository.open-file` has run with `pinned: true`; `ExtensionPanelOpenOptions.pinned` opens the document tab kept instead of as the preview.
- The File tab is a CodeMirror 6 editor: Malini's own tokenizer colors it, the branch diff marks added lines, changed words and removed lines as block widgets with their old line numbers, it pins its tab on the first edit, and it autosaves 400 ms after typing stops, on blur and on close.
  The user wants it to "just autosave", so it has no save key and no saved state, and shows a line only when a save fails, which closing the tab also raises as an error notification.
  A change on disk replaces the text only while nothing typed is unsaved.
- `@codemirror/*` versions live in the pnpm catalog, so hyper-ui and the repository extension share one `@codemirror/state`.
- `ExtensionPanelContext.maskPrivateData` carries streamer mode's `sensitiveMasking.on`; while it is on, a file outside the worktree, a `.env`, `.envrc`, `.pem`, `.key`, `.p12` or `.pfx` file, or one under `.secrets` is hidden behind a **Show** button that names it.

## Consequences

- "Put your key in `~/.secrets/<repo>.env`" becomes a tab beside the chat that the user types into, and the agent never sees the value.
- Every file tab edits, so a typo the agent left is fixed in place, and edits land in the worktree a moment after typing stops.
- The renderer can read or write outside the worktree only the files an agent opened in that workstream; the grant outlives restarts and goes with the workstream (`ON DELETE CASCADE`).
- An agent can still open any file the user can read without asking, but only the user sees what it holds.
- A file opened in a workstream that is not in view opens once the user goes there, even after a reload or a restart.
- Typing re-tokenizes the whole file, about 18 ms at 20,000 lines, as the `ponytail:` in `file-tab.ts` says.
- Enforced by `opened-files.test.ts`, `service.test.ts`, `requested-file.test.ts` and `workstream-tabs.test.ts` in the app, `browser-tools.test.ts`, `session.test.ts`, `instructions.test.ts` and `protocol.test.ts` in the bridge, `file-tab.test.ts` in the repository extension, and `tests/e2e/file-editing.spec.ts`, which edits a worktree file, opens a file in a workstream the user is not looking at, fills in a secrets file an agent opened, hides it under streamer mode and reads it again after a restart.
