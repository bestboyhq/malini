# 0068 - A chat's jobs wait in the composer tray, not in its messages

Status: accepted

## Context

0011 showed a job run started from a chat in its transcript, as a card after the turn it followed, through `chat_session_id`, `chat_after_run_id` and `jobs.list-chat-runs`, and 0029 did the same for `jobs_run`.
The composer tray already listed the workstream's active job runs, so a queued job showed twice in a chat: as a card among the messages and as a row above the composer.
A fresh chat's empty state listed it a third time, and a run that 0067's chat starts in another workstream showed only as the card.
The user asked: "whenever we queue up the job in a chat or something like that, it shouldn't be part of the chat messages. It should just stick to the composer, just like anything else that is queued up."

## Decision

- The transcript shows no job runs: `ChatMessageList` no longer renders `JobRunCards`, which is deleted along with `chatJobRunsQuery`, `loadChatJobRunsCommand`, `jobRunsAggregate.loadChat` and the `jobs.list-chat-runs` command.
  This reverses the clause of 0011 that showed a chat's job run after the turn it followed, and the same clause of 0029 for `jobs_run`; the rest of both stands.
- The composer tray holds a chat's job runs while they are queued, running or need you.
  `WorkstreamLayout` passes `ChatSurface` the active runs of its workstream, plus the active runs whose `chatSessionId` is the shown chat's, wherever they run.
- The tray's list is the region **Jobs (N)** (`WorkstreamJobRuns`), and `JobRunRow` with `shownIn` names a run in another workstream: **Merge · Job in Fetch command · Queued**.
  Until the run has a transcript, its button reads "Merge job in Fetch command, Queued. The transcript opens once the job starts".
- A run leaves the tray once it finishes, as a queued prompt does once it is sent; its transcript and the Job Center's **Recent** keep it.
- A fresh chat lists only the runs the tray does not hold (`workstreamJobRunsQuery`): those that finished in the last ten minutes, with their result, and those waiting for your yes.
  `JobRunCard` drops its cancel button and its queued line, which no list shows any more.
- Runs keep `chat_session_id` and `chat_after_run_id`, which the `jobs:run-changed` payload carries; the tray reads `chatSessionId`.

## Consequences

- A job shows in one place in a chat, above the composer, next to the prompts queued there, and the transcript holds only the conversation.
- A job's result no longer lands in the chat that ran it: it is in the job's transcript, in the Job Center, and for ten minutes in a fresh chat of its workstream.
- A run in another workstream shows only in the tray of the chat that started it; a run in this workstream shows in every chat of it, whoever started it.
- Nothing in Malini reads `chat_after_run_id` any more; it stays for the event payload and for triggers that read it.
- `tests/e2e/jobs-in-chat.spec.ts` enforces it: "a job run from the slash list waits in the composer tray instead of the chat" fails when the run shows as a card in the chat, is missing from the tray while it is queued or running, or stays in the tray once it finishes.
  The Merge test in `tests/e2e/agent-workstream-chat.spec.ts` fails when a run in another workstream is missing from the tray or does not name that workstream, and `job-run-queries.test.ts` fails when a fresh chat lists a queued, running or needs-you run.
