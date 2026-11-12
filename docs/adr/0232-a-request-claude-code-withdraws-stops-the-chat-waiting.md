# 0232 - A request Claude Code withdraws stops the chat waiting

Status: accepted

## Context

Claude Code withdraws a permission prompt or a question once it no longer needs the answer, for example when the subagent that asked is stopped with `TaskStop`.
The SDK then gets `control_cancel_request`, and `handleControlCancelRequest` aborts the signal it gave `canUseTool`.
`ProviderInteractionBroker` settled that request as denied (`request-aborted`) or cancelled and told Malini nothing.
Its `agent_interactions` row stayed `pending` and the fold kept it in `openRequests`, so `moveSessionStatus` and `nextSessionStatus` (0199) held the chat at `waiting_for_approval` for the rest of the run, with no card left to answer.
A user saw **Waiting for you** under **Thinking** while the run went on, held by an approval a stopped fork asked for hours earlier.

## Decision

- Bridge protocol 57 adds `approval.withdrawn` (`runId`, `approvalId`) and `question.withdrawn` (`runId`, `questionId`).
  `ProviderInteractionBroker` emits one when the SDK aborts a request nobody answered, after it settles it; a request already answered emits nothing.
- `pumpStep` closes the matching `pending` or `dispatching` row with `closeWithdrawnInteraction` (`src/lib/chat/platform/interactions.repository.ts`) before it stores the event, and drops the event when no row moved, so a late or repeated withdrawal changes nothing.
- `LIFECYCLE_KINDS` adds both kinds, and `nextSessionStatus` treats them as `approval.decided` and `question.answered`: back to `running` once no other request of the session waits, and the fold drops the request from `openRequests`.
- The renderer marks the request's card **No longer active** unless you already answered it (`agent-interactions.aggregate.svelte.ts`).
  `AgentLifecycleMonitor` clears the run's attention once the chat no longer waits, and `requestEnvelopes` in `child-requests.ts` passes both kinds, so the chat that started the work drops the request from its queue.
- The automation runner moves a run from `needs-you` back to `running` on either event, as it does after an answer.

## Consequences

- A chat waits for you only while a request you can answer is open; a stopped subagent's prompt no longer holds it.
- A withdrawal never answers for you: the card keeps no decision and reads **No longer active**.
- A new kind of request from the bridge needs its own withdrawal event, or its chat can wait forever again.
- Enforced by `packages/agent-bridge/src/__tests__/provider-interactions.test.ts` ("tells Malini when Claude Code withdraws a request nobody answered"), `src/contract/agent-state-machine.test.ts` ("goes back to running once Claude Code withdraws a request nobody answered"), `src/lib/chat/platform/sessions.repository.test.ts` ("agrees with the event fold once Claude Code withdraws a request nobody answered"), `src/lib/chat/infrastructure/services/agent-lifecycle-monitor.service.test.ts` ("stops asking for the user once Claude Code withdraws the last open request"), `src/lib/automations/platform/register.test.ts` ("keeps a run waiting for you until every request it left open is answered or withdrawn") and `tests/e2e/chat-session-status.spec.ts` ("a request Claude Code withdraws stops the chat waiting for you").
