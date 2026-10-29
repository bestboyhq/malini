---
title: What Malini is
description: Malini is a free, open source agentic development environment for builders moving fast. Run as many agents as you want. Malini handles the chores, so you only review pull requests and the gains compound.
---

Malini is agentic development environment for builders moving fast, as a Mac app.
Each task you start is a **workstream**: its own git worktree, its own branch, and its own agent chats.
Agents write the code, and Malini owns git: it commits, opens the pull request, fixes red checks, answers reviews, and merges.
It runs on Claude Code today.

Malini is free and open source under AGPL-3.0.
Malini needs no account and no subscription, and there is no Malini server.
A Bestboy account comes in only if you publish your stats to a [public profile](/malini/docs/profile.md).

## How it works

1. **Start a task.**
   Each task is a workstream: its own git worktree, its own branch, its own chats.
   Start one or start a hundred.
2. **Keep it moving.**
   Queue prompts, plan first if you like.
   Agents write code, and Malini owns git.
3. **Press Draft, then Merge.**
   Malini commits, opens the pull request, fixes red checks, addresses reviews, and merges once GitHub allows.

## What is in the box

- [Workstreams](/malini/docs/workstreams.md): one git worktree and branch per task, which Malini takes from Draft to merged.
- [Chat](/malini/docs/chat.md): chats at Home or for an organization that start workstreams across repositories, queue or steer prompts, plan mode, model and effort per prompt, undo, edit, and fork.
- [Jobs](/malini/docs/jobs.md): work you reuse by name, that runs when you run it or when something happens, with a Then that runs next.
- [Agent tools](/malini/docs/agent-tools.md): the browser, jobs, and events, as tools the agent can call.
- [Extensions](/malini/docs/extensions.md): the inspector, its panels, commands, settings, and workflows.
- [Updates and compatibility](/malini/docs/updates.md): how Malini updates itself and keeps your jobs working.
- [Public profile](/malini/docs/profile.md): share cards of your stats, and a profile at bestboy.dev if you publish them.

## Where your code goes

Your code leaves your Mac only through your own Claude Code, to Anthropic, and the GitHub CLI, to GitHub.
Malini makes three calls of its own: update checks to GitHub Releases, anonymous usage data to Logdash, stored in the EU, and, only after you turn on **Publish my stats**, [the numbers on your profile](/malini/docs/profile.md) at bestboy.dev, with the public catalog of skill and server names it may show.
Usage data counts the days Malini runs and the agent runs it finishes, and names the errors it hits, such as which command failed on which version.
It never contains your code, prompts, paths, keys, or error messages, and Logdash stores no IP address.
Turn it off under Settings, Privacy, Share usage data.

## For agents reading this

Every page of these docs is plain markdown at its URL plus `.md`.
[llms.txt](https://bestboy.dev/malini/llms.txt) lists every page, and [llms-full.txt](https://bestboy.dev/malini/llms-full.txt) holds all of them in one file.
