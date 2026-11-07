# 0169 - Checkouts live in ~/malini

Status: accepted

## Context

0006 and 0041 put each repository's clone in `<app data>/repositories/<project id>/base` and each workstream in `<app data>/workstreams/<id>`, and app data is `~/Library/Application Support/malini` (0033).
A checkout is the user's work: they `cd` into it, open it in an editor and run tools on it, while `~/Library` is hidden in Finder and macOS keeps it for files an app manages itself.
The space in "Application Support" makes every command quote the path, and some tools break on it, such as shebangs in Python virtual environments and some Makefiles.
Conductor keeps its checkouts in `~/conductor` and its database in Application Support, and Codex and Cursor keep theirs under the home folder too.
The user asked "shouldnt we use ~/malini? whats the by the book, what users expect?", then, about the 28 workstreams (24 GB) and 3.8 GB of clones already on disk, "mby migrate those aldy existing ones?".
The rest of 0006 and 0041 stands: one private clone per repository with hooks off, one worktree per workstream, and Malini owns git.

## Decision

- `checkoutsHome` in `apps/malini/src/lib/shared/repositories/platform/checkouts-home.ts` puts checkouts in `~/malini`, with `repositories/` and `workstreams/` under it.
  A Malini launched with `--user-data-dir`, as e2e and the `test-malini-app` skill do, keeps them in `<user data>/checkouts`, so tests never touch `~/malini` and always run with checkouts apart from app data.
- `MainContext.checkoutsRoot` carries that folder, and every checkout helper in `src/main/git/paths.ts` takes it.
  The database, settings, logs, the lead space, avatars, extensions and the agent runtime stay in app data.
- Boot runs `moveCheckoutsHome` after it opens the database and before any module registers, and records the finished move as `checkouts.home` in `settings`, so it runs once per folder:
  1. It renames `repositories/`, `workstreams/` and the legacy `projects/` into the new folder, merging into folders already there.
     When a rename fails, as across disks, checkouts stay in app data for that launch and the move tries again at the next.
  2. It runs `git worktree repair` from each base repository for every checkout, trashed ones included, whose `.git` file or admin `gitdir` still names the old folder, which also covers repositories opened from a folder outside app data.
  3. It rewrites `workstreams.path`, `projects.repo_path`, `connected_repositories.local_path`, `docker_containers.cwd`, `workstream_opened_files.path`, `mcp_server_listings.folder` and `mcp_server_folder_offs.folder`.
  4. It renames Claude Code's `projects/<folder>` records under `CLAUDE_CONFIG_DIR` or `~/.claude`, each named after its folder with every character but letters and digits as `-`.
  5. It leaves a symlink at each old folder, so an absolute path in a transcript, terminal or script still opens.
  6. It removes the install marker of each active workstream it moved and lists them as `checkouts.reinstall` in `settings`, since pnpm's bin shims embed the old absolute path and an install rewrites them.
     Once the window opens, `reinstallMovedCheckouts` runs `repositories.provision-dependencies` for each in turn and drops each from the list once its install settles, so a launch after a quit finishes the rest.
- `checkouts` joins the app data folders an agent and an install may read (`READABLE_APP_DATA`, `READABLE_BY_INSTALLS`).
- `sanitizeFailureDetail` hides paths under `~/malini/workstreams` and `~/malini/repositories`, as it hides the old ones.

## Consequences

- Checkouts show in Finder, and their paths carry no space.
- Claude Code resumes a chat by its id after the move, with or without step 4; step 4 keeps its records beside the new folder, where `claude --continue` and its session list look.
- Per-folder settings Claude Code keeps in `~/.claude.json` under the old paths stay there, since Claude Code rewrites that file while it runs; Malini's own MCP choices move with its tables.
- The old folders stay as symlinks until the user removes them; nothing in Malini reads them.
- Choosing another folder is not offered yet.
- Enforced by `checkouts-home.test.ts` on real git, SQLite and folders: the move, the symlinks, worktrees that survive `git worktree prune` once the symlinks are gone, the rewritten rows, the renamed records, the forgotten installs, a second launch that moves nothing, and a reinstall that a later launch finishes after a quit.
  `checkout-trash.spec.ts` and `stranded-checkout.spec.ts` run e2e with checkouts in `<user data>/checkouts`.
