# 0051 - Agents ask Malini to act, and you decide how long a yes lasts

Status: accepted

## Context

0006 keeps commits, pushes and pull requests in Malini, so an agent asked to ship once fell back to writing a script for the user to run.
0029 gave chat agents Malini tools for jobs and routines, but every save and run asked, and nothing could be remembered: `normalizeRememberablePermission` accepted only external reads, so the card never offered **Always allow** for a Malini tool.
The user wanted agents to dispatch Malini's own actions, such as opening a draft pull request when a turn ends, and wanted each person to choose how hands-off that gets: "we shouldn't decide for user upfront".
They also wanted an agent's edit to a trusted job reviewed like code, change by change and editable, so that "always allow edits" plus "always allow runs" never lets an agent rewrite what runs on its own.
Claude Code's own **Always allow** for an MCP tool would allow the whole tool for the session, so allowing one job to run would allow every job.

## Decision

- Bridge protocol 32 adds the `pull_requests_open_draft` platform tool, the `everywhere` approval scope, and an optional `updatedInput` on the `approve` command, which the bridge hands to Claude Code as the tool's input for `mcp__malini__*` tools only (`approvedInput` in `packages/agent-bridge/src/claude/permissions.ts`).
- `pull_requests_open_draft` calls `pull-requests.open-draft` for the session's workstream and returns at once; the merge queue already waits until the workstream is idle, then commits with the turn's `Commit:` line, pushes and opens the draft, and a failure shows in the top bar.
- The agent's instructions and the refusal of `gh pr create` point it at the tool.
- For a Malini tool, the bridge never passes Claude Code's permission suggestions back (`rememberedPermissions`), so Malini alone remembers a yes.
- As an approval enters the pump, `withMaliniApproval` (`src/lib/chat/platform/agent/malini-approvals.service.ts`) replaces the bridge's descriptor with one canonical action: `pull-requests.open-draft`, `jobs.save`, `routines.save`, or `jobs.run:<job id>`, so a yes covers one action and one job, by id.
- A job runs without asking when it is built in, has an active `jobs.run` rule in any scope, or is a step of a routine that is not a draft; an agent edit to such a job, or to a routine that is not a draft, carries a `review` snapshot of the current record instead of an action, so it can never be remembered or auto-approved.
- `agent_permission_rules` and `agent_interactions` take the `everywhere` scope (migration 56); an `everywhere` rule has no workstream and matches every chat after the chat's and the workstream's own rules.
- The card offers **Allow for this chat**, **Allow for this workstream** and **Allow everywhere**; `chat.list-permission-grants` and `chat.revoke-permission-grant` back **Settings > Agent access > Always allowed**, and deleting a job revokes its run rules.
- `jobs_list` returns each job's full instructions instead of 0029's first line, so an agent's edit can keep every line it does not change, and the review shows a real diff.
- A review card shows each changed setting with **Accept** and **Reject**, and the instructions in an editable merge view with a control per change (0052); **Save** sends `allow` with the reviewed input, which `decideAgentApproval` accepts only for a review of the same job or routine id.
- When the saved input is one the user reviewed in that run, the tool result carries `reviewedByUser`, so the agent keeps the user's version instead of proposing a rejected change again, which a real agent did before it.

## Consequences

- "Do X and ship it" is one chat turn, and a user who always allows drafts is never asked again, in any workstream, until they revoke it.
- Every Malini action still asks the first time in every access mode, through 0029's `setMcpPermissionModeOverride`.
- A new Malini action needs a canonical name in `MALINI_ACTION` (`permissions.service.ts`), a case in `assessMaliniApproval`, and a label in `maliniActionLabel`.
- An edit that would change what runs on its own is always seen in full; trust follows grants and routines, so revoking a run rule or demoting the routine to a draft makes the job's edits askable again.
- Enforced by `malini-approvals.service.test.ts`, `permissions.service.test.ts`, the Malini cases in `commands.test.ts` and `service.test.ts`, `migrations.test.ts`, `edit-review.test.ts`, `permissions.test.ts` and `protocol.test.ts` in the bridge, and `tests/e2e/agent-actions.spec.ts`.
