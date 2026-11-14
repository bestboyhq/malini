---
title: Updates and compatibility
description: How Malini updates itself, and how the built-in Check compatibility automation keeps your automations working when Malini's events change.
---

## Updates

Malini checks GitHub Releases for a new version on launch, every hour, and when your Mac wakes.
Updates download in the background and install when you quit.
A download that makes no progress for 5 minutes stops, and the next check starts it again.
The bottom of the sidebar is the one place that shows update status, and Malini never opens a dialog about an update.
Once an update is ready, **Restart to update** there installs the newest release right away.
**Check for Updates…** in the app menu checks now, and the sidebar shows it checking, downloading, up to date, or failed with **Retry**, opening the sidebar if you had hidden it.

Malini must run from an Applications folder to update itself; started anywhere else, it offers to move itself there.
Every merged `feat`, `fix`, or `perf` change ships as a release, so updates are small and frequent.
Malini is in beta, and **Help and feedback** at the bottom of the sidebar shows **Beta** with the version you run.

## Claude Code

Malini keeps Claude Code current too.
On launch, every six hours, and when you open the model picker or Settings, Providers, it runs `claude update`, whatever your `autoUpdates` setting says.
The picker checks at most once every five minutes, and lists a new model as soon as the update lands, even while it is open.
A chat keeps the Claude Code it started with until its next prompt, then restarts on the new version and resumes the same conversation.
When Homebrew, winget, apk or mise manages Claude Code, Malini runs that package manager's upgrade itself.
When npm cannot write its global folder, Malini runs `claude install`, which moves Claude Code to its own native install.
When that fails too, the model picker shows **Claude Code 2.1.311 is out**, and the row opens Settings, Providers, where **Try again** runs the update again.
To stop it, start Malini with `MALINI_CLAUDE_UPDATES=off`.

## Compatibility

An [automation's When](/malini/docs/automations.md#when-an-automation-runs) triggers on Malini's events, and its instructions can rely on them.
An update can add, remove, or reshape an event.

After an update, Malini compares its events with the ones the version before it had.
When something changed, it emits `app:updated` with the old and new version and the change: the channels added, the channels removed, and each channel whose payload changed, with its payload type before and after.

Then the [Reconciler](/malini/docs/automations.md#reconciler)'s **Compatibility** rule runs the built-in **Check compatibility** automation with that change as context, once per update.
The automation:

1. reads the current events with `events_list`, and your automations and their triggers with `automations_list`,
2. finds every automation whose trigger names a changed or removed channel, or filters on a field that moved, and every automation whose instructions rely on one,
3. fixes each one with `automations_save`, keeping the rest exactly as you wrote it,
4. shows you each edit and waits for your approval before it saves,
5. never deletes an automation, and leaves alone one that no new event can replace,
6. ends with a summary of what it changed and what still needs you.

Check compatibility runs in your newest workstream.
Like every built-in automation, you can edit its instructions, and **Reset** brings back the original.

`app:updated` is an event like any other, so an automation of yours can also run `on app:updated`.

## Events reference

The [events reference](/malini/docs/reference/events.md) lists every channel and its payload for the version of Malini these docs describe.
