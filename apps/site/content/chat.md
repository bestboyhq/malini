---
title: Chat
description: How a Malini chat runs Claude Code - queue or steer prompts, plan mode, agent access, model and effort per prompt, undo, edit, and fork.
---

Every chat runs your own Claude Code, through the Claude Agent SDK, inside the chat's workstream.
It keeps running between prompts, so your MCP servers stay connected.
It restarts after 10 idle minutes, when you change the access, mode, report or skills, and when `CLAUDE.md`, your Claude Code settings or `.mcp.json` change.

## Queue or steer

- **↵** sends a prompt, or queues it after the current run.
  Edit, reorder, or delete what is queued.
- **⌘↵** steers: it interrupts the turn and sends the prompt now, while background commands keep running.

A run stays open while its background commands and subagents run, and you can stop each one.
A prompt sent while a run only waits on them takes the run over, and they keep running, unless you changed the access, mode, report or skills: then Claude Code restarts and they stop.

## Run a command from the chat

Every shell code block the agent writes has a **Run** button next to **Copy**.
It sends the command back to the same chat, so the agent runs it in the workstream, under the chat's access level, and the run can be undone like any other.
If the agent is busy, the command waits in the queue.

## Compact the conversation

Type **/** and pick **/compact** to have the chat's Claude Code summarize the conversation so far and free up context.
**/autocompact** shows when Claude Code compacts on its own; add `auto` or a token count to change it.
Type instructions after **/compact** to say what the summary should keep.
A compaction shows in the chat as a step, whether you asked for it or Claude Code ran out of room, and the context gauge drops once it ends.

## Plan first

Plan mode writes the plan, then **Implement plan** starts the work, with a model of its own if you like.

## Model and effort per prompt

Pick Fable, Opus, Sonnet, or Haiku, and an effort from Low to Max, for every prompt.

## Agent access

- **Auto**, the default, uses Claude Code's auto mode.
- **Sandboxed** edits the workstream and runs commands in a sandbox, and asks for anything else.
- **Full access** never asks.

When the agent asks, approve once, or always for the chat or the workstream.

When auto mode blocks a call, the chat asks you instead of failing it, with the reason auto mode gave.
**Allow once** lets Claude retry that exact call.
**Always allow** also adds a permission rule for it to your Claude Code settings, so auto mode lets it through from then on.
**Keep blocked** leaves the block in place, and the agent carries on without it.

## Reports

Every turn ends with a report: **Done** or **Waiting on you**, with the commit and pull request titles.
What changed and what was verified read as one line each, with an icon for each, and a longer write-up waits under **Details**.
Reports run from a screenshot and one line to the full write-up.
A **Your turn** list, unread marks, a chime, and a notification tell you which workstream needs you.

### Next steps

What the agent left for later, or would do next, sits at the bottom of the report.
**Do it now** sends it back to the chat as the next prompt, and **Scratchpad** saves it as an idea in the repository's scratchpad.

### Before and after

When the agent changes something you can see, it captures it before and after, and the report shows the two as one picture.
**Wipe** drags a divider across it, **Flip** switches between the two with a click, and **Diff** paints every changed pixel pink.
Each changed area gets a number, including the ones the agent did not mean to change; click a number to zoom into it, and press Escape to zoom back out.
Recordings play side by side on one timeline: step a frame at a time, slow them to 0.5× or 0.25×, and jump to the moment the agent marked.

### Variants

When you ask for options, or the direction is open, the agent makes two to four variants.
Pick one, say why if you like, and the agent builds on it; **None fit** asks for new ones.
Every pick stays in the chat as a step, with what lost and why, and the pull request description lists the decisions.

## Context

- **@** mentions a file, and you can attach, paste, or drop images, GIFs, screen recordings (mp4, mov, webm), and files, up to 100 MB each.
  Claude reads a video through frames it extracts with ffmpeg.
- Click an image, GIF, or video in a chat to open the gallery: videos play there with their controls, and every image and video of the chat sits in its strip.
- Thinking shows inline, step by step, with a diff for every file the chat changed.
- A tool call's command, file, and duration fade in as they arrive.
- Every edit, write, and read is a file badge: point at it for a card with what the edit changed, the file it wrote, or the lines it read, and click to keep the card open.
- The chat follows the reply while you point at a step, and holds still while you point into one you expanded.
- Point at the gauge or the plug in the composer for the context window breakdown, your plan usage (five-hour and weekly), and the status of your MCP servers, read live from the chat's Claude Code.
- An MCP server that needs you shows its fix in that list: **Sign in** opens the server's sign-in page in your browser, **Retry** reconnects one that failed, and its row shows a check once it connects.

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
| **/**           | Compact the conversation, or run a job                 |
| **⌘T**          | Start a new chat in this workstream                    |
| **⌘N**          | Start a new workstream in this repository              |
| **⌘O**          | Open a folder as a repository                          |
| **⌘,**          | Open Settings                                          |
| **⌘W**          | Close the chat tab                                     |
| **⌘K**          | Find a chat tab that doesn't fit                       |
| **⌥↑** / **⌥↓** | Move a repository, a workstream, or an inspector panel |
