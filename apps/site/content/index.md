---
title: What Malini is
description: Malini is a free, open source Mac app that runs many Claude Code agents side by side, each in its own git worktree, and takes each one to a merged pull request.
---

Malini is a desktop app for the Mac.
Each task you start is a **workstream**: its own git worktree, its own branch, and its own Claude Code chats.
Agents write the code, and Malini owns git: it commits, opens the pull request, fixes red checks, answers reviews, and merges.

Malini is free and open source under AGPL-3.0.
There is no Malini account, no subscription, and no Malini server.

## How it works

1. **Start a task.**
   Each task is a workstream: its own git worktree, its own branch, its own chats.
   Start one or start a hundred.
2. **Keep it moving.**
   Queue prompts, run jobs, plan first if you like.
   Agents write code, and Malini owns git.
3. **Press Draft, then Merge.**
   Malini commits, opens the pull request, fixes red checks, addresses reviews, and merges once GitHub allows.

## What is in the box

- [Workstreams](/malini/docs/workstreams.md): one git worktree and branch per task, and a merge queue that takes it to merged.
- [Chat](/malini/docs/chat.md): queue or steer prompts, plan mode, model and effort per prompt, undo, edit, and fork.
- [Jobs](/malini/docs/jobs.md): agent work you reuse by name, with five built in.
- [Routines](/malini/docs/routines.md): jobs that run in order when something happens.
- [Agent tools](/malini/docs/agent-tools.md): the browser, jobs, routines, and events, as tools the agent can call.
- [Extensions](/malini/docs/extensions.md): the inspector, its panels, commands, settings, and workflows.
- [Updates and compatibility](/malini/docs/updates.md): how Malini updates itself and keeps your jobs and routines working.

## Where your code goes

Your code leaves your Mac only through your own Claude Code, to Anthropic, and the GitHub CLI, to GitHub.
Malini makes two calls of its own: update checks to GitHub Releases, and anonymous usage data to PostHog.
Usage data says which features are used and which errors happen, and never contains your code, prompts, paths, or keys.
Turn it off under Settings, Privacy, Share usage data.

## For agents reading this

Every page of these docs is plain markdown at its URL plus `.md`.
[llms.txt](https://bestboy.dev/malini/llms.txt) lists every page, and [llms-full.txt](https://bestboy.dev/malini/llms-full.txt) holds all of them in one file.
