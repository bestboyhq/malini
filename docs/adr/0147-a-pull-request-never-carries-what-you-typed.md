# 0147 - A pull request never carries what you typed

Status: accepted

## Context

[0048](0048-reports-carry-comparisons-variants-and-next-steps.md) turned every variant pick into a line of the pull request's `## Decisions` section, and that line quoted the pick's `Why:` word for word.
A `Why:` is whatever the user typed to the agent, often dictated, and it landed in public pull request descriptions: #63, #66, #98, #103, #115, #121, #124 and #125 on `bestboyhq/malini`.
The user found it in #124 and called it a leak of their conversation.
The pull request title had the same hole one step further down: without a `Pull request:` or `Commit:` line it fell back to the chat's name, the first words of the user's first prompt.
A chat is private by default, and a pull request on a public repository is not.

## Decision

- Pull request metadata is built only from text the agent wrote to ship, or text Malini derives itself: the `Pull request:` and `Commit:` lines, variant labels, passed validation commands, the branch, and the changed files.
- `decisionLine` in `apps/malini/src/lib/chat/domain/variant-pick.ts` writes `B · Bold over A · Calm` and never the pick's reason; the reason still shows in the chat, on the pick step.
- `PullRequestAutomationContext` in `apps/malini/src/lib/shared/repositories/domain/pull-request-metadata.ts` has no `sessionTitle`; a title with no authored line falls back to the branch, then the files changed, then `Update workstream`.

## Consequences

- A pull request reads less like the conversation that made it, by design: the why behind a pick lives in the chat, and the agent can still state it in its own words in its `Pull request:` line or the code.
- Pull requests merged before this change keep the quotes in their descriptions and in GitHub's edit history until someone edits them out and deletes those revisions.
- `ship-context.repository.test.ts` fails when a pick's reason or the chat's name reaches the ship context, and `variant-pick.test.ts` fails when a decision line quotes the reason.
- Anything new added to `PullRequestAutomationContext` must come from agent-authored ship lines or Malini's own derivations, never from a prompt; nothing but review enforces that.
