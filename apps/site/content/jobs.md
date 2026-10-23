---
title: Jobs
description: A Malini job is agent work you reuse by name - instructions, a model, an effort, and the skills it loads - run in a workstream or a new one, with a draft or a merge at the end if you like.
---

You never wanted skills.
What you wanted was the outcome: checks green, branch up to date, review answered.
A job is an outcome you ask for by name.

## What a job is

A job has:

- a **name**,
- **instructions**, the prompt the agent runs,
- a **model** and an **effort**,
- its **skills**, so the job loads only the ones it needs, or every skill that is on when it names none,
- where it **runs**: in this workstream, or in a new one,
- what happens when it **finishes**: nothing, a draft pull request, or a queued merge.

Jobs live on the **Jobs** page.

## Run a job

- Type **/** in the composer to run a job from a chat.
  Its result lands in that chat.
- Run it from the Jobs page, in a workstream or a new one.
- Let a [routine](/malini/docs/routines.md) run it when something happens.
- Ask the agent: in a Malini chat it can list, save, and run jobs with its [tools](/malini/docs/agent-tools.md).
  It asks before it runs a job, until you always allow that job.
  Its edit to a job that runs without asking waits for your [review](/malini/docs/agent-tools.md#edits-you-review), change by change.

The **Job center** shows what is running and what just finished.
Settings decides how many jobs run at once.
It also picks when **Update from main** runs: as main moves, when you open the workstream, or only when you merge.
With many workstreams open, the last two keep Malini from starting an update in every one of them at once.

## Built-in jobs

| Job                     | What it does                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Name chats**          | Names a chat from its first message.                                                                          |
| **Fix checks**          | Fixes a pull request's failing checks. The merge queue runs it.                                               |
| **Update from main**    | Brings the branch up to date with its base. The merge queue runs it.                                          |
| **Address review**      | Answers review comments. The merge queue runs it.                                                             |
| **Check compatibility** | After an update, fixes jobs and routines that rely on changed events. See [Updates](/malini/docs/updates.md). |
| **Update docs**         | Brings a repository's user-facing docs up to date with its code, in a new workstream, as a draft.             |

The built-in jobs are yours to edit.
**Reset** brings back the original.

## Suggested jobs

Malini notices the prompts you keep repeating and offers to turn them into a job and a routine.
