# 0288 - Each workstream has a scratch folder that archive deletes

Status: accepted

## Context

The agent instructions sent scratch work such as builds, logs and copies of the repository to a `mktemp -d` folder, and that folder landed in the Mac's own temp folder, where nothing linked it to a workstream and nothing deleted it.
In one week the user's temp folder grew to 210 GB, 179 GB of it in 134 folders of video frames that chats extracted to look for white flashes, and a day after the user deleted them 787 new `tmp.*` folders held 17.4 GB.
Live `.context` folders held another 7.4 GB of frames in 79 folders, 34,134 images, which 0098 keeps until the archive prunes them.
The user turned down converting archived images to HEIC: "it feels arbitrary", "a lot of hardware load on user machine".
macOS `mktemp -d` takes its folder from `_CS_DARWIN_USER_TEMP_DIR` before `TMPDIR`, so a plain `mktemp -d` ignores `TMPDIR`, while `mktemp -d -p "$TMPDIR"`, Node's `os.tmpdir()` and Python's `tempfile` follow it; the native check of this change found that.
A Unix socket path has 104 bytes on macOS, and tools put sockets in `$TMPDIR`, such as Chromium's `SingletonSocket` and tsx's `tsx-<uid>/<pid>.pipe`, so a scratch path under the default `/var/folders/<..>/T/`, 49 characters before the workstream id, leaves too little room.
Test instances, from the e2e harness, `pnpm --filter malini test` and the `test-malini-app` launcher, run beside the user's Malini with databases of their own, and the e2e specs reuse fixed workstream ids.

## Decision

- `scratch.ts` in `$shared/repositories/platform` owns the folder: `scratchRoot()` is `MALINI_SCRATCH_ROOT`, else `/tmp/malini-<uid>`, and a workstream's folder is `<root>/<workstreamId>`, 42 characters for a real one.
- `makeScratchFolder` makes the root with mode `0700` and refuses one that `lstat` does not show as a folder the user owns, so a link or a folder another user made in `/tmp` first is never used.
- `workstreamEnvironment` (`ports.ts`) makes the folder and sets `TMPDIR` to it for every agent turn and every command run from a chat; when that fails it logs the reason and sets no `TMPDIR`.
- `clearLeftovers` (`teardown.service.ts`) deletes the folder at every archive, save for later and delete, with `removeCheckoutDirResilient`, and the start sweep (`sweepArchivedLeftovers`) deletes the folders of workstreams this database lists as archived.
  It leaves every folder whose id it does not know, since another instance's workstreams share the root.
- The e2e harness, the vitest main project and `.agents/skills/test-malini-app/scripts/malini.mjs` set `MALINI_SCRATCH_ROOT` inside their own profile.
- The agent instructions (`packages/agent-bridge/src/claude/instructions.ts`) and `.agents/rules/agent-behavior.mdc` ask for scratch folders from `mktemp -d -p "$TMPDIR"`, say that Malini deletes `$TMPDIR` when the workstream is archived, and that a video checked frame by frame is extracted there, with only the one contact sheet the agent shows under `.context/`.

## Consequences

- Scratch never outlives its workstream: a restore or a saved-for-later workstream starts with an empty one, and what an agent means to keep goes in `.context`, as 0098 keeps it.
- macOS empties `/tmp` when it restarts, on the user's Mac nothing there predates the last restart, so a live workstream's scratch does not survive a restart either.
- A live workstream's scratch grows until it is archived, as the `ponytail:` note in `scratch.ts` says; the 179 GB came from workstreams that were still live.
- The folder of a deleted workstream that fails to delete stays until the Mac restarts, since no record names it at the next start.
- Each test instance's scratch sits in its profile, so it goes with the profile, and inside an agent's run, with that agent's own scratch.
- Enforced by `scratch.test.ts` (the sweep spares folders of live and unknown workstreams, a linked root is refused), `ports.test.ts` (the environment carries `TMPDIR`), `tests/e2e/named-ports.spec.ts` ('a workstream serves on the ports its repository names, keeps scratch in its own folder and gives both back at archive': the folder exists for a turn and is gone after the archive in the built app) and `instructions.test.ts`.
