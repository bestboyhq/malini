# 0056 - Built-in jobs run without an agent, and Resolve conflicts is its own job

Status: accepted

## Context

0055 makes opening a draft a job, so a job is no longer always agent work: some jobs are one thing Malini does, with no model and no tokens.
Update from main was already mostly that: the runner merged the base branch itself and started the agent only when the merge stopped on conflicts.
The user named resolving conflicts as the example of a job an event starts, and conflicts had no event of their own: they showed only as a ship step or a job run.
The merge queue ran Update from main both to merge and to resolve, so one job meant two things.

## Decision

- `isAgentlessJobBuiltin` (`src/contract/jobs.ts`) names the built-ins that never start a chat session: `update-from-main`, `open-draft` and `merge`.
  Their instructions only describe what they do, and `jobs.save-definition` keeps them, their model, effort and skills.
- **Open draft** calls `pull-requests.open-draft` and **Merge** calls `pull-requests.queue-merge` for the run's workstream; both take a trigger and a Then.
- **Update from main** merges the base branch as before.
  When the merge stops on conflicts, it first asks for a **Resolve conflicts** run (`origin: 'then'`, `parentRunId`, the conflicted files as context) and then succeeds.
- **Resolve conflicts** (`resolve-conflicts`) is an agent job with the old conflict instructions; with no merge in progress and no conflict markers it succeeds without starting the agent.
- The merge queue runs Resolve conflicts, not Update from main, for a conflicted merge, and adopts an `origin: 'then'` run whose `parentRunId` is its active job, so it waits for the child instead of starting a second one; its step is `resolving-conflicts`, shown like the other fix jobs as clearing blockers.
- `repositories.pull-workstream` emits `repositories:workstream-merge-conflicted` with `workstreamId`, `baseBranch` and `conflictedPaths` when a merge it starts stops on conflicts, so any job can start on it.
- Migration 57 inserts the Open draft and Merge rows and rewrites Update from main's instructions and effort; `seedBuiltinJobs` adds Resolve conflicts.

## Consequences

- "Do X, then open a draft" is a Then, and the same Open draft job is the agent's tool, the top bar's **Draft** and a step after any job.
- Running Update from main, or Merge, costs no tokens unless there is something only an agent can do.
- Activity shows Update from main and Resolve conflicts as two runs, the second after the first.
- A new agentless built-in needs a case in `isAgentlessJobBuiltin` and in the runner's dispatch, which `pnpm check` enforces through the exhaustive builtin types.
- Enforced by `src/lib/jobs/platform/register.test.ts` (agentless dispatch, the conflict hand-off before the parent finishes, Resolve conflicts without conflicts), `src/lib/pull-requests/domain/merge-queue.test.ts` and `platform/merge-queue.service.test.ts` (Resolve conflicts moves, adoption), `src/lib/shared/repositories/platform/workstreams.test.ts` (the conflict event on a real merge), and `tests/e2e/update-from-main.spec.ts` (a queued merge hands its conflicts to Resolve conflicts).
