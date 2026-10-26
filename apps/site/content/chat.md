---
title: Chat
description: How a Malini chat runs Claude Code - queue or steer prompts, plan mode, agent access, model and effort per prompt, undo, edit, and fork.
---

Every chat runs your own Claude Code, through the Claude Agent SDK, inside the chat's workstream.
It keeps running between prompts, so your MCP servers stay connected.
It restarts after 10 idle minutes, when you change the access, mode, report or skills or switch Claude accounts, and when `CLAUDE.md`, your Claude Code settings, `.mcp.json` or the MCP servers in `~/.claude.json` change.

## Chats above repositories

**New chat**, at the top of the sidebar, starts a chat at Home, above every repository.
The **+** on an owner's row starts one for that organization.
Such a chat plans and delegates: it reads Malini's clones of the repositories in its scope, and it never edits code.
It starts a [workstream](/malini/docs/workstreams.md) for each change, with one repository and one prompt, so every decision it makes is a workstream you can see and checks gate every merge.

- It opens at once and sets itself up behind the chat.
  A prompt you send before it is ready waits in the queue, and a setup that fails says why above the chat, with **Retry setup** and **Remove**.
- Its transcript shows the workstreams it started in a **Workstreams** card, each with where it stands, and the top bar counts how many merged and which need you.
  Under that count, the chat lists every workstream it started: lines added and removed while it is open, and when it merged once it lands.
  Click one to go there, or hover it and click its pull request number to open the pull request on GitHub.
- It has no repository, so it shows no **Files**.
  Its inspector opens only for a page its agent opens, in a browser tab beside the chat, and goes away with the last tab.
- A workstream any chat starts sits under its repository in the sidebar, and the chat's row shows a dot for each, archived ones last.
  Hover the chat's row to list them.
  It shows **Started by** with a link back to that chat and the other workstreams it started, and its first prompt says **Prompt from** and names the chat.
- The agent in that workstream knows which chat started it, and reads the checkouts of the other workstreams that chat started.

## Queue or steer

- **↵** sends a prompt, or queues it after the current run.
  Edit, reorder, or delete what is queued.
