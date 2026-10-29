# 0109 - Malini delivers what chats send each other

Status: accepted

## Context

0085 held the reconciler's wakes for a busy chat in memory, and `workstreams_send` (protocol 41) refused a chat on a turn, so the agent had to try again later.
The first prompt of a workstream an agent started waited in memory too, while the workstream set up (0063, 0067).
In the "Public profile workstreams" chat, Malini restarted on ten merges, five relays were lost to restarts, and the lead told one workstream that another had its instructions when they never arrived; the chat stalled for a night.
The user: "my expectation as a user is that I will feel like there is a single chat ... and kinda stuff just works".

## Decision

- Migration 75 adds `agent_deliveries`: the chat a delivery goes to, its kind (`prompt`, `report` or `decision`), the prompt, the chat and workstream that sent it, the report or decision it carries, a profile, its chain and cause event, and its status: `waiting`, `delivered` with the run it started, or `failed` with why.
- `ChatDeliveries` (`src/lib/chat/platform/deliveries.service.ts`) writes everything one chat sends another there first, then flushes the receiving chat.
  An idle chat gets all that waits as one prompt (`deliveryBatch` in `src/lib/chat/domain/deliveries.ts`): reports first under one preamble, then decision answers, then prompts, with the first sender as `from`, the chain and cause, and the first profile a delivery carries, else the profile of the chat's latest run you started.
- A chat on a turn keeps what waits for it.
  The Deliveries rule flushes it on that chat's Turn finished (0110), Resume flushes every chat with something waiting once Malini started, and a chat that answers it already runs is tried again every 3 seconds, 20 times, then left for its next Turn finished.
- `workstreams_create` holds its new chat's first prompt as a waiting delivery until the workstream is set up (`hold`, `release`), and `workstreams_send` (`sendToWorkstream` in `src/lib/chat/platform/agent/platform-tools.ts`) delivers instead of refusing, and returns the delivery's id and status.
- The reconciler's wakes go through the same deliveries (`deliver` in `src/main/modules.ts`), and its in-memory hold is gone.
- `chat:delivery-changed` reports each change, and `chat.list-deliveries` lists what a chat sent, so its timeline says **waits for its turn to end**, **delivered** or **not delivered** (0114).
- A chat that is archived or gone fails what waits for it.

## Consequences

- What one chat sends another arrives once, after any restart, and never interrupts a turn.
- Reports and answers that land during one turn reach the chat as one prompt, so it acts on all of them together.
- A chat that never ends its turn holds everything sent to it, and the sender's timeline shows it waiting.
- The hold on a first prompt lives in memory: a restart during setup sends that prompt at boot, before the workstream finishes setting up.
- Enforced by `deliveries.service.test.ts`, `deliveries.test.ts`, `workstreams-send.test.ts`, `src/main/db/migrations.test.ts` (migration 79) and `tests/e2e/lead-timeline.spec.ts` ("a prompt for a workstream that is on a turn waits for that turn, then arrives without asking").
