# 0067 - A chat ships the workstreams it starts, and their jobs wait for the first turn

Status: accepted

## Context

Chats coordinate work in other workstreams with `workstreams_create` (0063), and each of those workstreams ended on a draft: one chat started nine Logdash SDK workstreams whose prompts said "run the Open draft job", so the user clicked Merge in every one.
The user asked for a tool to start the Merge job in a workstream, and to "allow parent workstream doing equivalent of clicking 'merge' in the pr statusbar".
`jobs_run` already took a `workstream` (0061), and the Merge job calls `pull-requests.queue-merge`, the command behind Merge in the top bar.
Two things kept a chat from using it: the instructions mapped "ship" to Open draft and never said a chat may ship the workstreams it starts, and a Merge run right after `workstreams_create` started while the workstream was still setting up, with no working run, and failed with "This workstream has no changes to ship yet."
Asking the started workstream's own chat to ship puts the approval in a chat the user is not watching.

## Decision

- No new tool: the chat runs the existing Open draft or Merge job in the workstream it started, with `jobs_run` and its id in `workstream`.
  0061's rule stands, read in that chat: only when the user explicitly asked there to open a pull request or to merge.
- `createWorkstream` in `src/lib/chat/platform/agent/platform-tools.ts` holds the new workstream's first prompt in flight from the call until `chat.send-prompt` has started its run, through `PromptsInFlight.during`.
  `startAgentService` now creates one `PromptsInFlight` and hands it to both `defineBridgeCommands` and `answerPlatformRequest`.
- So `chat.workstream-has-working-run` and `chat.workstream-has-open-run` are true while the workstream sets up: the job runner keeps any job queued there until the chat's first turn ends, and the merge queue counts the workstream busy.
- The agent instructions (`packages/agent-bridge/src/claude/instructions.ts`) add "Workstreams you start": when the user asked to ship or merge work handed to a workstream, run Open draft or Merge there from this chat right after starting it, and leave shipping out of its prompt.
  The `jobs_run` and `workstreams_create` descriptions say the same.
- The chat shows such a run in its composer tray, named with the workstream it runs in, as **Merge · Job in Fetch command** (0068).
- `workstreamNameQuery` also names archived workstreams, so approval cards and Activity keep the name of a workstream that merged.

## Consequences

- "Start five workstreams and merge them" is five `workstreams_create` and five `jobs_run` calls approved in one chat, where **Always allow** for that chat covers the rest, and each workstream merges and archives after its first turn.
- Merge merges what that first turn produced even when the turn ended with a `Needs:` line, as Merge in the top bar does while an agent works; checks, Fix checks and Resolve conflicts still come first.
- A job queued in a workstream during its setup no longer runs before its first prompt; a prompt the user sends there during setup still takes the workstream first, as 0063 says, and editing or undoing a turn waits for setup to end.
- A run that ends while its send is still in flight leaves a queued job to the runner's 15-second safety pass.
- `tests/e2e/agent-workstream-chat.spec.ts` enforces it: "Merge from the chat that started a workstream waits for its first turn, then merges and archives it" holds the install and the first run, and fails when the Merge runs before that turn ends, or when the workstream does not merge and archive.
  The fake `gh` in `tests/e2e/fake-github.ts` opens a pull request for the `--head` it is given and lists pull requests by head, and its repository lives in a `hutch` folder, so a workstream started in `e2e/hutch` reuses the seeded clone as a real clone from GitHub does.
- `instructions.test.ts` fails when the instruction to ship from the chat that started the workstream goes missing.
