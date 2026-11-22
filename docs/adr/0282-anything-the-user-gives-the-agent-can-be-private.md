# 0282 - Anything the user gives the agent can be private

Status: accepted

## Context

The agent's instructions in `packages/agent-bridge/src/claude/instructions.ts` called only an attachment a holder of private data, and told the agent to copy none of it into a tracked file, a test, a fixture, a comment, a commit or a pull request.
The user pointed out that they give Malini data through every channel: the prompt box, their notes, Malini's browser, an image, a pasted image and a device connected to the Mac.
0281 swaps a token pasted in the composer for its secret name, but only a token of a known shape, and only in the composer.
A token typed or pasted in another shape, and a name, an email or an address in any channel, still reached the agent as text, with no rule on where it may go next.

## Decision

The attachment rule in `instructions.ts` keeps only how to read an attachment and that it shows a problem, never source data.
A new **Private data** rule covers every input: a prompt, a note, an attachment or a pasted image, a page in Malini's browser, and what a command reads from this Mac or a device connected to it.
The agent uses that data only for the task, copies none of it into a tracked file, a test, a fixture, a comment, a commit, a pull request or a request to another service unless the user asked for exactly that, and invents its own demo and test data.
A token or a password the user gives as text is a secret: the agent asks for it by name with `secrets_request` and uses `$NAME`, as 0141 says.

## Consequences

The agent treats each channel the same way, and an uncaught token gets the card of 0141 instead of a command that holds its value.
The rule is a request to the model, not a guard: the agent still reads what the user gives it, and a model that ignores the rule can still copy it.
The mechanical guards stay 0141's mask of saved values in tool output and 0281's swap of a pasted token; masking token shapes in tool output and checking a push for private data are separate decisions.
`instructions.test.ts` fails when the rule leaves the prompt.
