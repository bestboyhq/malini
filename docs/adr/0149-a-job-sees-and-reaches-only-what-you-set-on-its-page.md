# 0149 - A job sees and reaches only what you set on its page

Status: accepted

## Context

Every job's agent could read every chat: a trigger handed it the whole event, `chat:turn-finished` with your `Outcome:` and `Needs:` included, a Then handed it the report before it, `workstreams_list` showed every chat's report, and its commands could open Malini's database, Claude Code's transcripts and your attachments.
The same job could reach any site and publish through **Open draft**, so a job that read your words could carry them out of your Mac.
The user wants Malini to be the context controller: "No agent should decide it and it also shouldn't be, you know, hard hard-coded for all jobs".
Claude Code's sandbox hides paths from commands and limits their network without a prompt, `Read` deny rules cover its Read tool, and `strictMcpConfig` drops every MCP server but Malini's, which a tracer run confirmed in a job's auto mode.
0136 also sent what you typed for **Somewhere else** to Logdash as `heard_about_detail`; this reverses that part, and the rest of 0136 stands.

## Decision

- Each job definition carries a `JobBoundary` (`src/contract/jobs.ts`), stored in `job_definitions` as `sees_event` (`facts` or `full`), `sees_before`, `sees_chats` (`none`, `starter` or `all`), `sees_attachments` and `reaches_internet`.
  Every job, new or existing, starts at `DEFAULT_JOB_BOUNDARY`: event facts, the job before it, no chats, no attachments, the internet on.
- Only the job's page sets it, under **What it sees** and **What it reaches** (`JobBoundary.svelte`), through `jobs.update-settings`.
  `jobs_save` takes no boundary, and `jobs_run` refuses `context` for a job whose `sees.chats` is `none`.
- Every `EVENT_CATALOG` entry lists its `facts`, the payload fields a job sees of it: ids, statuses, paths and counts, typed against the payload so `pnpm check` fails on a channel without them or a field it does not have.
  A trigger hands a job only those fields unless its `sees_event` is `full`, and the events reference shows them under **A job sees**.
- A Then hands the report before it only when `sees_before` is on; otherwise it names the job that ran before.
  `workstreams_list` returns `null` for `outcome` and `needs` in a job that does not see every chat.
- Main turns a job's boundary into an `AgentBoundary` (`src/lib/chat/platform/agent/boundary.ts`): the attachments folder of every checkout, Malini's database, logs and other chats' plans, minus what the job may see.
  `send_prompt` carries it, protocol 47, and the bridge runs that job in Claude Code's sandbox with `allowWrite: ['/']`, `denyRead` and `Read(...)` denials on those paths and on Claude Code's own transcripts, and `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` unless the job sees every chat (`src/claude/permissions.ts`).
  With the internet off, the sandbox allows no domain, `WebFetch` and `WebSearch` are denied, and `strictMcpConfig` keeps only Malini's MCP server.
- A command that asks to leave the sandbox (`dangerouslyDisableSandbox`) asks you through the `askBeforeLeavingTheSandbox` `PreToolUse` hook, since Electron cannot launch inside it.
- A job **can leak** when it sees your words, through a chat, an attachment, a whole event or a job before it that sees them, and reaches outside, through the internet or a Then of **Open draft** or **Merge** (`src/lib/jobs/domain/job-boundary.ts`).
  The Jobs page marks it **Can leak**, and its page offers **Stop it seeing your words** and **Turn off the internet**.
- Logdash usage counts carry only `heard_about`, the option you picked; what you typed for **Somewhere else** stays in the `heard-about` setting on your Mac.

## Consequences

- What a job reads is a setting you see on its page, not what its agent decides, and a job that can carry your words out says so.
- A job that runs Electron or another tool the sandbox blocks asks you each time it leaves the sandbox; the `ponytail:` on `askBeforeLeavingTheSandbox` names the upgrade, remembering an allow per command.
- A job that needs your chats, such as one that measures compaction on real chats, needs **Every chat** set on its page after this change.
- A new event channel must name its facts, and a fact must never hold what you typed.
- Enforced by `src/lib/jobs/platform/register.test.ts` (a marker in `chat:turn-finished` never reaches a facts-only job, a Then without the job before it gets no report), `src/lib/chat/platform/ship-context.repository.test.ts` (a marker in every chat field never reaches the pull request), `src/lib/chat/platform/agent/service.test.ts` (`jobs_run` refuses context), `src/lib/chat/platform/agent/boundary.test.ts`, `src/lib/jobs/domain/job-boundary.test.ts`, the bridge's `session.test.ts`, `permissions.test.ts` and `protocol.test.ts`, `src/lib/app/domain/heard-about.test.ts`, `tests/e2e/jobs-page.spec.ts`, and `pnpm check` on `EVENT_CATALOG` facts.
