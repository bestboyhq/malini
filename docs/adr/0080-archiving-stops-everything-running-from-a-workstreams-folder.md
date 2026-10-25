# 0080 - Archiving stops everything running from a workstream's folder

Status: accepted

## Context

Archiving promised to stop the commands a workstream's agents left running, but it only asked Claude Code to stop the background tasks it still tracked (`stopWorkstreamBackgroundCommands`).
What those tasks started and let go survived: `workerd` under a stopped `wrangler dev`, an `npm exec electron` app, `vite preview`, a simulator script, and the Docker Compose services an agent brought up, which ADR 0037 lists but archive never stopped.
On the user's Mac six archived workstreams still ran Mongo, ClickHouse, Redis, seven `workerd` and an Electron app, some for five days, and a ClickHouse container kept writing logs into an archived checkout until its folder came back.
These processes are orphans of launchd, so no process tree leads back to Malini, and their working directory is often a checkout already deleted.
What they share is a command line that names a path inside the workstream's folder.

## Decision

- `lib/stats/platform/leftovers.ts` picks the leftovers of a set of folders from one `ps -A -ww -o pid=,ppid=,tty=,args=`: every process whose command line names a path inside one of them and none inside a live workstream, plus its descendants.
  It never picks Malini's own process, its descendants (the agent host, every Claude Code and what it runs) or its ancestors (`pnpm dogfood` run from a checkout), nor a process attached to a terminal, which is the user's own.
- A Docker container is a leftover when its `com.docker.compose.project.working_dir` is inside one of the folders and not inside a live workstream, or when it carries the Malini label of the workstream being archived.
- `WorkstreamRunningMonitor.stopLeftovers` sends the processes `SIGTERM`, then `SIGKILL` to what is still alive after three seconds, runs `docker stop` on the containers, and logs what it stopped.
  It never removes a container or its volumes, so `docker start` brings one back.
- Archiving, saving for later and deleting stop the workstream's leftovers inside the teardown lease, after its background commands stop and before its checkout moves (`guardRunLease` in `src/main/modules.ts`).
- When Malini starts, `registerStats` stops the leftovers of the whole workstreams root, so what a crash, an older build or an archive left behind stops too, the checkout trash included.

## Consequences

- An archived workstream no longer costs CPU, memory or a port, and its folder stays gone.
- A process whose command line names no path, like the `pnpm exec` wrapper around `vite preview`, exits once the child that names one stops; with no such child, it keeps running.
- A command the user runs in their own terminal from a checkout keeps running after archive, from a deleted folder.
- Containers started without Compose and without Malini's label are not tied to a workstream and keep running.
- Archive takes up to the three-second grace longer, and up to `docker stop`'s own timeout when Compose services run.
- Enforced by `lib/stats/platform/leftovers.test.ts` and `tests/e2e/archive-restore.spec.ts`, whose detached process must end with `SIGTERM` when its workstream is archived.
