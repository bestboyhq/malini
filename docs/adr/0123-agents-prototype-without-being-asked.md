# 0123 - Agents prototype without being asked

Status: accepted

## Context

Asked whether Malini gamifies sharing stats, an agent laid out milestone moments and a share card, then ended with "Want me to prototype 2-3 looks for the moment card?" and built nothing.
The instructions gave it no reason to do otherwise: a turn that only answers a question got a plain answer and no report, and variants came only when the user asked for options.
Many users also tell their agents that a question must never be implemented, and a prototype read as implementing.
The user wants Malini proactive about low-risk prototyping: prototypes cost little, live in `.context/` (0051, 0071), and are the foundation of agreeing with the user.
A run of `claude -p` on that question with the old instructions ended with "I'd start by prototyping two or three nudge variants under `.context/`. Say go."

## Decision

- The agent instructions in `packages/agent-bridge/src/claude/instructions.ts` open the **Prototypes** line with a duty: whenever a reply proposes or weighs a screen, a component, a flow, a layout or words on screen, the agent builds the prototype in that same turn, even when the user only asked a question, and never ends a turn offering to.
  The line says why that is not implementing: a prototype changes no code.
- The same line sets the bar: standalone HTML pages with no build step, opened with `browser_open`, that copy the product's colors, type, spacing and icons from its source, sit in the screen around them, show the user's real content instead of lorem ipsum, and respond where the user would click or hover.
- A turn that built a prototype ends with a report, so its variants reach the report's frame and the pick goes in `Needs:`; only a turn with nothing to show gets a plain answer.
- `Commit:` and `Pull request:` are written only for changes outside `.context/`, so a prototype-only turn names no commit.
- A lead chat has no file tools, so its instructions now hand each change, a prototype included, to a workstream.
- `.agents/rules/agent-behavior.mdc` says the same for this repository, and `apps/site/content/chat.md` tells users.

## Consequences

- Discussion turns about anything visible cost a few minutes more and end with something to look at, and the user picks instead of saying go.
- Agents may build a prototype the user did not need; it stays under `.context/` and never reaches tracked source.
- With the new instructions, the same `claude -p` question built three HTML variants on the user's real stats and asked for a pick, and a question about the bridge build built nothing.
- `instructions.test.ts` pins the instruction text; nothing checks that an agent actually prototypes, so that comparison is the only behavioral check.
