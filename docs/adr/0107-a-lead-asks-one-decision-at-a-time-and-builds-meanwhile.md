# 0107 - A lead asks one decision at a time, and builds meanwhile

Status: accepted

## Context

A lead could ask the user only in its `Needs:` line or with Claude Code's question tool, which blocks the turn, so its workstreams stood still until the user answered.
The user felt they had "very little control", since "a lot got shipped, but I wasn't asked a lot of questions".
Of the redesigns, they liked "that the questions are like at the bottom of the chat", and disliked "when needs you cards, they are displayed all at once because it's overwhelming".
"A lot of people are visual ... we should actually try not to ... pollute user with too much text and do visuals if possible", and choices between whole pages need "a bigger resolution".
They also asked: "is it possible for me to send a message to a parent's chat ... and have it manage the whole thing".

## Decision

- Bridge protocol 43 adds two pre-approved platform tools (0106), handled by `src/lib/chat/platform/lead-decisions.service.ts`:
  - `decisions_ask` records one decision: a topic, the question, an optional why, two to four options, each with a label, a note and an optional picture, the option it recommends, and what it builds meanwhile; `decided: true` records a decision the lead took itself.
  - `decisions_answer` records the option a message of the user picked, with their reason, for a decision of that chat.
- Only a chat at Home or in an organization keeps decisions; another chat gets an error that points it to `Needs:`.
- A picture must be a file inside the checkout of the lead or of a workstream in its tree, and is kept as that workstream and a relative path, so the app shows it through that workstream's media and pages (0025, 0044).
- Migration 75 adds `lead_decisions`; `chat:lead-decision-changed` reports each change, and `chat.list-lead-decisions` lists a chat's decisions.
- `chat.answer-lead-decision` records your pick and reason and delivers it to the lead as a `decision` delivery (0104): "Decided “topic”: option." with "Why:", or "Changed “topic” to option, from option." for a change; the same pick with the same reason sends nothing.
- `LeadDecisionQueue.svelte` shows the open decisions in the composer slot, one card at a time with **‹ 1 of N ›**, each option as its picture or, without one, its label; the composer stays under it, and **Later** or Escape folds the queue into a **decisions wait for you** row (`RequestsWaiting.svelte`).
- An option's picture opens in `LeadDecisionViewer.svelte` on `MediaViewer.svelte`: full size, a page live, the arrow keys flip between options, and **Go with**, or **Switch to** on a made decision, takes an optional reason.
- A made decision sits on the timeline with **Change** (0109), and **Your decisions** in the top right list (`LeadDecisionsList.svelte`) holds them all, the open ones first.
- The lead's instructions say to ask one decision per call with pictures when there are any, keep the workstreams building the recommended option meanwhile, record each answer a message covers with `decisions_answer`, and name open decisions in `Needs:`, so the existing needs-you status, sound and notification tell the user one waits; its brief lists the open ones (0103).

## Consequences

- The user decides from pictures, one decision at a time, while the work goes on along the recommendation; a pick the lead did not expect costs the work built meanwhile.
- Typing to the lead always works: the lead reads the message against the open decisions and records what it covers, so an answer in prose needs a model, unlike a click on the card.
- A decision cannot hold a picture from outside its tree, so the lead copies what it wants to show into a checkout first.
- Enforced by `lead-decisions.service.test.ts` (asking, a decision the lead took, refusing a chat that is no lead and pictures it cannot show, answers by message and by card, changes, the delivered wording), `deliveries.test.ts`, `lead-brief.test.ts`, the bridge's `browser-tools.test.ts` (the tool schemas) and `protocol.test.ts`, `src/main/db/migrations.test.ts` (migration 75), and `tests/e2e/lead-timeline.spec.ts` ("a lead asks you one decision at a time, you answer on its card or in a message, and it hears your pick").
