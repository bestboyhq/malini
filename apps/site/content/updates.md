---
title: Updates and compatibility
description: How Malini updates itself, and how the built-in Check compatibility job keeps your jobs and routines working when Malini's events change.
---

## Updates

Malini checks GitHub Releases for a new version on launch, every hour, and when your Mac wakes.
Updates download in the background and install when you quit.
**Restart to Update** in the app menu installs the newest release right away, and **Check for Updates…** checks now.

Malini must run from an Applications folder to update itself; started anywhere else, it offers to move itself there.
Every merged `feat`, `fix`, or `perf` change ships as a release, so updates are small and frequent.

## Compatibility

[Routines](/malini/docs/routines.md) can trigger on Malini's events, and jobs can rely on them.
An update can add, remove, or reshape an event.

After an update, Malini compares its events with the ones the version before it had.
When something changed, it emits `app:updated` with the old and new version and the change: the channels added, the channels removed, and each channel whose payload changed, with its payload type before and after.

Then Malini runs the built-in **Check compatibility** job with that change as context.
The job:

1. reads the current events with `events_list`, and your jobs and routines with `jobs_list` and `routines_list`,
2. finds every routine whose trigger names a changed or removed channel, or filters on a field that moved, and every job whose instructions rely on one,
3. fixes each one with `jobs_save` or `routines_save`, keeping the rest exactly as you wrote it,
4. shows you each edit and waits for your approval before it saves,
5. never deletes a job or a routine, and leaves alone one that no new event can replace,
6. ends with a summary of what it changed and what still needs you.

Check compatibility runs in your newest workstream.
Like every built-in job, you can edit its instructions, and **Reset** brings back the original.

`app:updated` is an event like any other, so a routine can also run `on app:updated`.

## Events reference

The [events reference](/malini/docs/reference/events.md) lists every channel and its payload for the version of Malini these docs describe.
