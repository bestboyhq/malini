---
title: Second brain
description: Malini keeps a second brain - a private GitHub repository, or a folder on this Mac, where what you typed in your chats lands in a log, and a weekly automation turns the log into notes by topic that you read on the Brain page or in Obsidian.
---

Your chats teach you things: what a product needs, which bet paid off, who knows what.
Then you archive them and it is gone.
The second brain keeps it.

## What it is

A git repository named `brain`, private on GitHub under your account, with one workstream of its own named **Brain**.
Its checkout is the brain: Malini appends to it, an agent rewrites its notes, the Brain page reads it, and Obsidian opens it as a vault.

```
brain/
  log/2026-11-06.md      what you typed, one file per day, append-only
  notes/products.md      notes by topic, rewritten as understanding grows
  notes/lessons.md
  notes/open-questions.md
```

The layout says nothing about what you work on.
`log/` holds raw capture and is never rewritten.
`notes/` holds what **Write the notes** makes of it, one file per topic, each point linked back to the log day it came from, such as `[[log/2026-11-06]]`.

## Set it up

Setup's **Pick your defaults** step turns it on with **Recommended**, or with **Keep a second brain** under **Customize**.
Past setup, turn it on under Settings, Brain, **Second brain**, or Settings, Automations, or press **Set up the brain** on the Brain page.

Signed in to GitHub, Malini creates the private repository `<you>/brain` through the GitHub CLI, the way **New repository** does, or uses yours when it already exists and is private.
It refuses a `brain` repository that is public.
Without GitHub, the brain is a git repository in `~/malini/brain` on this Mac only, and stays there: it can't sync with GitHub later.

Turning it on also turns on its two automations.
Turning it off turns them off and keeps the brain.

## Capture to the log

**Capture to the log** runs without an agent, the way **Open draft** and **Merge** do.
Its trigger runs it when you archive a workstream, `on repositories:workstream-removed where archived is set`, and Malini runs it once a day for chats you never archive, such as Home chats.
Deleting a workstream captures nothing.

It appends what you typed in each chat and each turn's `Outcome:` line, under the chat's name and its repository, or Home.
It never copies what the agent wrote, tool results or code.
Before anything is written, it takes out secrets: the values you saved in Settings, Secrets, and anything shaped like a token, a password in a URL, an email address or a home folder path.
A saved secret shorter than four characters stays, since it would mask ordinary words.

Malini remembers the last part of each chat it captured, so a chat lands once and a second capture adds nothing.
The first capture starts from the moment you set the brain up: nothing from before lands in it.

## Write the notes

**Write the notes** is an agent automation that runs every Sunday at 18:00, always in the Brain workstream.
It reads the new log days, then rewrites `notes/`: products, bets, lessons, people, decisions and open questions, or whatever the log calls for.
It never changes `log/`, and Malini puts back any change it makes there.

It sees only the brain: no chat, no attachment, and no internet.
Its instructions are yours to rewrite on its page in Automations, to change what the brain pays attention to.
A GTM engineer might ask for accounts, campaigns and objections instead.
**Run** on its page runs it right away, and so does **Write notes now** on the Brain page before there are any notes.

## Where it goes

Malini commits each capture and each rewrite itself, and pushes them straight to `main` of your private repository, with no pull request.
Before every push it checks again that the repository is private, and pushes nothing to a public one.
Offline, the commits wait on this Mac, and Malini tries again every five minutes.
When GitHub has changes this Mac lacks, Malini rebases onto them once and pushes again; if that fails, the Brain page and Settings, Brain say so, with **Retry**.
Two Macs that capture to the same log day both keep their lines.
A push GitHub denies names the account and the repository, as a pull request does.

Turn off **Sync with GitHub** under Settings, Brain to keep new commits on this Mac; turning it back on pushes what waits.
Your private repository is the only place the brain goes.
Malini sends no chat anywhere else, and the brain reaches GitHub through the GitHub CLI, so Malini makes no new outbound call.

## The Brain page

**Brain** in your profile menu, at the bottom of the sidebar, opens it, and so does **Open the brain** in Settings, Brain.
Its sidebar lists the notes by topic and the log by day, and **Workstreams** takes you back.
A note shows when it was last rewritten, its links to log days open them, and **Linked from** lists the notes that link to the page you read.
The line on top says where the brain is: synced to your repository and when, waiting to push, or on this Mac.
