# 0051 - Prototypes live in `.context`, never in tracked source

Status: superseded by 0070

## Context

The user asked for UI variants of the Jobs page to brainstorm with.
The agent built four redesigns as Svelte components behind a hidden `/jobs/lab` route, with in-memory data, and merged them in #27 while `/jobs` kept the old page.
The user had meant the picked design to replace the page, and said prototypes "should never become part of our source code", only of the `.context` directory.
`.context` already holds agent captures and stays out of every commit (0045).

## Decision

- The agent instructions in `packages/agent-bridge/src/claude/instructions.ts` gain a **Prototypes** line: variants, mock-ups and every other prototype are built only under `.context/`, for example as standalone HTML pages opened with `browser_open`; a prototype never becomes a route, component, test or commit; once the user picks one, the agent builds it into the real code path on real data, replaces what it supersedes, and deletes the prototype.
- `.agents/rules/agent-behavior.mdc` states the same for this repository, and the chat docs (`apps/site/content/chat.md`) tell users.
- The lab prototype from #27 became the real Jobs page (0050) and its prototype code is gone.

## Consequences

- No half-built page ships behind a hidden URL, and a picked variant lands as the real thing in the same change.
- A prototype cannot reuse the app's Svelte components directly, so it copies their look in plain HTML.
- `instructions.test.ts` pins the instruction text; nothing detects a prototype that slips into tracked source.
