---
title: Updates and compatibility
description: How Malini updates itself, and how the built-in Check compatibility job keeps your jobs working when Malini's events change.
---

## Updates

Malini checks GitHub Releases for a new version on launch, every hour, and when your Mac wakes.
Updates download in the background and install when you quit.
The bottom of the sidebar is the one place that shows update status, and Malini never opens a dialog about an update.
Once an update is ready, **Restart to update** there installs the newest release right away.
**Check for Updates…** in the app menu checks now, and the sidebar shows it checking, downloading, up to date, or failed with **Retry**, opening the sidebar if you had hidden it.

Malini must run from an Applications folder to update itself; started anywhere else, it offers to move itself there.
Every merged `feat`, `fix`, or `perf` change ships as a release, so updates are small and frequent.

## Compatibility

A [job's When](/malini/docs/jobs.md#when-a-job-runs) triggers on Malini's events, and its instructions can rely on them.
An update can add, remove, or reshape an event.

After an update, Malini compares its events with the ones the version before it had.
When something changed, it emits `app:updated` with the old and new version and the change: the channels added, the channels removed, and each channel whose payload changed, with its payload type before and after.

Then the [Reconciler](/malini/docs/jobs.md#reconciler)'s **Compatibility** rule runs the built-in **Check compatibility** job with that change as context, once per update.
The job:

1. reads the current events with `events_list`, and your jobs and their triggers with `jobs_list`,
2. finds every job whose trigger names a changed or removed channel, or filters on a field that moved, and every job whose instructions rely on one,
3. fixes each one with `jobs_save`, keeping the rest exactly as you wrote it,
4. shows you each edit and waits for your approval before it saves,
5. never deletes a job, and leaves alone one that no new event can replace,
6. ends with a summary of what it changed and what still needs you.

Check compatibility runs in your newest workstream.
Like every built-in job, you can edit its instructions, and **Reset** brings back the original.

`app:updated` is an event like any other, so a job of yours can also run `on app:updated`.

## Events reference

The [events reference](/malini/docs/reference/events.md) lists every channel and its payload for the version of Malini these docs describe.
