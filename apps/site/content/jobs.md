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

## The Jobs page

The Jobs page swaps the sidebar for its own sections, and **Workstreams** at the top takes you back.

- **Overview**: say what should happen and when, like "When a pull request merges, update CHANGELOG.md and open a draft PR".
  Malini reads the trigger, the steps, and what happens at the end, and drafts the job for you to adjust and save.
  Below sit your jobs, each with when it runs, its last run, and a switch, then a few recipes.
- **Activity**: what waits for you, what is running, and every run by day.
- **Routines**: every routine, including chains of several steps, and the ones Malini suggests.
- **Recipes**: ready-made jobs to start from.

Click a job to set it up: when it runs, how, where, what happens when it finishes, its recent runs, and its instructions, model, effort and skills.
**Run** starts it now, **Delete** removes one of yours, and **Reset** brings back a built-in job's original.

## When a job runs

A job runs when you run it, or when something happens: a pull request merges, a workstream is created, dependencies finish installing, a job fails, or any Malini event.
A job with a trigger runs one of three ways:

1. **Off**: it never starts on its own.
2. **Ask me first**: every run waits for you under Activity, with **Run it** and **Skip**.
3. **On its own**: it runs as soon as its trigger fires.

New jobs ask first.
The switch on a job turns it off and back on.
A job's trigger is a [routine](/malini/docs/routines.md) that runs only that job, so it also shows under Routines, and deleting the job deletes it.

## Run a job

- Type **/** in the composer to run a job from a chat.
  Its result lands in that chat.
- Run it from the Jobs page, in a workstream or a new one.
- Give it a trigger, or let a [routine](/malini/docs/routines.md) run it as one of its steps.
- Ask the agent: in a Malini chat it can list, save, and run jobs with its [tools](/malini/docs/agent-tools.md).

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

The built-in jobs are yours to edit, and Malini decides when they run.
**Reset** brings back the original.

## Suggested jobs

Malini notices the prompts you keep repeating and offers to turn them into a job and a routine.
