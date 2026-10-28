# 0105 - Every turn of a started workstream reports to the chat that started it

Status: accepted

## Context

0085 handed the end of a turn in a started workstream to the model step, which could wake the chat that started it, ask you, or do nothing, and 0091 made waking the default when the model gave no answer.
In the "Public profile workstreams" chat, two of five reports skipped the lead and reached the user as a question, and the comparison designs waited three and a half hours until the user typed "continue".
The user: "my expectation as a user is that I will feel like there is a single chat", "I don't need to go to sub chat", and "I felt like I have very little control ... a lot got shipped, but I wasn't asked a lot of questions".
A lead that hears every report brings the user what to decide itself (0107), so the choice between waking it and asking the user no longer belongs to a model.
A lead that answers every report could also loop with a workstream forever, which 0085 bounded with three wakes per chain.

## Decision

- A new reconciler rule, **Deliveries** (`deliveries` in `RECONCILER_RULES`), hears Turn finished, and `ChatDeliveries.turnFinished` (`src/lib/chat/platform/deliveries.service.ts`) flushes what waits for the chat that finished (0104) and reports the turn to the chat that started its workstream.
- The report goes to the chat whose `workstreams_create` started the workstream (`startingSessionId`), else to the starter's latest chat, unless the turn was stopped, nobody started the workstream, or that chat is archived.
- It says which workstream ended a turn or failed it and where its checkout is, then the turn's own report with its relative picture paths pointed at that checkout (`reportForLead`), cut to its head and its footer past 6,000 characters, or the turn's `Outcome:` and `Needs:` when it left no report.
- It carries a `WorkstreamReport` (`src/contract/deliveries.ts`): the workstream, run, status, `Outcome:`, `Needs:` and up to six pictures its report embeds (`reportMedia`), which the user message keeps as `reports`, so the timeline shows each report with its pictures (0109) and the lead's brief gets one line per report (0103).
- The model step hears only Job finished and Merge conflicted (`RULE_EVENTS`); `TurnFinishedSituation`, its candidates and `wakePrompt` are gone, and the model's wakes, now **Tell “chat” that ...**, go through Deliveries too.
- `workstreams_send` sends one workstream at most `SENDS_PER_CHAIN` (6) prompts from one chat in one chain of events (`promptsSentInChain`); a prompt you type starts a new chain (0085), and past the limit the tool fails and tells the agent to ask you with `decisions_ask` or name it in `Needs:`.
- The Explorer draws a turn that a report woke through the Deliveries rule (`turnHops`), and its why reads **Deliveries woke it**.

## Consequences

- A lead hears every turn its workstreams end, quiet ones included, and no report reaches the user around it.
- Each finished turn of a started workstream costs its lead a turn, and reports that land while the lead works share one.
- Haiku no longer runs when a turn ends, only for jobs and conflicts.
- A lead and a workstream can trade at most six prompts per workstream before the lead must ask you; the three-wake budget of 0085 still bounds the model's wakes.
- This changes 0085's model step on a finished turn and its in-memory wakes, 0091's default wake for a turn, and 0090's "the reconciler wakes the lead or asks you"; the rest of those stand.
- Enforced by `deliveries.service.test.ts` ("reports a finished turn to the chat that started the workstream", "reports to the chat whose workstreams_create started it, else to the starter's latest chat", "reports nothing for a stopped turn, a workstream nobody started, or a starter that is gone"), `deliveries.test.ts`, `reconciler.test.ts` ("hands a finished turn to Deliveries, never the model, which hears finished jobs and merge conflicts"), `reconciler.service.test.ts` ("makes no decision on a turn that ended in a started workstream, and never asks the model about it"), `explorer.test.ts` ("routes a turn a report woke through Deliveries, from the Turn finished it reported"), `workstreams-send.test.ts` (the six-prompt budget), and `tests/e2e/event-reconciler.spec.ts` ("a lead chat hears every turn a workstream it started ends, and the Explorer says Deliveries woke it").
