---
title: Jobs
description: A Malini job is work you reuse by name - instructions, a model, an effort, and skills - that runs when you run it or when a Malini event fires, with a Then that runs next, such as opening a draft pull request.
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
- its **When**: only when you run it, or also when a Malini event fires,
- its **Then**: the one job that runs next, after this one succeeds.

Three built-in jobs, **Update from main**, **Open draft**, and **Merge**, run without an agent: their instructions only say what they do.

## The Jobs page

The Jobs page swaps the sidebar for its own sections, and **Workstreams** at the top takes you back.

- **Overview**: say what should happen and when, like "When a pull request merges, update CHANGELOG.md and open a draft PR".
  Malini reads the When, the work, and the Then, and drafts the job for you to adjust and save.
  It also lists your jobs, each with its When, its last run, and a switch.
  The jobs Malini [suggests](#suggested-jobs) and a few recipes sit there too.
- **Activity**: what waits for you, what is running, and every run by day.
  **Waiting for you** holds the runs that ask you first and the runs that need you.
- **Recipes**: ready-made jobs to start from.

Click a job to open its own page: its When and how it runs, where it runs, its Then, its recent runs, and its instructions, model, effort and skills.
**Run** asks Malini to run it, **Delete** removes one of yours, and **Reset** brings back a built-in job's original.

## When a job runs

A job runs when you run it.
Give it a **When**, and it also runs when something happens: a pull request merges, a merge stops on conflicts, a workstream is created, a job fails, or any Malini event.

A When is one event trigger:

```text
on <channel> [where <path> is <value> | <path> is set [and ...]]
```

- `<channel>` is an event channel, `<domain>:<event>`, such as `pull-requests:ship-changed`.
  The [events reference](/malini/docs/reference/events.md) lists every channel and its payload.
- `where` filters on the event's payload.
  `<path>` is a field name, with dots for nested fields.
- `<path> is <value>` matches when the field equals the value.
- `<path> is set` matches when the field is present and not null.
- Join conditions with `and`; all of them must match.

```text
on pull-requests:ship-changed where merged is set
```

A job with this When runs when a pull request Malini ships is merged.
The Jobs page offers the common triggers by name, such as **A pull request merges**, so you rarely write one by hand.

A triggered run gets the event channel and its payload as context, and runs in the workstream the event names, or in a new one when the job runs in a new workstream.
The same event starts a job once.
An unknown channel or a malformed condition is refused when you save the job, with the channels Malini knows.

### Off, Ask me first, On its own

A job with a When runs one of three ways:

1. **Off**: it never starts on its own.
2. **Ask me first**: every run waits for you under **Activity**, in **Waiting for you**, with **Run it** and **Skip**.
3. **On its own**: it runs as soon as its trigger fires.

New jobs ask first, and a trigger an agent adds starts Off.
The switch on a job turns it off and back on.
A run that waits for you never holds up its workstream.

## Then

A job's **Then** is the one job that runs next, in the same workstream, after this one succeeds, with this job's result as its context.
A job that fails, needs you, or is cancelled runs no Then.

**Open draft** and **Merge** are jobs, so "open a draft PR" is a Then.
"When a pull request merges, update CHANGELOG.md and open a draft PR" is one job: its When is `on pull-requests:ship-changed where merged is set`, its instructions update CHANGELOG.md, and its Then is **Open draft**.

A Then that would loop, such as one job whose Then leads back to itself, is refused when you save it.
A Then runs through the queue like any other job, so the job that finished never waits for it.

### Events or Then

A job emits `jobs:run-changed` each time its run waits for you, is queued, starts, needs you, or finishes.
Trigger other jobs on it, such as `on jobs:run-changed where run.status is failed`, or use Then for the planned next step.
A run never starts a job that already ran earlier in its own chain, so a trigger on `jobs:run-changed` cannot loop.

## Run a job

Running a job is fire and forget.
Every way of starting a job only asks Malini's job runner, which starts it when a slot is free, the workstream has no other job, and its agent is idle.

- Type **/** in the composer to run a job from a chat.
  Its result lands in that chat.
- Run it from the Jobs page, in a workstream or a new one.
- Give it a When, or make it another job's Then.
- Ask the agent: in a Malini chat it can list, save, and run jobs with its [tools](/malini/docs/agent-tools.md).
  It asks before it runs a job, until you always allow that job.
  Its edit to a job that runs without asking waits for your [review](/malini/docs/agent-tools.md#edits-you-review), change by change.

The **Job center** shows what is running and what just finished.
Settings decides how many jobs run at once.
It also picks when **Update from main** runs: as main moves, when you open the workstream, or only when you merge.
With many workstreams open, the last two keep Malini from starting an update in every one of them at once.

## Built-in jobs

| Job                     | What it does                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Name chats**          | Names a chat from its first message.                                                                                                                                                       |
| **Name services**       | Names the commands an agent leaves running, such as a dev server, for the sidebar.                                                                                                         |
| **Fix checks**          | Fixes a pull request's failing checks. The merge queue runs it.                                                                                                                            |
| **Update from main**    | Merges the base branch into the workstream, without an agent. When the merge stops on conflicts, it hands them to **Resolve conflicts**. The merge queue and Settings decide when it runs. |
| **Resolve conflicts**   | Resolves the conflicts of a merge with the base branch. The merge queue and **Update from main** run it, and with nothing to resolve it finishes without an agent.                         |
| **Address review**      | Answers review comments. The merge queue runs it.                                                                                                                                          |
| **Check compatibility** | After an update, fixes jobs that rely on changed events. See [Updates](/malini/docs/updates.md).                                                                                           |
| **Update docs**         | Brings a repository's user-facing docs up to date with its code, in a new workstream. Its Then is **Open draft**.                                                                          |
| **Open draft**          | Commits the workstream's changes, pushes its branch, and opens a draft pull request, without an agent. With a pull request already open, it pushes to it.                                  |
| **Merge**               | Queues the workstream's pull request to merge, without an agent, the same way **Merge** in the top bar does.                                                                               |

**Update docs**, **Open draft**, and **Merge** take a When and a Then like your own jobs.
Malini decides when the others run, and their Then stays as it is.
The built-in jobs are yours to edit, except where they run.
The ones that run without an agent also keep their instructions, model, effort, and skills.
**Reset** brings back the original.

## Improve Name chats and Name services

**Name chats** and **Name services** keep every name they give, with the model and instructions that gave it.
Their page shows the last two weeks: how many names they gave, how many followed every rule of their instructions, and a bar per day.
A band under the bars shows which model and instructions were in use, and a dashed line marks the day they changed.
**Names that broke a rule this week** lists each name that broke one, with the rule it broke.

Malini checks each name against the rules of the job's built-in instructions:

- **Name chats**: three words at most, no leading verb such as fix or investigating, no punctuation at the end, and no quotes.
- **Name services**: two lowercase words at most, or `task:` and three; no leading verb such as start or run; and not only the tool's name, such as vite.

**Improve** opens experiments that replay the job's last 12 tasks.
**Today** is what the job runs now.
**New experiment** copies the experiment you are looking at, so you change its model or its instructions and run it.
Every result lands in one table beside the others, with each name that breaks a rule marked, and each experiment counts how many of its names broke one.
Run an experiment again to see how much its names vary, and delete the ones you are done with.
**Use** makes an experiment what the job runs from now on, and the job's page marks that day with the share of names it expects to follow every rule.

An experiment calls the model once per task, through your Claude login, the same way the job does.

## Suggested jobs

Malini notices the prompts you keep repeating and suggests turning them into a job, on the Overview.
**Make it a job** saves a job from the prompt, which you then give a When and a Then, and **Dismiss** drops the suggestion.
