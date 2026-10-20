---
title: Routines
description: A Malini routine runs jobs, extension commands, and workflows in order when a trigger fires - when you run it, when a workstream is created, when a frontend resource becomes ready, or on any Malini event.
---

A routine is a list of steps that run in order when its trigger fires.
A step is a [job](/malini/docs/jobs.md), an extension command, or an extension workflow, and a routine holds up to ten steps.

## Triggers

A routine's trigger is a short phrase, its **when**.

| When                                             | Fires                                                     |
| ------------------------------------------------ | --------------------------------------------------------- |
| `when I run it`                                  | Only when you run the routine.                            |
| `when a new workstream is created`               | When a new workstream is created.                         |
| `when a frontend resource becomes ready`         | When a frontend resource of the workstream becomes ready. |
| `when a frontend Docker container becomes ready` | When a frontend Docker resource becomes ready.            |
| `on <channel>`                                   | When Malini emits that event.                             |

### Event triggers

Any Malini event can trigger a routine:

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

This routine runs when a pull request Malini ships is merged.

A routine with an event trigger runs in the background, so every step must be a job.
Each job gets the event channel and its payload as context, and runs in the workstream the event names.
The same event fires a routine once.
An unknown channel or a malformed condition is refused when you save the routine, with the channels Malini knows.

## Trust is earned

A routine has one of three states.

1. **Draft**: it never runs on its own.
2. **Candidate**: every run its trigger starts waits for you to confirm it.
3. **Routine**: it runs unattended.

You promote a routine from one state to the next, and demote it any time.
A routine the agent creates in a chat, and a routine Malini suggests from your repeated prompts, starts as a draft.

## Make one

- On the Jobs page, write the steps and the when.
- Accept a suggestion: Malini notices the prompts you keep repeating and offers a job and a routine.
- Ask the agent in a Malini chat, which saves it with `routines_save` (see [Agent tools](/malini/docs/agent-tools.md)).
