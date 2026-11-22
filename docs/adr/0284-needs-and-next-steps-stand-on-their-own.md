# 0284 - Needs and next steps stand on their own

Status: accepted

## Context

A turn ended with "Needs: approve the two new docs sentences in apps/site/content/chat.md", and its report never showed the sentences, so the user had to ask what the question was about.
The same report ended with `Next: Decide what "A folder on this Mac" does with a folder that has no git.`, which named neither the screen nor what goes wrong, and handed the user a call the agent could make.
The user found it annoying "when you're asking me about something and I don't have the context", and said "I don't want to be a decision maker on something I shouldn't be a decision maker, I would like to be treated as a tool call".
The instructions said only that `Needs:` is for a blocker only the user can clear and that `Next:` is the instruction the agent would want to receive (0048).
A next step reaches places with no chat around it: the user reads it in the report, and **Note it** saves it to the scratchpad, where a later workstream starts from it with no transcript.

## Decision

- The agent instructions in `packages/agent-bridge/src/claude/instructions.ts` tell the agent to treat the user as a tool it calls.
  It decides everything that is not the user's, takes the answer it would defend, says which one it took and goes on.
  `Needs:` stays for a secret, access, or a decision that is the user's, such as a product direction or words they asked to approve.
- A call carries its whole input: the report shows what the ask is about at every report resolution, the words quoted in full, the variants embedded, or each option with what it leads to and the recommended one, and the `Needs:` item names the answer it wants.
- A `Next:` stands on its own: it names the screen, file or command, what happens there now and what to change.
  It is an instruction for an agent, never a question for the user; a call only the user can make goes in `Needs:`.
- `apps/site/content/chat.md` says both under Reports and Next steps.

## Consequences

- The user answers a `Needs:` from the report alone, and a next step still reads right in the scratchpad.
- A report that asks something gets longer than its resolution's bullet limit, since what the ask is about comes first.
- The agent makes more calls on its own, and says which one it made, so the user can still turn one around.
- `packages/agent-bridge/src/claude/instructions.test.ts` fails when the instructions drop either rule; nothing checks that a real report follows them.
