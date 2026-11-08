# 0191 - A chat let out of the sandbox stays out after a restart

Status: accepted

## Context

0172 kept **Allow for this chat** on the `ClaudeSession` in memory, so the same chat asked again after Malini restarted.
`pnpm dogfood` restarts Malini on every merge to main, so a chat the user let out asked again many times a day.
The user asked to "keep the exit card's Allow for this chat after a Malini restart".
Malini's database already keeps remembered approvals by scope, Settings, Agent access already lists and revokes them, and 0190 already sends a chat's grants with every `send_prompt`.
The rest of 0172 stands.

## Decision

- **Allow for this chat** on an exit card saves a `session` rule in `agent_permission_rules` whose permission is `RUNS_OUTSIDE`, `{"capability":"outside","resources":[]}`, in `apps/malini/src/lib/chat/platform/permissions.service.ts`.
  `normalizeRequestedPermission` gives every request to leave the sandbox that permission, whatever command it names, and a request that opens what the sandbox blocked keeps its `sandbox` permission.
- Main sends `outsideAllowed: true` with every `send_prompt` of a chat that holds that rule (protocol 50), and the session takes the value of each prompt, so a revoked rule closes the chat at its next prompt.
- `tryAutoApprove` never answers an exit from that rule: the bridge decides, and in plan mode it still asks, as 0172 decided.
- Settings, Agent access lists the rule as **Run commands outside the sandbox** under its chat, and **Revoke** takes it back.

## Consequences

- A chat the user let out runs its exits outside after any number of restarts, until the user revokes it or deletes the chat.
- That chat can read and change anything a command outside can for as long as the rule lives, so Settings is now the one place that closes it.
- A new chat still asks, and an exit card in plan mode still asks in a chat that holds the rule.
- Enforced by `session.test.ts` (an allowed chat runs its exits outside from the first prompt, and asks again once a prompt comes without it), `protocol.test.ts` (`outsideAllowed` must be a boolean), `commands.test.ts` (the rule goes out with the chat's next prompts, a plan-mode exit stays a card, a new chat and a revoked rule get nothing) and `agent-interactions.spec.ts` (Settings lists the rule and **Revoke** removes it).
