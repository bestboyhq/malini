---
title: Jobs
description: A Malini job is work you reuse by name - instructions, a model, an effort, and skills - that runs when you run it, when a Malini event fires, or on a schedule, with a Then that runs next, such as opening a draft pull request. Every event keeps what caused it, and Reconcile events picks what to do about the ones no trigger handles.
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
- its **When**: only when you run it, or also when a Malini event fires or on a schedule,
- its **Then**: the one job that runs next, after this one succeeds.

Three built-in jobs, **Update from main**, **Open draft**, and **Merge**, run without an agent: their instructions only say what they do.

## The Jobs page

The Jobs page swaps the sidebar for its own sections, and **Workstreams** at the top takes you back.

- **Overview**: say what should happen and when, like "When a pull request merges, update CHANGELOG.md and open a draft PR".
  Malini reads the When, the work, and the Then, and drafts the job for you to adjust and save.
  It also lists your jobs, each with its When, its last run, and a switch.
  The jobs Malini [suggests](#suggested-jobs) and a few recipes sit there too.
- **Activity**: what waits for you, what is running, and every run by day, job runs and chat turns alike, each holding the calls its agent made to [Malini's tools](/malini/docs/agent-tools.md#see-what-the-agent-did).
  **Waiting for you** holds the runs that ask you first, the runs that need you, and what [Reconcile events](#reconcile-events) asks you.
  Each thing Reconcile events did shows as an **Event** row, which opens to what Malini saw and what it could have done.
- **Explorer**: a [map of Malini](#explorer) and a timeline of events, to replay the last hour or day and follow what caused what.
- **Recipes**: ready-made jobs to start from.

Click a job to open its own page: its When and how it runs, where it runs, its Then, its recent runs, and its instructions, model, effort and skills.
**Run** asks Malini to run it, **Delete** removes one of yours, and **Reset** brings back a built-in job's original.

## When a job runs

A job runs when you run it.
Give it a **When**, and it also runs when something happens: a pull request merges, a merge stops on conflicts, a workstream is created, a job fails, or any Malini event.
Or it runs [on a schedule](#on-a-schedule), such as every weekday at 9:00.

A When is one event trigger, or one schedule:

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
The same event starts a job once, even across a restart: Malini keeps every event for a week, and hands the ones it had not finished with to the triggers again when it starts.
An unknown channel or a malformed condition is refused when you save the job, with the channels Malini knows.

### On a schedule

A schedule runs a job at a time of day, by your Mac's clock:

```text
every <day | weekday | monday … sunday> at <HH:MM> [in <owner> | in <owner>/<repository>]
```

- `every day`, `every weekday` (Monday to Friday), or one day of the week, such as `every monday`.
- `at` takes a 24-hour time, such as `09:00` or `17:30`.
- `in` picks where it runs: an organization or a user, such as `in bestboyhq`, or a repository, such as `in bestboyhq/malini`.
  Without `in`, it runs at Home, above every repository.

```text
every weekday at 09:00 in bestboyhq/malini
```

On the Jobs page, **On a schedule** in the When picker sets the day and the time, and **Runs in** sets where.

A scheduled job keeps a place of its own, named after the job:

- At Home or in an organization, its own [chat that leads work across repositories](/malini/docs/chat.md#chats-above-repositories), which starts workstreams for the work it finds.
- In a repository, its own workstream.
  Before each run, Malini merges the base branch into it, so the job starts from fresh code.
  When it cannot, because of uncommitted changes or conflicts, the run's agent reads why in its context.

Each run starts a new job chat there, so the sidebar gains one entry per job, not one per day.
Archive that chat or workstream, and the next run starts a new one.

The job runs while Malini runs, with its window open or closed.
When your Mac sleeps or Malini is quit at the time, the job runs once when they are back, however many times it missed.
A schedule you set runs from the next time on, never for a time that already passed.
While the job's last run waits for you, is queued, or still runs, it skips its time, so two runs never overlap.

A scheduled run tells you with a notification when it waits for your yes, when it needs you, when it fails, and when it finishes, with its result.
A run that needs your approval waits for it, so always allow a command it needs, and later runs go on without asking.
A scheduled run gets its schedule and the time it was due as context.
The [Job center](#run-a-job) lists each scheduled job under **Upcoming** with the time it runs next.

A schedule in a repository or an organization Malini does not have is refused when you save the job.
**Update from main**, **Open draft**, and **Merge** take no schedule, since they work on the changes of a workstream.

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

### Chains and repeats

Every event keeps what caused it: the job run or the chat turn at work in its workstream.
What the merge queue reports about a workstream, a read of its pull request on GitHub or a step of the queue, is caused by the work last done there, however long ago that ended.
A **chain** is everything that traces back to one thing you did, such as a prompt you sent, through the events, runs and turns it set off.

- A job asked for again while it still waits or is queued for the same workstream runs once.
  Its row says how often it was asked, such as **Asked 3 times**, and its context gathers every ask.
- The fourth run of the same job for the same workstream in one chain waits for you under **Waiting for you**: "It already ran 3 times in one chain of events, so Malini asks before it runs again."
  Retries are fine, so Malini stops a loop without forbidding them.
  The merge queue's jobs stay out of that count: **Fix attempts before asking you** in Settings bounds them.

## Run a job

Running a job is fire and forget.
Every way of starting a job only asks Malini's job runner, which starts it when a slot is free, the workstream has no other job, and its agent is idle.
A workstream an agent just started counts as busy until the turn of its first prompt ends, so a job run there right away waits for that turn.

- Type **/** in the composer to run a job from a chat.
  It waits above the composer, next to the prompts you queued, and stays there while it runs, with its transcript a click away.
  Once it finishes, it leaves, and the **Job center** keeps its result.
- Run it from the Jobs page, in a workstream or a new one.
  A new one shows **Setting up** in the sidebar while Malini updates its branch and installs its dependencies.
- Give it a When, or make it another job's Then.
- Ask the agent: in a Malini chat it can list, save, and run jobs with its [tools](/malini/docs/agent-tools.md).
  It asks before it runs a job, until you always allow that job.
  Its edit to a job that runs without asking waits for your [review](/malini/docs/agent-tools.md#edits-you-review), change by change.

The **Job center** shows what is running and what just finished.
Under **Upcoming**, it lists every scheduled job that is not off, soonest first, with when it runs next, where it runs, and whether it asks you first (**Asks first**).
Click one to open its job.
With nothing running or waiting, the Job center says when the next one runs, such as "next at 09:00 today".
Settings decides how many jobs run at once.
It also picks when **Update from main** runs: as main moves, when you open the workstream, or only when you merge.
With many workstreams open, the last two keep Malini from starting an update in every one of them at once.

## Reconcile events

A trigger is a rule you wrote, and it handles the events it names.
**Reconcile events** looks at what no trigger handled and may need a hand:

- a turn ends in a workstream a chat started,
- a job a chat ran finishes or fails,
- a merge stops on conflicts that nobody in Malini is resolving.

Malini writes down what it sees, in short lines such as "“Api analytics” needs you: Pick the Logdash project" and "“Move apps to Logdash” is idle", and lists what it could do: do nothing, wake the chat that started the work with the turn's report, run the job again, run **Resolve conflicts**, or ask you.
The model only picks one of them, by number, and Malini checks the pick before it acts: it wakes a chat at most three times about the same work in one chain, and asks you after that.

- **Wake**: the report arrives in the chat that started the work as a prompt from that workstream, beginning "Malini woke you".
  When that chat is on a turn, the report waits and arrives with any others when the turn ends.
  The agent answers its workstreams with [`workstreams_send`](/malini/docs/agent-tools.md#work-it-started-reports-back).
- **Ask you**: the question waits under **Waiting for you** in Activity, with a button for each thing Malini could do, counts on the Jobs badge, and sends a notification.
- **Run again** asks first, unless the job runs on its own.

Every pick shows in Activity, with what Malini saw, every choice it had, and who picked: the model, Malini's rules, or you.
The [Explorer](#explorer) shows where each pick came from and what it started.
Reconcile events runs on Haiku at low effort by default; edit its model and instructions on its page, and [Improve](#improve-name-chats-and-name-services) replays its recent decisions on another one.
Turn it off in Settings, Jobs, **Reconcile events**.

## Explorer

**Explorer** draws Malini as one loop: work in chats and jobs makes events, the event log keeps them, listeners react, and what they start runs as new work.
**You**, **Git**, **GitHub** and **Malini** sit where events come from.
Each kind of event has a row in the event log with how many happened, and each listener shows what it started: Reconcile events, your triggers, Thens, the merge queue, schedules, and **Resume**, which picks up the turns a restart cut short.
The merge queue polls pull requests on GitHub, and each read that finds something new becomes a **Pull request** event, so every job the queue starts comes from that event, on the map and in its chain.
A wire straight from GitHub to the merge queue marks a job it started without one, such as **Update from main** in a workstream with no pull request.

**Play** replays the last hour, 6 hours or 24 hours: a dot travels along the wires for each event, and **Chats** and **Jobs** show what was working at that moment.
The timeline of events under the map scrubs to any moment.
Click an event to follow its chain: its route lights up on the map, and its steps list in order, each with why it happened.
Click a part of the map to list what passed through it.
**Every event** adds the rest, such as file changes and each status a run moves through.
A chat turn or a job run opens its transcript.

Only words carry color: failed is red, needs you is amber, merged is purple.
Blue marks what moves and what you picked.

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
| **Reconcile events**    | Picks what Malini does about an event no trigger handles, among choices Malini lists. See [Reconcile events](#reconcile-events).                                                           |

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

**Reconcile events** keeps its decisions the same way, so **Improve** replays its recent ones on another model or other instructions, and marks a reply that picks no choice.

## Suggested jobs

Malini notices the prompts you keep repeating and suggests turning them into a job, on the Overview.
**Make it a job** saves a job from the prompt, which you then give a When and a Then, and **Dismiss** drops the suggestion.
