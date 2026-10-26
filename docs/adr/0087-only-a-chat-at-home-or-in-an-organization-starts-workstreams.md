# 0087 - Only a chat at Home or in an organization starts workstreams

Status: accepted

## Context

0061 gave every chat `workstreams_create`, and 0083 nested a started workstream under the listed chat or workstream that started it, at any depth.
In the user's sidebar a Home chat held a workstream that held another, and the user called it "really weird when workstream can have a subworkstream".
Folding a chat's whole lineage one level under it hid the depth but kept it, and the user drew the line at the source: "Chat can have a children, a repository can have a children work stream, but workstream having child work streams? That's a bit extreme", since otherwise "we are drifting into just infinitely nested work streams".
A workstream is one branch in one repository, the unit of work; a chat at Home or in an organization (0070) is where work is planned and handed out.
This changes 0061's offer of `workstreams_create` to every chat, 0083's nesting at any depth with its consequence that a repository workstream shows the work it started under itself, and 0077's walk down the tree; the rest of each stands.

## Decision

- The bridge's `malini` MCP server holds `workstreams_create`, and `workstreams_send` to the workstreams it started (0085), for a lead chat only: `maliniTools` builds it for each run, and `platformTools(request, lead)` in `packages/agent-bridge/src/claude/platform-tools.ts` leaves the tool out, and every other tool's mention of it, when the run's lineage has no `lead`.
  A first try only disallowed the tool, and the agent in a workstream still read `workstreams_create` in `repositories_clone`, `workstreams_list` and `jobs_run` and weighed using it.
- `maliniInstructions` in `packages/agent-bridge/src/claude/instructions.ts` keeps the "Workstreams you start" and "Work you start reports back" bullets, and "start or archive a workstream", for a lead chat only.
  `workElsewhere` tells a workstream's agent to name the repository in its report, for the user to start that work from a chat at Home or in its organization.
- `steerToMalini(lead)` points a refused branch or worktree command (`BRANCH_COMMANDS`), and the hint after a `git clone`, at `workstreams_create` in a lead chat and at the user in a workstream.
- `createWorkstream` in `src/lib/chat/platform/agent/platform-tools.ts` refuses a request from a session whose workstream has no `scope`, so nothing past the bridge records a workstream as started by another.
- `nestStarted` in `src/lib/app/domain/sidebar-tree.ts` puts a workstream directly under the listed chat its `startedBy` names; every other workstream, including one a workstream started before this decision, stays under its repository.
- A chat's composer slot brings up the requests of the workstreams it started directly: `askingChildrenQuery` filters on `startedBy`, and `descendantWorkstreamIds` is gone.
- `Sidebar.svelte` indents three levels at most, and a nested row always names its repository.

## Consequences

- The sidebar is at most a chat, then its work, and the request queue reaches one level down, so neither follows chains or guards against cycles.
- A workstream's agent can no longer start work in another repository, such as a fork; the user starts it from a chat or with the repository's **+**.
- Workstreams an earlier build let a workstream start keep their `startedBy`, list under their repository, and still show as dots and in the hover card on their starter's row.
- Enforced by `browser-tools.test.ts` (only a lead chat's server has or names `workstreams_create`), `instructions.test.ts` (only a lead chat gets its bullet), `permissions.test.ts` (a workstream's refused branch change points at the user), `sidebar-tree.test.ts` (a chat's work sits under it, a workstream's under its repository), `tests/e2e/agent-actions.spec.ts` (a repository workstream's `workstreams_create` is refused and starts nothing, and a Home chat's nests under it) and `tests/e2e/child-requests.spec.ts` (the approval and the question of two workstreams a chat started are answered in that chat).
