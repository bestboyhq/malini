# 0061 - Agents run Malini through tools, processes through jobs, and every call is logged

Status: accepted

## Context

A user asked an agent in a chat to clone a repository and start a workstream in it, and the agent could not: the `malini` server held only the job, event and draft tools of 0029 and 0053, each bound to the chat's own workstream.
The user drew the line between the two kinds of work: "cloning a repo is not a business process", while merging a pull request is, since it may wait for checks or resolve conflicts, and "jobs are business processes and tools are not".
They want work to keep moving without agents acting on their own: an agent should "never open draft or merge a PR himself unless explicitly asked".
They want to see what agents did in Malini: "a run history", "how something was called", "what was the outcome".
Hiding a repository is fine, removing one is not: "I don't think agents should be able to delete the repo."
0053's `pull_requests_open_draft` was a process exposed as a tool, beside the Open draft job of 0056 that does the same thing.

## Decision

- Bridge protocol 36 adds the platform tools `repositories_list`, `repositories_clone`, `repositories_hide`, `workstreams_list`, `workstreams_create` and `workstreams_archive`, and drops `pull_requests_open_draft`; `jobs_run` takes an optional `workstream`, by id or exact name.
- The two list tools are pre-approved reads.
  Each other new tool asks the first time through 0053's flow, under one canonical action: `repositories.clone`, `repositories.hide`, `workstreams.create` or `workstreams.archive`.
  Migration 59 deletes remembered `pull-requests.open-draft` rules.
- `repositories_clone` connects the repository with `repositories.connect` and clones it with `repositories.create-repository`, waiting up to 40 of the bridge's 60 request seconds; a longer clone keeps going, and the result says `cloned: false`.
  It takes `owner/name` or a URL starting with `https://`, `ssh://`, `file://` or `git@`, so no input reaches `git clone` as an option.
- `workstreams_create` and the job runner's `new-workstream` jobs share `planRepositoryWorkstream`, `clonePlannedRepository` and `createPlannedWorkstream` in `src/lib/shared/repositories/platform/workstream-start.service.ts`; the tool then syncs the base and installs dependencies in the background.
- `workstreams_archive` refuses the chat's own workstream.
  No tool removes a repository or deletes a workstream.
- Opening a draft and merging stay the Open draft and Merge jobs.
  The agent instructions (`packages/agent-bridge/src/claude/instructions.ts`), the tool descriptions and the refusal of `gh pr create` and the newly refused `gh pr merge` say to run them, or set them as a job's Then, only when the user explicitly asked in the chat.
- `repositories:changed` fires after a connect, a clone or a hide, and `syncWorkstreamsHook` reloads repositories and workstreams on it, so the sidebar follows an agent.
- Every platform request, and every Malini approval the user denies, writes a row to `agent_actions` (migration 59): the tool, its input, the approval (`not-needed`, `allowed`, `always-allowed`, `denied`), the status, the output and the times.
  `jobs:agent-action-changed` streams the rows, `jobs.list-agent-actions` returns the latest 200, and **Jobs > Activity** lists them beside job runs, each expanding to its input and result with a link to its chat.

## Consequences

- "Clone this repository, start a workstream, merge it, hide the repository" is four tools and the Merge job, and the user reads every call afterwards in Activity.
- "Only when asked" is an instruction, not a gate: once a user always allows Open draft or Merge, only the agent's instructions keep it from shipping unasked.
- A clone longer than 40 seconds takes a second `repositories_clone` call to wait for it, and `workstreams_create` fails until the clone is done rather than creating a workstream late.
- A new Malini tool needs its name in `platformTools`, a bridge schema, a case in `runPlatformTool`, and, when it writes, a canonical action, a grant label and an approval card headline, which its Activity row reuses.
- `agent_actions` keeps every row; pruning waits until it outgrows what Activity shows, as the `ponytail:` in `agent-actions.repository.ts` says.
- Enforced by `browser-tools.test.ts`, `permissions.test.ts`, `session.test.ts` and `protocol.test.ts` in the bridge, by `service.test.ts`, `malini-approvals.service.test.ts`, `commands.test.ts`, `approval-request.test.ts` and `migrations.test.ts` in the app, and by `tests/e2e/agent-actions.spec.ts`.
