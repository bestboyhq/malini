---
title: Automations
description: A Malini automation is work you reuse by name - instructions, a model, an effort, and skills - that runs when you run it, when a Malini event fires, or on a schedule, with a Then that runs next, such as opening a draft pull request, and sees and reaches only what you set. Every event keeps what caused it, and Choose a reaction picks what to do about the ones no trigger handles.
---

You never wanted skills.
What you wanted was the outcome: checks green, branch up to date, review answered.
An automation is an outcome you ask for by name.

## What an automation is

An automation has:

- a **name**,
- **instructions**, the prompt the agent runs,
- a **model** and an **effort**,
- its **skills**, so the automation loads only the ones it needs, or every skill that is on when it names none,
- where it **runs**: in this workstream, or in a new one,
- its **When**: only when you run it, or also when a Malini event fires or on a schedule,
- its **Then**: the one automation that runs next, after this one succeeds,
- what it **sees** and **reaches**, which only you set.

Four built-in automations, **Update from main**, **Open draft**, **Merge** and **Capture to the log**, run without an agent: their instructions only say what they do.

## The Automations page

The Automations page swaps the sidebar for its own sections, and **Workstreams** at the top takes you back.

- **Overview**: say what should happen and when, like "When a pull request merges, update CHANGELOG.md and open a draft PR".
  Malini reads the When, the work, and the Then, and drafts the automation for you to adjust and save.
  It also lists your automations, each with its When, its last run, and a switch.
  The automations Malini [suggests](#suggested-automations) and a few recipes sit there too.
- **Activity**: what is running, and every run by day, automation runs and chat turns alike, each holding the calls its agent made to [Malini's tools](/malini/docs/agent-tools.md#see-what-the-agent-did).
  Each reaction Malini chose shows as an **Event** row, which opens to what Malini saw and what it could have done.
- **Explorer**: a [map of Malini](#explorer) and a timeline, to replay the last hour or day and follow what caused what.
- **Recipes**: ready-made automations to start from.

Click an automation to open its own page: what it sees and reaches, its When and how it runs, where it runs, its Then, its recent runs, and its instructions, model, effort and skills.
**Run** asks Malini to run it, **Delete** removes one of yours, and **Reset** brings back a built-in automation's original.

## When an automation runs

An automation runs when you run it.
Give it a **When**, and it also runs when something happens: a pull request merges, a merge stops on conflicts, main changes a file a workstream changed, a workstream is created, an automation fails, or any Malini event.
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

An automation with this When runs when a pull request Malini ships is merged.
The Automations page offers the common triggers by name, such as **A pull request merges**, so you rarely write one by hand.

A triggered run gets the event channel and the payload [it may see](#what-an-automation-sees-and-reaches) as context, and runs in the workstream the event names, or in a new one when the automation runs in a new workstream.
Every event counts, even when its payload repeats an earlier one: open the same workstream twice, and an automation on `pull-requests:workstream-opened` runs for each opening.
The same event starts an automation once, even across a restart: each event Malini logs has its own id, Malini keeps every event for a week, and hands the ones from the last hour it had not finished with to the [Reconciler](#reconciler) again when it starts.
An unknown channel or a malformed condition is refused when you save the automation, with the channels Malini knows.
So is a value a field never takes, such as `run.status is succeded`, with the values it does take, when you write a new When or change one.
A save that keeps its When as it was goes through, so you can still turn off or edit an automation saved with such a value.

### On a schedule

A schedule runs an automation at a time of day, by your Mac's clock:

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

On the Automations page, **On a schedule** in the When picker sets the day and the time, and **Runs in** sets where.

A scheduled automation keeps a place of its own, named after the automation:

- At Home or in an organization, its own [chat that leads work across repositories](/malini/docs/chat.md#chats-above-repositories), which starts workstreams for the work it finds.
- In a repository, its own workstream.
  Before each run, the Schedules rule runs **Update from main** in it when it is behind its base branch, so the automation starts from fresh code.
  When that merge stops on conflicts, **Resolve conflicts** finishes it before the automation starts.
  When Malini cannot merge, because of uncommitted changes or a git operation in progress, the run's agent reads why in its context.

Each run starts a new automation chat there, so the sidebar gains one entry per automation, not one per day.
Archive that chat or workstream, and the next run starts a new one.

The automation runs while Malini runs, with its window open or closed.
When the time comes, Malini's clock logs a **Time reached** event, and the [Reconciler](#reconciler)'s Schedules rule starts the automation on it.
The same time starts the automation once, even across a restart.
When your Mac sleeps or Malini is quit at the time, the automation runs once when they are back, however many times it missed.
A schedule you set runs from the next time on, never for a time that already passed.
While the automation has a run that is queued, still runs or needs you, it skips its time, so two runs never overlap.
A run that waits for your yes holds its time too, unless its schedule started it: then the new time takes its place and asks again.

A scheduled run tells you with a notification when it waits for your yes, when it needs you, when it fails, and when it finishes, with its result.
A run that needs your approval waits for it, so always allow a command it needs, and later runs go on without asking.
A scheduled run gets its schedule and the time it was due as context.

A schedule in a repository or an organization Malini does not have is refused when you save the automation.
**Update from main**, **Open draft**, **Merge** and **Capture to the log** take no schedule: the first three work on the changes of a workstream, and Malini runs the capture once a day itself.

### Off, Ask me first, On its own

An automation with a When runs one of three ways:

1. **Off**: it never starts on its own.
2. **Ask me first**: every run waits for you above the composer of its workstream's chat, or on the Automations page when it has no workstream, with **Run it** and **Skip**.
3. **On its own**: it runs as soon as its trigger fires.

New automations ask first, and a trigger an agent adds starts Off.
The switch on an automation turns it off and back on.
A run that waits for you never holds up its workstream.

## Then

An automation's **Then** is the one automation that runs next, in the same workstream, after this one succeeds, with this automation's result as its context when it [sees the automation before it](#what-an-automation-sees-and-reaches).
An automation that fails, needs you, or is cancelled runs no Then.

**Open draft** and **Merge** are automations, so "open a draft PR" is a Then.
"When a pull request merges, update CHANGELOG.md and open a draft PR" is one automation: its When is `on pull-requests:ship-changed where merged is set`, its instructions update CHANGELOG.md, and its Then is **Open draft**.

A Then that would loop, such as one automation whose Then leads back to itself, is refused when you save it.
A Then runs through the queue like any other automation, so the automation that finished never waits for it.

An automation whose turn ends while only background commands run, such as a dev server, counts as done at once.
When its agent goes on once one of those commands ends, the automation runs again and counts as done at its next end, with that end's result, and Malini commits what it did after the wait under that end's `Commit:` line.
Its Then starts once per run: at once when the automation ended with its report, or else once the automation ends for good, with that last result, since an agent that has not reported yet may go on.
A Then held that way is cancelled when the automation goes on and fails.

### Events or Then

An automation emits `automations:run-started` when its run starts, and `automations:run-finished` when it ends, with its `status`: `succeeded`, `failed` or `cancelled`, and again at its next end when its agent goes on after its background commands.
Trigger other automations on it, such as `on automations:run-finished where run.status is failed`, or use Then for the planned next step.
A run never starts an automation that already ran earlier in its own chain, so a trigger on `automations:run-finished` cannot loop.
`automations:run-changed` still fires for every status a run moves through, but the event log keeps only the start and the finish.

### Chains and repeats

Every event keeps what caused it: the event the [Reconciler](#reconciler) was handling when it happened, or else the automation run or the chat turn at work in its workstream.
So a step of [shipping](#reconciler) a workstream names the event it answered, and the git facts and reads of GitHub that step sets off name that step's event in turn.
Your click on a workstream's pull request bar, and you opening a workstream, start a chain of their own.
The end of a wait while shipping names the event whose step set the wait, and a read of the pull request on GitHub outside any handling is caused by your last click on that bar, or by the work done there since, since the pull request shows what that work pushed.
A **chain** is everything that traces back to one thing you did, such as a prompt you sent or a click on **Merge**, through the events, runs and turns it set off, so the [Explorer](#explorer) can time each step of it.

- An automation asked for again while it still waits or is queued for the same workstream runs once.
  Its row says how often it was asked, such as **Asked 3 times**, and its context gathers every ask.
- The fourth run of the same automation for the same workstream in one chain waits for you [where it runs](#run-an-automation): "It already ran 3 times in one chain of events, so Malini asks before it runs again."
  Retries are fine, so Malini stops a loop without forbidding them.
  The Shipping rule's automations stay out of that count: **Fix attempts before asking you** in Settings bounds them.

## What an automation sees and reaches

Malini decides what each automation's agent may see, from what you set under **What it sees** and **What it reaches** on the automation's page.
Only you change it there: no agent, tool or automation widens it, and a new automation sees no chat.

What it sees:

- **Code and changes**: the workstream's files and its git history, always.
- **The event that started it**, for an automation with an event When: only its facts, the ids, statuses and paths the [events reference](/malini/docs/reference/events.md) lists under **An automation sees**, or the event **in full**, which can hold your messages.
- **The automation before it**: the report of the automation whose Then this automation is.
  Off, the automation only learns which automation ran before it.
- **Your chats**: **None**; **The one that started it**, which lets that chat hand the automation context with `automations_run` and read that chat's plan; or **Every chat**, which also lets it read Malini's database and logs, Claude Code's transcripts and memory, and every chat's `Outcome:` and `Needs:`.
  The files Malini keeps for archived workstreams count as your chats, and stay hidden unless you also turn on **Your attachments** and **Every chat**.
- **Your attachments**: the files you attached to chats, and their transcripts.

What it reaches:

- **Anthropic**, always: Claude runs the automation's agent and sees what the automation sees.
- **GitHub**, through a Then of **Open draft** or **Merge**, or with `gh` while the automation reaches the internet.
- **The internet**: off for every automation you make until you turn it on, and on for the built-in automations. Off, [the sandbox](/malini/docs/chat.md#the-sandbox) lets the automation's commands reach no site but localhost, Claude Code drops its web tools and every MCP server but Malini's, and Malini refuses its own tools that would reach out for the automation: the browser, cloning a repository, starting or messaging a workstream, and running an automation whose internet is on.

An automation runs its commands in [the sandbox](/malini/docs/chat.md#the-sandbox), as every chat does, and the sandbox also hides what the automation may not see from its commands; Claude Code hides it from its Read tool.
Electron, Playwright with its Chromium, file watchers and terminals run inside it, so an automation that runs `pnpm test:e2e` never asks.
What you opened in the sandbox for its repository or everywhere is open for it too.
A command that needs anything else from outside the sandbox asks you first, every time.

An automation that sees your words, through a chat, an attachment, a whole event, or the report of an automation before it that sees them, and reaches outside your Mac, through the internet or a Then that publishes, **can leak**.
The Automations page marks it **Can leak**, and its page says how, with **Stop it seeing your words** and **Turn off the internet** one click away.
**Update from main**, **Open draft**, **Merge** and **Capture to the log** run no agent; the first three write a pull request only from the agent's `Commit:` and `Pull request:` lines, the changed files and the checks that passed, never from what you typed.

## Run an automation

Running an automation is fire and forget.
Every way of starting an automation only asks Malini's automation runner, which starts it when a slot is free, the workstream has no other automation, and its agent is idle.
When it ends, Malini commits what it changed under the `Commit:` line its agent wrote, the way it commits a chat's turn; that line never titles the pull request.
A workstream an agent just started counts as busy until the turn of its first prompt ends, so an automation run there right away waits for that turn.

- Type **/** in the composer to run an automation from a chat.
  It waits above the composer, next to the prompts you queued, and stays there while it runs, with its transcript a click away.
  Once it finishes, it leaves, and its result stays on the automation's page and in **Activity**.
- Run it from the Automations page, in a workstream or a new one.
  A new one shows **Setting up** in the sidebar while Malini updates its branch and installs its dependencies.
- Give it a When, or make it another automation's Then.
- Ask the agent: in a Malini chat it can list, save, and run automations with its [tools](/malini/docs/agent-tools.md).
  It asks before it runs an automation, until you always allow that automation.
  Its edit to an automation that runs without asking waits for your [review](/malini/docs/agent-tools.md#edits-you-review), change by change.

An automation shows where it runs.
Above the composer, a chat lists its workstream's live automations, one line each: first the ones that need you, then the running ones, then the queue, oldest first.
A finished automation leaves the list.
An automation with no workstream, such as a schedule at Home, shows under **In progress** on the Automations page.
The **Automations** icon at the top, beside the sidebar icon, opens that page.
Its dot shows that something needs you or runs, and its tooltip counts them.

An automation that needs you says why at the end of its line: **Conflicts**, **Failed**, **Wants to run**, or **Asks you**.
Click it to go where you make the call: the chat of its workstream, where the question waits above the composer with what you need to decide.
A run that asks you first shows when it runs, what it does, and how its last run went.
Its answers are buttons under it:

- **Run it** and **Skip** for a run that asks you first.
- **Run again**, **Tell its chat**, and **Dismiss** for what [Choose a reaction](#reconciler) asks you, such as "Failed: The docs host timed out."

A run whose agent asks you something opens its transcript, where you answer in the composer.
A run that asks you first before it has a chat, such as the first run of a schedule at Home, opens its automation's page, which shows the same question under **Needs you**.

A question never goes stale: it goes away with its workstream, and a newer question about the same automation, or a newer run of that automation that finishes, replaces it.
Archiving a workstream also cancels its automations that have not finished.
Settings decides how many automations run at once.

## Reconciler

The **Reconciler** is the middleman between an event and what reacts to it: every event Malini emits passes through it, and you can't turn it off.
Nothing in Malini starts work on its own: each start is an event the Reconciler hands to a rule, and only what you do yourself, a prompt or an automation you run, goes straight to your chats and automations.
Each rule names the events it hears, and the Reconciler hands an event to every rule that hears it, so one event can start many things: both Resume and Shipping act on **Malini started**.
A rule that fails on an event leaves it unfinished, and Malini hands the event to the rules again the next time it starts within the hour.
It hands each event to your triggers first, then to its own rules at once:

- **Your triggers** handle the events they name.
- **Thens** start the next automation on the **Automation finished** of a run that succeeded, once per run.
- **Shipping** takes a workstream from your click to merged, one step per event.
  For each event about a workstream it ships, the Reconciler reads that workstream's state fresh, one workstream at a time: its pull request bar, the automations in it whoever started them, `git status` and the last read of GitHub.
  Shipping then takes the one next step: commit and push its work, open the draft, mark it ready, merge main into the branch when GitHub says it is behind or conflicts, re-run failed GitHub Actions jobs once, run **Fix checks** or **Address review** when something blocks the merge, merge, or archive the workstream unless you clicked **Keep**.
  The step's result comes back as an event, **Head moved**, **Branch pushed**, **Merge conflicted**, **Pull request changed** or **Automation finished**, and the next step happens on it; a step that brings nothing back looks again 15 seconds later.
  It hears only logged events: **Button clicked** (your **Draft**, **Merge**, **Cancel** or **Keep** in the pull request bar, **Retry merge** in the chat of the automation a merge stopped on, or **Draft all** or **Merge all** on a chat), **Turn finished**, **Automation finished**, **Pull request changed**, **Time reached**, **Head moved**, **Branch pushed** and **Merge conflicted** while it ships, **Files changed** while a git operation stopped it, **Workstream archived**, and **Malini started**, on which it picks up every workstream it was shipping.
  A merge that stops on conflicts starts **Resolve conflicts** through that automation's own trigger, and Shipping waits for it; with the trigger off, Shipping runs it itself, within **Fix attempts before asking you**, and cancelling it does not start it again.
  Shipping merges main into a workstream itself only while it merges that workstream; before that, **Update from main** does it on its own trigger, in the [mode](#defaults) you picked, Shipping pushes that merge only once **Resolve conflicts** resolved it, and a workstream with no commits of its own fast-forwards instead.
  A change request on a draft starts **Address review** through its own trigger, and Shipping commits and pushes what it changed, once; with the trigger off, the change request waits until you press **Merge**.
  A chat or an automation ships with the **Open draft** or **Merge** automation, whose **Automation finished** moves the workstream on.
  On **Draft all** or **Merge all**, Shipping runs that automation in each workstream the click names, for the chat you clicked on, which hears when a run finishes or fails.
  A wait it sets ends in a **Time reached**: **Retry** after a failed step, 30 seconds at first and twice as long each time, up to 10 minutes, or after a step that brought nothing back, **Checks rerun**, the minute a fix or a re-run gives its failing checks to run again, and **Agent settled**, the 5 seconds after an agent's turn ends that let a prompt you queued start first.
- **Resume** continues the turns a restart cut short when Malini logs **Malini started**, in the chain they belong to, and sends again a prompt Claude had not replied to yet.
  The chat shows each continued turn under a divider, such as **Malini restarted. Back for more**, instead of a prompt from you.
  It also continues a turn a usage limit or an outage paused, on the **Time reached** the pause set, with that event as its cause. See [Limits and outages](/malini/docs/chat.md#limits-and-outages).
- **Deliveries** hears **Turn finished**: it sends the report of every turn a workstream a chat started ends to that chat, with its `Outcome:`, its `Needs:` and the pictures it embeds, and hands each chat what waits for it once its turn ends.
  A turn that ends while only background commands run is a **Turn finished** at once, whose report names the commands it waits on, and the turn that goes on after them is another one when it ends.
  Everything sent to a chat waits in Malini while that chat is on a turn, and arrives as one prompt when the turn ends: reports, prompts another chat sent it with [`workstreams_send`](/malini/docs/agent-tools.md#work-it-started-reports-back), and your answers to its [decisions](/malini/docs/chat.md#decisions).
  What waits survives a restart: on **Malini started**, Resume sends it on once it has continued the turns the restart cut short.
- **Schedules** start an automation on the **Time reached** its schedule names.
- **Compatibility** runs **Check compatibility** on **Malini updated**, once per update. See [Updates](/malini/docs/updates.md#compatibility).

After the rules, the automation **Choose a reaction** looks at what no trigger handled and may need a hand:

- an automation a chat ran finishes or fails,
- a merge stops on conflicts while **Resolve conflicts** is off.

When work already owns the event, **Resolve conflicts** on the conflicts, or Merge taking over a shipping automation that failed, Malini records that it does nothing, and why, without asking the model: every event it looks at leaves a decision, and none is skipped in silence.
Otherwise Malini writes down what it sees, in short lines such as "Run the tests failed in Api work" and "“Api work” is idle", and lists what it could do: do nothing, wake the chat that asked for the work with its report, run the automation again, run **Resolve conflicts**, or ask you.
The model only picks one of them, by number, and Malini checks the pick before it acts: it wakes a chat at most three times about the same work in one chain, and asks you after that.
When the model can't answer, Malini picks by its own rules: it wakes the chat waiting on the work, or else asks you, and never runs an automation.

- **Wake**: the report reaches the chat that asked for the work through Deliveries, beginning "Malini woke you: work you asked for moved on": the chat that ran the automation, or ran the work whose merge stopped on conflicts.
  A chat is never woken only because it works in that workstream.
  When that chat is on a turn, the report waits and arrives with any others when the turn ends.
- **Ask you**: the question waits above the composer of its workstream's chat, which its line [where it runs](#run-an-automation) opens, with a button for each thing Malini could do, marks that automation on the Automations page, and sends a notification titled with the automation and its workstream, which opens the work, or the top-most chat that started it.
- **Run again** asks first, unless the automation runs on its own.

Every pick shows in Activity, with what Malini saw, every choice it had, and who picked: the model, Malini's rules, or you.
The [Explorer](#explorer) shows where each pick came from and what it started.
Choose a reaction runs on Haiku at low effort by default; edit its model and instructions on its page, and [Improve](#improve-name-chats-and-name-services) replays its recent decisions on another one.

## Explorer

**Explorer** draws Malini as one pipeline from left to right: the event log, the [Reconciler](#reconciler) every logged event passes through, and the chats and automations its rules start.
A wire runs back from that work to the event log, since what chats and automations do sets off most of the next events.
**You** sits above the log, and your prompts and the automations you run reach your chats and automations straight along the top.
The workstreams and automations an agent starts with its tools start from its chat, inside the work column.

Every event has one row, named for what it is about and what happened to it, with a label for where it comes from: you, an agent, git, GitHub, Malini or the clock.
**Button clicked**, **Workstream opened**, **Turn finished**, **Tool called**, **Automation started**, **Automation finished**, **Head moved**, **Files changed**, **Branch pushed**, **Merge conflicted**, **Base overlapped**, **Pull request changed**, **Workstream created**, **Workstream archived**, **Malini started**, **Malini updated** and **Time reached** each show how many happened, and **Other** holds the rest.
**Button clicked** is your click on **Draft**, **Merge**, **Cancel** or **Keep** in the pull request bar, on **Retry merge** in the chat of the automation a merge stopped on, or on **Draft all** or **Merge all** on a chat, and **Workstream opened** is you opening a workstream.
In a list, an event starts with that name, such as "Automation finished: Fix checks".

Inside the Reconciler, each rule names the events it hears and counts what it started, and **Choose a reaction** counts its decisions.
Click a rule to see every event it hears and what it started.
Each read of GitHub that finds something new becomes a **Pull request changed** event, and every automation the **Shipping** rule starts names the event behind it as its cause, such as the latest read of that pull request, or your **Button clicked** when no read names it yet.

**Play** replays the last hour, 6 hours or 24 hours: a dot travels along the wires for each event, and **Chats** and **Automations** show what was working at that moment.
The timeline under the map scrubs to any moment.
Click an event to follow its chain: its route lights up on the map, and its steps list in order, each with why it happened, from the event that set it off, such as the **Malini started** behind a turn Malini resumed.
Click a part of the map to list what passed through it.
**Every event** adds the rest, such as file changes, tool calls, and automations starting and finishing.
A chat turn or an automation run opens its transcript.

Only words carry color: failed is red, needs you is blue, merged is purple.
Blue also marks what moves and what you picked.

## Built-in automations

| Automation              | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name chats**          | Names a chat and its workstream from your message, then again from the reply, in three words at most.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Name services**       | Names the commands an agent leaves running, such as a dev server, for the sidebar.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Fix checks**          | Fixes a pull request's failing checks. The [Shipping](#reconciler) rule runs it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Update from main**    | Merges the base branch into the workstream, without an agent. Its trigger runs it in the mode you pick in [Defaults](#defaults): when main conflicts with a workstream or changes a file it changed too, or, on **Always**, whenever main moves past a workstream worked in this week. It waits until main stays put for 30 seconds, no agent or service runs there, nothing is uncommitted, no merge is queued and its pull request has not merged or closed, and a merge with no conflicts stays local until the workstream's next push. A workstream with no commits of its own fast-forwards instead, in every mode. It also runs when you run it, and before a scheduled automation runs in its workstream. It first stops the background commands the workstream's agents left running. |
| **Resolve conflicts**   | Resolves the conflicts of a merge with the base branch. Its trigger runs it when any merge stops on conflicts, **Merge**, **Update from main** or yours; turn it off on its page. With nothing to resolve it finishes without an agent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Address review**      | Answers review comments. Its trigger runs it when a reviewer requests changes on a pull request, and [Shipping](#reconciler) commits and pushes what it changed to the branch, never merging. With its trigger off, Shipping runs it only for a pull request it merges.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Check compatibility** | After an update, fixes automations that rely on changed events. The **Compatibility** rule runs it. See [Updates](/malini/docs/updates.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Update docs**         | Brings a repository's user-facing docs up to date with its code, in a new workstream. Its Then is **Open draft**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Open draft**          | Commits the workstream's changes, pushes its branch, and opens a draft pull request, without an agent. With a pull request already open, it pushes to it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Merge**               | Queues the workstream's pull request to merge, without an agent, the same way **Merge** in the top bar does.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Suggest automations** | Reads the first thing you type after a pull request merges, and suggests an automation when it matches what you asked after an earlier merge. See [Suggested automations](#suggested-automations).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Capture to the log**  | Appends what you typed in a chat, and each turn's `Outcome:` line, to the [second brain](/malini/docs/brain.md)'s log, without an agent, with your secrets taken out. Its trigger runs it when you archive a workstream, and Malini runs it once a day for Home chats.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Write the notes**     | Rewrites the second brain's notes from its log, every Sunday at 18:00, in the Brain workstream, seeing no chat and reaching no internet. Rewrite its instructions to change what the notes are about.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Choose a reaction**   | Picks what Malini does about an event no trigger handles, among choices Malini lists. See [Reconciler](#reconciler).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

**Resolve conflicts**, **Address review**, **Update docs**, **Open draft**, **Merge**, **Capture to the log** and **Write the notes** take a When and a Then like your own automations, and **Update from main** takes a When.
Malini decides when the others run, and their Then stays as it is.
The built-in automations are yours to edit, except where they run; the two brain automations always run in the Brain workstream.
The ones that run without an agent also keep their instructions, model, effort, and skills.
**Reset** brings back the original.

## Defaults

Four built-in automations decide what Malini does without asking you.
Setup asks about them once, on **Pick your defaults**, and Settings, Automations keeps the same switches above its limits.

| Default                     | On                                                                                                                                  | Off                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Resolve merge conflicts** | An agent merges main into the branch and fixes what clashes.                                                                        | Waits for you to press **Merge**.                    |
| **Address review comments** | An agent answers each requested change and pushes to the branch. It never merges.                                                   | Waits for you to press **Merge**.                    |
| **Keep a second brain**     | Sets up the [second brain](/malini/docs/brain.md) and turns on its two automations.                                                 | Captures nothing.                                    |
| **Update from main**        | **Touches my files** merges main in when it reaches your files; **Always** merges it into every workstream you worked in this week. | **Never** leaves your commits alone until **Merge**. |

**Recommended** turns the first three on and sets Update from main to **Touches my files**.
Malini stores no defaults: each switch is its automation's trigger, so a switch and the automation's page always agree.
Settings shows **Recommended** while every trigger matches it, and **Custom** once one does not, including **Ask me first** or a When you wrote yourself; press **Recommended** to put them back.
An install that finished setup before these existed keeps every trigger as it was.

## Improve Name chats and Name services

**Name chats** and **Name services** keep every name they give, with the model and instructions that gave it.
Their page shows the last two weeks: how many names they gave, how many followed every rule of their instructions, and a bar per day.
A band under the bars shows which model and instructions were in use, and a dashed line marks the day they changed.
**Names that broke a rule this week** lists each name that broke one, with the rule it broke.

Malini checks each name against the rules of the automation's built-in instructions:

- **Name chats**: three words at most, no leading verb such as fix or investigating, no punctuation at the end, and no quotes.
- **Name services**: two lowercase words at most, or `task:` and three; no leading verb such as start or run; and not only the tool's name, such as vite.

**Improve** opens experiments that replay the automation's last 12 tasks.
**Today** is what the automation runs now.
**New experiment** copies the experiment you are looking at, so you change its model or its instructions and run it.
Every result lands in one table beside the others, with each name that breaks a rule marked, and each experiment counts how many of its names broke one.
Run an experiment again to see how much its names vary, and delete the ones you are done with.
**Use** makes an experiment what the automation runs from now on, and the automation's page marks that day with the share of names it expects to follow every rule.

An experiment calls the model once per task, through your Claude login, the same way the automation does.

**Choose a reaction** keeps its decisions the same way, so **Improve** replays its recent ones on another model or other instructions, and marks a reply that picks no choice.

## Suggested automations

Malini watches the first thing you type in a workstream after its pull request merges.
When it matches what you typed after an earlier merge in the same repository, Malini suggests an automation under the reply, and on the Overview.
The match is on what you wanted done, not the words you used.
The suggestion shows its When, a pull request merging in that repository, what it does, and that it asks first, in a new workstream.
Hover **Suggested automation** to see which merges it came from.

- **Save it** saves the automation as shown.
- **Edit** lets you change its name, what it does, and whether it asks first, before you save it.
- **Not now** drops the suggestion. Malini remembers it and does not suggest the same thing again.

Nothing runs until you save it.
Malini suggests nothing of its own, such as a changelog after every merge: it only suggests what you already asked for twice.
