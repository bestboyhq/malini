# 0089 - A chat speaks for the workstreams it started

Status: accepted

## Context

0077 brought a started workstream's approvals and questions up into the chat that started it, and 0085 wakes that chat with each finished turn, but every other signal still came from the workstream itself.
`AgentLifecycleMonitor#routeAttention` played a sound, marked the row unread and sent a notification for each started workstream's turn, the sidebar drew its row bright and amber, Status grouping put it under **Needs you** while its chat sat under **Idle**, the pull request toast and the reconciler's "Malini asks you" opened the workstream, and nothing on the chat's row changed.
The user said: "if there is a chat that has sub work streams this parent chat should be the control center for those work streams and not like as a user I shouldn't be nudged to go into every single work stream like that. and always the parent chat should just aggregate the information for me."

## Decision

- A workstream's lead is the top-most open workstream above it through `startedBy`, from `workstreamLeads` in `src/lib/shared/repositories/domain/workstream-leads.ts`; a workstream with no open parent leads itself.
- Notifications: `follow-workstreams-route.command.ts` puts the lead's id and label on each `AgentWorkstreamContext` as `lead`, and `routeAttention` still marks a led workstream's chat but plays no sound and sends no notification when it finishes, needs you or fails.
  An approval or a question plays the sound and notifies with the lead's label as the title and the workstream's line as the body, opening the lead's chat (`sessionsAggregate.cachedSessionFor`), and sends none while the lead or the workstream is on screen.
- Sidebar: `attentionTreeQuery` in `src/lib/app/application/queries/attention-tree.query.svelte.ts` hands each row `treeChatSummary` (`src/lib/app/domain/attention-tree.ts`): a led row has no attention, and a lead's row has the most pressing attention of its tree, with `attentionFromStarted` so its tooltip says "A workstream it started needs your input".
  The focus strip's amber dot reads the same summary.
- Sections: `sidebarSectionsQuery.sectionOf` files every workstream under its lead's section, from `treeDot` over the tree's progress dots and the latest activity in the tree, so a lead's workstreams always nest under it (0083).
- The pull request needs-you toast names the lead and its **Open** opens it, through `watchShipStatesHook`'s `leadOf`, and the reconciler's "Malini asks you" opens the lead's latest chat.
- The `WorkstreamChatSummary` component is gone; `Sidebar.svelte` reads `attentionTreeQuery.summary` directly.

## Consequences

- One chat holds the attention for everything it set going, at any depth, and its workstreams stay quiet until you open them; their own tabs still show what is unread.
- A led workstream's "Needs:" or failure reaches you only through its lead: the reconciler wakes the lead or asks you, and with Reconcile events off only the lead's row, dots and top bar say it.
- A workstream whose lead is archived leads itself again and speaks for itself.
- Enforced by `workstream-leads.test.ts`, `attention-tree.test.ts`, `lead-progress.test.ts` (`treeDot`), `agent-activity.aggregate.svelte.test.ts` (a changed lead is a new scope), `agent-lifecycle-monitor.service.test.ts` ("leaves a started workstream quiet and asks for its approvals in the name of the chat that leads it"), `reconciler.service.test.ts` (the ask opens the lead's chat), and `tests/e2e/lead-chats.spec.ts`: "a workstream a chat started stays quiet in the sidebar, and the chat says what it needs" fails when the started row names its need as an attention, the chat's row does not, or grouped by Status the chat is not under **Needs you** with the workstream nested under it.
