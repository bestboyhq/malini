# 0294 - The agent asks its questions in the question panel

Status: accepted

## Context

A turn ended with "Needs: approve the two new docs sentences in apps/site/content/chat.md", and its report never showed the sentences, so the user had to ask what the question was about.
The same report ended with `Next: Decide what "A folder on this Mac" does with a folder that has no git.`, which handed the user a call the agent could make.
The user found it annoying "when you're asking me about something and I don't have the context", and said "I don't want to be a decision maker on something I shouldn't be a decision maker, I would like to be treated as a tool call".
A first try put the context into longer `Needs:` and `Next:` lines; the user turned it down: "I was hoping for concise experience", "your turn shouldn't include questions to me. Questions have dedicated UI and they should be directed there."
Claude Code's `AskUserQuestion` is that UI: the bridge turns it into Malini's question panel (`AgentQuestionPanel.svelte`), with a header, options with descriptions, the `(Recommended)` mark and free text, and the turn goes on with the answer.
A second try asked the docs approval in the panel with both sentences quoted in the question, and the user answered that it was "too complicated for me to answer. Like this question is like a whole essay."

## Decision

- The agent instructions in `packages/agent-bridge/src/claude/instructions.ts` tell the agent to treat the user as a tool it calls: it decides what is not the user's and goes on, and asks what is theirs, such as a product direction, with `AskUserQuestion` as soon as it reaches it.
- The user answers at a glance: the question is one short sentence with no quote, list or background, and its two to four options are a few words each with a one-line description, the recommended one first with `(Recommended)`.
  A question that needs more than that to answer is not the user's, and the agent decides it.
- `Needs:` is for what only the user can do that no question asks: picking a variant in the report's pick form, saving a secret, signing in, granting access.
- A `Next:` is one short action the agent settled, naming what it changes, never a question or a "decide whether".
- `apps/site/content/chat.md` says both under Reports and Next steps.

## Consequences

- **Your turn** in a report holds no questions, and a question waits in the panel where the user answers it with one click.
- A question stops the turn until the user answers it, where a `Needs:` let the turn end; the agent answers its own calls more often, so the user can turn one around afterwards.
- The variant pick stays in `Needs:`, since it needs the report's frame of variants.
- `packages/agent-bridge/src/claude/instructions.test.ts` fails when the instructions drop either rule; nothing checks that a real turn follows them.
