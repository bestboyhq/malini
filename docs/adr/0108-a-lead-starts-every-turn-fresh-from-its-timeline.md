# 0108 - A lead starts every turn fresh from its timeline

Status: accepted

## Context

A lead chat (0070) resumed one Claude Code conversation for its whole life, so every report that woke it (0085) came on top of everything before it.
In the "Public profile workstreams" chat, each wake re-read up to 346k tokens of history to handle a four-line report.
The user: "I think we should also start from the fresh context whenever the parent chat is waken up because I never want to worry about the context in my parent chat", and "why not just start a new run after waking up the parent chat with ... all the summaries that happened to that point".
Every turn already ends with a report, and the lead now reads as a timeline of those (0114), so what the user sees is what the lead needs.
The bridge could already start a conversation over: `send_prompt`'s `freshConversation` is how Malini rebuilds a session after a checkpoint restore.

## Decision

- `sendAgentPromptLeased` (`src/lib/chat/platform/agent/commands.ts`) sends every prompt of a chat whose workstream has a `scope` with `freshConversation: true` instead of the provider resume point, unless the prompt takes over a run that only waits on background work (0009).
- It puts the brief of `leadBriefFor` (`src/lib/chat/platform/lead-brief.service.ts`, built by `leadBrief` in `src/lib/chat/domain/lead-brief.ts`) before the prompt: a `<malini_timeline>` block with one stamped line per prompt of yours, per report, per Malini call the lead made (started, sent, archived, ran a job, wrote the plan), per decision, and the last thing the lead said in each run, then the decisions still open.
- `listTimelineEventRows` (`src/lib/chat/platform/events.repository.ts`) reads only what the timeline shows, leaves out the turns you undid or rewound, and loads the payloads of Malini's tools alone.
- The brief keeps its first line and the newest ones within 120,000 characters, and quotes at most 400 characters of each prompt the lead sent.
- The lead's instructions (`packages/agent-bridge/src/claude/instructions.ts`) say each turn starts in a fresh session from the timeline, so what it only read with tools is gone, and its plan (0113) keeps what the work needs.
- The e2e fake bridge strips the brief before it reads a prompt's directives, and `WHICH_BRIEF` answers whether the turn started fresh and what the brief said.

## Consequences

- A lead never fills its context, however long it runs: a turn costs its brief and what it reads, never every turn before it.
- A lead forgets what it only read, so it reads code and checkouts again when it needs them, and a lead that keeps its knowledge out of the plan repeats work.
- Leads lose the prompt cache between turns; repository chats keep resuming Claude as before.
- The prompt's profile still carries the model, effort, access and mode, so a fresh turn runs with the settings you picked.
- Enforced by `lead-brief.test.ts`, `commands.test.ts` ("starts each turn of a lead chat fresh from the chat's timeline instead of resuming Claude", "keeps resuming Claude in a repository chat, with the prompt as typed", "leaves out of the timeline the turns the user undid or rewound, and loads only Malini tool payloads") and `tests/e2e/lead-timeline.spec.ts`, whose first test asks `WHICH_BRIEF`.
