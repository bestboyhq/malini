# 0019 - A repository opens on its scratchpad

Status: accepted

## Context

Ideas on different subjects piled up outside Malini, in Obsidian, though each one ends as a workstream.
The user asked for a scratchpad per repository, as the repository's default page, block-based like Notion with TipTap, no background, where any paragraph starts a workstream "whenever you're ready".
Before this, the sidebar's repository name opened its first workstream, or the repository list when it had none, so a repository had no page of its own.
A file in the checkout would differ per branch and land in every workstream's diff, so the ideas belong in Malini's own state.
TipTap 3 already drives the chat composer.

## Decision

- A `scratchpad` domain (`src/lib/scratchpad`) keeps one TipTap document per repository, as TipTap JSON in the `scratchpads` table (migration v48).
  The key is the repository's full name, `COLLATE NOCASE`, so a repository removed and added again, or opened as a local folder, finds the same pad.
- `scratchpad.load` and `scratchpad.save` live in `src/contract/scratchpad.ts`; save accepts only a `doc` object under 4 MB.
  The renderer saves on every change with one write in flight per pad and the newest content queued behind it (`scratchpad-writes.store.ts`); usage data skips both commands.
- `/repositories/:repositoryId` renders `RepositoryPage`; the sidebar's repository name and the repository list's Open button go there.
- The pad has paragraphs, headings 1 to 3, bullet and numbered lists, quotes, code blocks and rules, typed with markdown shortcuts.
- Every paragraph is an idea, and so is a list item with its sub-items: hovering one shows "Move into a new workstream" in a left gutter, and ⌘↵ moves the one under the caret.
  Moving creates the workstream in the background with `createWorkstreamForRepositoryCommand(repo, { workstreamId, inBackground: true })`, cuts the idea from the pad once the workstream is staged, and queues its text, sub-items as markdown bullets, as the first prompt with `sendFirstPromptCommand`, on the new workstream's default model and run profile.
  The prompt queue sends it once setup finishes, whether or not the workstream is open; a prompt that fails to send lands in that workstream's composer, and ⌘Z puts the text back on the pad.
- Every `@tiptap/*` package sits on one version so the app loads one `prosemirror-model`; two copies break both editors.

## Consequences

- A repository has a home page, and its workstreams stay one click away in the sidebar.
- Pads live only in Malini's database: not in git, not synced, gone with the profile, and there is no export.
- The stored shape is this schema's TipTap JSON, so a schema change migrates stored pads; a pad the schema cannot read shows an error and is never overwritten.
- The pad holds only ideas not started yet; a started idea lives on in its workstream's chat, and the sidebar shows its status.
- Starting from the pad never navigates, so several ideas can start in a row.
- Enforced by `src/lib/scratchpad/platform/register.test.ts` (save validation, the case-insensitive key), `scratchpad-notes.browser.test.ts` (prompts with sub-items, what a move cuts, unreadable pads), the `scratchpads` table in `migrations.test.ts`, `src/main/modules.test.ts` (every command has a handler) and `tests/e2e/scratchpad.spec.ts`.
