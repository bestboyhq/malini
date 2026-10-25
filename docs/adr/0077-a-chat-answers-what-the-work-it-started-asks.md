# 0077 - A chat answers what the work it started asks

Status: accepted

## Context

0068 lists a chat's job runs in its composer tray wherever they run, and 0067 lets a chat run jobs in the workstreams it starts, because "asking the started workstream's own chat to ship puts the approval in a chat the user is not watching".
The approvals and questions themselves still showed only in the transcript of the chat that asked: `ChatMessageList` syncs `agentInteractionCommands` from the transcript on screen, so the tray row **Address review · Job in Release automation switch · Needs you** only linked there.
The user asked: "children stuff should be coming to the parent chat, not force me to go down the tree".

## Decision

- A chat brings up the requests of the work under it: the tray's job runs that need you, and the chats waiting for approval in every workstream started from its workstream, down the tree, never the chat on screen.
  `descendantWorkstreamIds` in `src/lib/chat/domain/child-requests.ts` walks `startedBy` down from the chat's workstream, and `askingChildren` picks the asking chats, read through `askingChildrenQuery` from the tray's runs and `sessionsAggregate`.
- The requests wait in one queue in the composer slot, `ChildRequestQueue`, one at a time, as Claude's own questions do.
  `childRequestSteps` makes each open approval a step and each child's open questions one step; the header names the job and its workstream, or the workstream, and holds ‹ **1 of N** ›, **Open transcript** and **Later**.
  An approval is a bare `AgentInteractionCard` in a `ComposerShell`, and questions are an `AgentQuestionPanel` whose **Dismiss** stops the child's run.
- The chat's own question comes first; the queue takes the slot once it is answered.
- **Later** or Escape folds the queue into a tray row, **N requests need you · Answer** (`ChildRequestsWaiting`), and gives the composer back.
  When the queue fills while the composer holds a draft, it starts folded, so a request never takes the slot while you type.
- `followChildRequestsHook` follows every asking child and reads each one's latest run with `chat.list-event-page` and a byte budget of 0, keeps its request and terminal events in `childRequestsAggregate`, and syncs them into `agentInteractionCommands`, so an answer goes through `chat.decide-approval` and `chat.answer-question` as it does from the child's own transcript.
  A child comes back each time it starts needing you, so a second request in the same run reloads.
- `AgentInteractionCard` heading ids carry the session id, since a child's request can share a `seq` with one in the chat on screen.

## Consequences

- Work a chat starts asks the user in that chat; the child's transcript stays the record and shows the answer.
- However many children ask, the chat shows one request and a count, and the transcript keeps its space.
- A grandchild's request shows in every chat above it, so the top chat answers the whole tree; a job a child runs outside the tree asks only in that child.
- A child chat whose approval resolved elsewhere stays listed until its run moves on, since no event records an approval's decision; its step is filtered out by `stateFor`, so the queue skips it.
- The hook transfers the whole latest run to find its requests, marked `ponytail:`; a kind filter on `chat.list-event-page` trims it.
- Enforced by `src/lib/chat/domain/child-requests.test.ts` and `tests/e2e/child-requests.spec.ts`, which fails when a job's approval, a started workstream's approval, or its own started workstream's question cannot be answered from the chat at the top, or when several requests do not queue one at a time, fold away on **Later**, or take the slot over a draft.