- A [job](/malini/docs/jobs.md#run-a-job) run from the chat, by you or the agent, waits above the composer with what you queued until it finishes, never among the messages.
- **⌘↵** steers: it interrupts the turn and sends the prompt now, while background commands keep running.
- Steering or stopping keeps what the agent already wrote, marked **Run cancelled**.

A run stays open while its background commands and subagents run, and you can stop each one.
A prompt sent while a run only waits on them takes the run over, and they keep running, unless you changed the access, mode, report or skills: then Claude Code restarts and they stop.
A turn that ends while only background commands run, such as a dev server, shows its report at once and ships its commit.
Whatever closes that run later, stopping it, quitting, a crash or archiving the workstream, leaves it done, and Malini does not resume it on the next start.

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

## Claude accounts

The model picker and Settings show the Claude account Claude Code is signed in to, and **Switch to** moves to another account you used before.
The first switch to an account signs in through your browser.
After that, Malini keeps the account you leave signed in, encrypted on your Mac, so switching back takes one click, and your browser opens only when Claude asks you to sign in again.
A switch applies to Claude Code everywhere, in your terminal too, and each chat moves to the new account with its next prompt.

## Agent access

- **Auto**, the default, uses Claude Code's auto mode.
- **Sandboxed** edits the workstream and runs commands in a sandbox, and asks for anything else.
- **Full access** never asks.

When the agent asks, approve once, or always for the chat, the workstream, or everywhere.
**Settings > Agent access** lists everything you always allow, and **Revoke** takes it back.

When auto mode blocks a call, the chat asks you instead of failing it, with the reason auto mode gave.
**Allow once** lets Claude retry that exact call.
**Always allow** also adds a permission rule for it to your Claude Code settings, so auto mode lets it through from then on.
**Keep blocked** leaves the block in place, and the agent carries on without it.

A chat also answers for the work it started.
When a job it ran in another workstream, a workstream it started, or a workstream started from those, asks for permission or asks a question, the request takes this chat's composer slot, named after the job or workstream it came from.
Several requests wait in one queue and show one at a time, with **‹ 1 of 3 ›** to move between them.
**Open transcript** goes to the asking chat when you want its context.
**Later**, or Escape, folds the queue into a **requests need you** row above the composer, so you can write to this chat, and **Answer** brings it back.
A request takes the composer slot right away, even over a draft, which waits underneath, and a new one brings the queue back after **Later**.

## Reports

Every turn ends with a report: **Done** or **Waiting on you**, with the commit and pull request titles.
What changed and what was verified read as one line each, with an icon for each, and a longer write-up waits under the **Details** row, which says how many words it holds.
Reports run from a screenshot and one line to the full write-up.
Every picture of a report sits in one frame with a tab for each under it, so pictures never stack, and the agent embeds only what you need to see: the variants, the before and after, or one screenshot of what is new.
A note the agent adds after its report, when a background command ends or another chat writes to it, shows below the report, and the report stays the turn's result: its commit, its pull request title and its notification.
A **Your turn** list, unread marks, a sound, and a notification tell you which workstream needs you.

### Next steps

What the agent left for later, or would do next, sits at the bottom of the report.
**Do it now** sends it back to the chat as the next prompt, and **Scratchpad** saves it as an idea in the repository's scratchpad.

### Before and after

When the agent changes something you can see, it captures it before and after, and the report shows the two as one picture.
**Wipe** drags a divider across it, **Flip** switches between the two with a click, and **Diff** paints every changed pixel pink.
Each changed area gets a number, including the ones the agent did not mean to change; click a number to zoom into it, and press Escape to zoom back out.
The expand button opens the picture you see in the gallery.
Recordings play side by side on one timeline: step a frame at a time, slow them to 0.5× or 0.25×, and jump to the moment the agent marked.

### Variants

When you ask for options, or the direction is open, the agent makes two to four variants.
Each variant is a tab under the report's frame, and the before and after sits past a divider; the variant you chose keeps its ring while you look at the evidence.
Click a picture or recording in the frame to open it in the gallery.
A variant can be a picture, a recording that plays on a loop, or an HTML page that runs live, so you can judge motion before you pick.
Pick one, say why if you like, and the agent builds on it; **None fit** asks for new ones.
Every pick stays in the chat as a step, with what lost and why, and the pull request description lists the decisions; click any variant in it to open it in the gallery.
Variants and prototypes stay in the workstream's `.context` folder and never reach your code.
Once you pick one, the agent builds it into the real thing and removes what it replaces.

## Sounds

Malini plays one sound when an agent finishes and another when it needs you: a question, an approval, or a failed run.
**Settings → Sounds** picks each one from the same list: the Malini chime and 16 more that ship with Malini, the same on every Mac.
Play one before you pick it, and the menu stays open while you try others.
**Record a sound…** records up to 3 seconds from your microphone, after macOS asks you to allow it, and **Choose a file…** adds a sound file of up to 5 MB.
Your own sounds join both lists, and **No sound** turns one off.
The trash button beside one of yours removes it once you click **Remove**, and a moment that played it goes back to its default.

## Context

- **@** mentions a file, and you can attach, paste, or drop images, GIFs, screen recordings (mp4, mov, webm), and files, up to 100 MB each.
  Claude reads a video through frames it extracts with ffmpeg.
- Click an image, GIF, or video in a chat to open the gallery: videos play there with their controls, and every image and video of the chat sits in its strip.
  Pinch or Ctrl-scroll to zoom and drag to pan, and click the picture or press Escape to close it.
  Malini keeps a copy of every image and video a chat shows, so it still opens after the agent deletes or moves the file.
- Thinking shows inline, step by step, with a diff for every file the chat changed.
- A tool call's command, file, and duration fade in as they arrive.
- Every edit, write, and read is a file badge: point at it for a card with what the edit changed, the file it wrote, or the lines it read, and click to keep the card open.
- The chat follows the reply while you point at a step, and holds still while you point into one you expanded.
- Point at the gauge or the plug in the composer for the context window breakdown, your plan usage (five-hour and weekly), and the status of your MCP servers, read live from the chat's Claude Code.

## Undo, edit, slice and fork

Every run can be undone.
Edit an earlier message to resend from there, or slice and fork: a new chat starts from the chat as it stood at that run, even while the agent is still busy.
Runs that a restart cut short pick up where they left off the next time Malini opens.

## Skills

A chat loads every Claude Code skill that is on.
Settings, Skills ranks your skills and plugins by how often Claude Code used them, and turns them off in Claude Code's own settings.
A [job](/malini/docs/jobs.md) can name the skills it loads.

## MCP servers

The plug in the composer lists the chat's MCP servers by what fixes them: servers to sign in to, claude.ai connectors to reconnect on claude.ai, servers that failed, and duplicates of a server that already connects.
Servers that work fold into **Ready**, and servers you turned off into **Off**.
When two servers share a name, each shows where it comes from, such as claude.ai or the plugin that ships it.

- **Sign in** opens the server's sign-in page in your browser.
  Once it connects, every open chat reconnects it.
- **Retry** reconnects a server that failed; its error shows under its name.
- **Fix** walks every server that needs you, one at a time: it opens the next sign-in page as soon as the last one connects, retries the failed ones, and lets you skip a server or turn it off.
- **Turn off** adds the server to `deniedMcpServers` in your Claude Code settings, so it leaves every chat, here and in the terminal.
  A chat that is open drops it at once, without a restart, and **Turn on** brings it back the same way.

Settings, MCP servers lists every server a chat in the open workstream connects, grouped by where it comes from: claude.ai connectors, each plugin, your own servers, and the repository's `.mcp.json`.
It opens with what it found last time and updates each row live while its server connects, signs in or fails.
Filter it to the servers that need you or the ones that are off, sign in or retry from there, and switch any server on or off.
The refresh button starts its Claude Code again, for a claude.ai connector you just added on claude.ai.

## Tools

In a Malini chat the agent also has Malini's own tools: a browser it shares with you, and your jobs and events.
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
