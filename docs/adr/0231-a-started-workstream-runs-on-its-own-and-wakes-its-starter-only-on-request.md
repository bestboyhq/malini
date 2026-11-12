# 0231 - A started workstream runs on its own and wakes its starter only on request

Status: accepted

## Context

0077, 0089, 0090, 0110 and 0132 made the chat that starts a workstream its control center: its composer answered the child's approvals and questions, its row took the child's attention, every turn the child ended woke it with a report, and both pages showed the link with **Started by**, **Started here**, progress dots, **Draft all** and **Merge all**.
The user stopped using it that way: "Whenever I have a workstream that's creating another workstream, I find myself always removing the parent connection", through the **×** beside **Started by**.
They asked for the opposite model: a started workstream "should be self-responsible for itself", and the one that started it "should just know about that child workstream event".
On the user: "user doesn't give a fuck who is the parent ... user only gives a fuck about going to the chat that pings the user and answering the question", and "why would I give a fuck about the structure of my workstreams as a user? It's none of my problems."
On the parent: "we can ping a workstream, but we shouldn't ping a conversation necessarily", "I just don't want the parent workstream to be flooded with every single event that happens within its children", "I really want to reduce the noise for user."
0103 showed that the model step cannot be trusted to wake a parent that waits, so the parent's agent says when it waits.

## Decision

- A started workstream speaks for itself, like a workstream nobody started.
  Its chat plays its sound, marks its row unread, notifies in its own name and opens itself; its row and Status section show only its own state; its pull request toast names it; the reconciler's **Ask you** opens its own chat.
  `AgentWorkstreamContext.lead`, `attentionFromStarted`, the tree rollup in `attention-tree.ts` and `workstreamRoots` are gone.
- Its approvals and questions wait only in its own chat.
  The composer queue keeps only the requests of automations a chat ran (0068) and the unchecked calls of 0097, renamed from child requests to requests elsewhere (`RequestQueue`, `requestsElsewhereQuery`); `askingChildrenQuery` and the descendant sessions are gone, and `descendantWorkstreamIds` moved to `chat/domain/workstream-tree.ts` for 0111.
- The UI shows no link: **Started by** with its **×** and the `repositories.detach-from-starter` command, **Started here**, the sidebar's dots and hover card of started work, and **Draft all** and **Merge all** with their Button clicked values are gone.
- `startedBy` stays as agent plumbing: `workstreams_list` reports it with each workstream's `Outcome:` and `Needs:`, `workstreams_send` reaches only workstreams the caller started, the tree approvals of 0111 stand, the agent ships what it started with `automations_run`, and a started chat still learns its siblings' checkouts.
- A child's **Turn finished** still passes through the reconciler, whose **Deliveries** rule reports it only to a chat that asked.
  `workstreams_create` and `workstreams_send` take `wake: true`, stored as the `wake` column a new migration adds to `agent_deliveries`.
  When the turn that prompt started ends, Deliveries sends the asking chat the same report 0110 sent, then clears the wake.
  A turn that ends while only background commands run reports and keeps the wake for the turn that goes on, an `interrupted` turn keeps it for the resumed turn, and a stopped one clears it without a report.
- The agent instructions say work it starts runs on its own and alerts the user itself, and to pass `wake: true` only when its next step needs that turn's result.

## Consequences

- Each chat that needs you asks you itself, and the chat that started it stays quiet unless its agent asked to hear back.
- A parent that forgets `wake: true` never hears the turn; it reads where its work stands with `workstreams_list`.
- Shipping many started workstreams at once now takes the agent's `automations_run` per workstream, or **Merge** in each.
- This supersedes 0077, 0089, 0090, 0132 and 0133, and changes 0110's report to every finished turn and 0198's line that keeps the report, **Started by**, the dots, **Draft all** and **Merge all**; the rest of 0110 and 0198 stands.
- Enforced by `deliveries.service.test.ts`, `workstreams-send.test.ts`, `migrations.test.ts`, `tests/e2e/started-workstreams.spec.ts` and `tests/e2e/event-reconciler.spec.ts`.
