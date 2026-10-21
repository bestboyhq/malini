---
title: Chat
description: How a Malini chat runs Claude Code - queue or steer prompts, plan mode, agent access, model and effort per prompt, undo, edit, and fork.
---

Every chat runs your own Claude Code, through the Claude Agent SDK, inside the chat's workstream.

## Queue or steer

- **↵** sends a prompt, or queues it after the current run.
  Edit, reorder, or delete what is queued.
- **⌘↵** steers: it interrupts the turn and sends the prompt now, while background commands keep running.

A run stays open while its background commands and subagents run, and you can stop each one.

## Plan first

Plan mode writes the plan, then **Implement plan** starts the work, with a model of its own if you like.

## Model and effort per prompt

Pick Fable, Opus, Sonnet, or Haiku, and an effort from Low to Max, for every prompt.

## Agent access

- **Auto**, the default, uses Claude Code's auto mode.
- **Sandboxed** edits the workstream and runs commands in a sandbox, and asks for anything else.
- **Full access** never asks.

When the agent asks, approve once, or always for the chat or the workstream.

## Reports

Every turn ends with a report: **Done**, **Done with something deferred**, or **Waiting on you**, with what changed, what was verified, and the commit and pull request titles.
Reports run from a screenshot and one line to the full write-up.
A **Your turn** list, unread marks, a chime, and a notification tell you which workstream needs you.

## Context

- **@** mentions a file, and you can attach or paste images and files.
- Thinking shows inline, step by step, with a diff for every file the chat changed.
- Every edit, write, and read is a file badge: click it for a card with what the edit changed, the file it wrote, or the lines it read.
- The chat follows the reply while you point at a step, and holds still while you point into one you expanded.
- The context window breakdown, your plan usage (five-hour and weekly), and MCP server status are one click from the composer.

## Undo, edit, fork

Every run can be undone.
Edit an earlier message to resend from there, or fork to a new chat while the agent is still busy.
Runs that a restart cut short pick up where they left off the next time Malini opens.

## Skills

A chat loads every Claude Code skill that is on.
Settings, Skills ranks your skills and plugins by how often Claude Code used them, and turns them off in Claude Code's own settings.
A [job](/malini/docs/jobs.md) can narrow its skills to a preset.

## Tools

In a Malini chat the agent also has Malini's own tools: a browser it shares with you, and your jobs, routines, and events.
See [Agent tools](/malini/docs/agent-tools.md).

## Keys

| Key             |                                                        |
| --------------- | ------------------------------------------------------ |
| **↵**           | Send, or queue after the current run                   |
| **⌘↵**          | Steer now, interrupting the run                        |
| **@**           | Mention a file                                         |
| **/**           | Run a job                                              |
| **⌘W**          | Close the chat tab                                     |
| **⌘K**          | Find a chat tab that doesn't fit                       |
| **⌥↑** / **⌥↓** | Move a repository, a workstream, or an inspector panel |
