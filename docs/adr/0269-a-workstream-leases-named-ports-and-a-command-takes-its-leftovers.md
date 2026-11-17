# 0269 - A workstream leases named ports, and a command takes its leftovers with it

Status: accepted

## Context

After ADR 0268 the user's Mac still spent about 60% of a core and 4 GB on services agents had started and nobody stopped.
A chat ran `docker compose up -d` and `nohup … & disown` from a folder in `/private/tmp`, so ADR 0082's sweep, which looks for paths inside the workstreams folder, never saw them; a `docker run` ClickHouse that bind-mounted an archived checkout had no Compose label, so it ran for ten days.
The user picked stopping a command's process group when it ends, and pointed out that two workstreams fight over the same fixed ports, so what each workstream serves on needs one owner: "if you had one process ... responsible only for ports management there would be no conflicts".
A shared database must stay up across workstreams, and a backend on a branch must not.
The user turned down a fixed block of ten ports per workstream as arbitrary.

## Decision

- **Leftovers of a command.**
  The `run` script in `packages/agent-bridge/src/claude/secrets.ts`, Claude Code's `CLAUDE_CODE_SHELL_PREFIX`, leads the process group of every Bash call.
  Once the command ends, it sends `SIGTERM` to every other process in the group it leads (`pgrep -g $$`), `SIGKILL` to what is left after 3 s, and exits with the command's status.
  A process it does not lead has no group with its pid, so it signals nothing; a `run_in_background` command is its own call, so it keeps running until TaskStop.
- **Containers by their mounts.**
  `linkedWorkstreams` in `lib/stats/platform/running-docker.ts` links a container to a workstream by Malini's label, then Compose's `working_dir`, then every bind mount whose source is inside the workstream's folder.
  The hover card lists a container under its workstream only when exactly one matches; archive, saving for later, deleting and the launch sweep stop a container linked to the folders they clear and to no live workstream.
  A container started from the repository's base checkout mounts no workstream, so every workstream shares it.
- **Named ports.**
  `.malini/workspace.json` lists the ports its workstreams serve on by name: `"ports": ["web", "api"]`, lowercase letters, digits and single dashes, at most 32 (`lib/shared/repositories/domain/port-names.ts`); `extensions` is optional now, so a file can hold only `ports`.
  At each turn and each Run-button command, `workstreamEnvironment` in `lib/shared/repositories/platform/ports.ts` reads the file from the checkout and leases each name the lowest port from 40000 to 48999, below macOS's ephemeral range, that no workstream holds and nothing answers on at `127.0.0.1` or `::1`, in the table `workstream_ports`, whose `port` is unique.
  A name keeps its port until the workstream is archived, saved for later or deleted, which delete its rows in `archiveWorkstreamRecord` and `deleteWorkstream`.
  `send_prompt` carries `MALINI_WORKSTREAM_ID` and `MALINI_PORT_<NAME>` (name in capitals, `-` as `_`) as `environment`, bridge protocol 60, which the session writes to `environment.sh` beside its secrets and the `run` script sources for every command; the Run button's shell gets the same values.
- The agent instructions tell agents to serve on `$MALINI_PORT_<NAME>` with the usual port as the fallback, such as `${MALINI_PORT_WEB:-5173}`, to name a new port in the file, and to run shared services from the base checkout.
- The hover card shows a leased port with its name, `web :40000`, and its button reads "Open web on localhost:40000".
- The task that names a running service sees the leased values in place of the `MALINI_*` variables (`expandVariables` in `lib/stats/platform/running-names.ts`): a native run named `python3 -m http.server "$MALINI_PORT_WEB"` "malini web", and with `40000` in its place Haiku named it "static server" four times out of four.

## Consequences

- An agent's `nohup`, `&` and `disown` no longer outlive their command, so a dev server must start as a background command, which Malini lists and stops.
  A process that calls `setsid` leaves the group and is still only caught by ADR 0082's sweep.
- A Compose project started from outside the workstreams folder with no bind mount into one is still tied to nothing.
- Two workstreams of one repository serve side by side on their own ports, and a script run in the base checkout or the user's terminal keeps its usual port through the fallback.
- A port that something else takes after the lease is not noticed; the lease is only checked when it is made.
- Each Malini profile keeps its own leases, so two profiles can lease the same free port.
- Enforced by `packages/agent-bridge/src/claude/secrets.test.ts` (leftovers stop, a group the script does not lead is never signaled), `lib/stats/platform/running-docker.test.ts` and `leftovers.test.ts` (mounts), `lib/shared/repositories/platform/ports.test.ts` (leases on real SQLite), `lib/stats/platform/running-names.test.ts` (the naming task sees values), and `tests/e2e/named-ports.spec.ts`, where a turn and the Run button see the leased ports, the hover card names one, and archive hands them to the next workstream.
