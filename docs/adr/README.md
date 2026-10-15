# Architecture decision records

Why malini is built the way it is, one decision per file: `NNNN-kebab-title.md`, with status `accepted`, `superseded by NNNN` or `deprecated`.
A change that makes or reverses a decision writes a new record with the `adr` skill (`.agents/skills/adr`), and an accepted record is never rewritten, only superseded.

| #                                                                     | Decision                                                                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [0001](0001-local-only-desktop-app.md)                                | Local-only Electron app: no backend, GitHub through `gh`, two outbound calls (PostHog usage data, update checks)    |
| [0002](0002-one-typed-contract-between-main-and-renderer.md)          | Sandboxed renderer; every command and event declared once in `$contract`, over two IPC channels and `window.malini` |
| [0003](0003-vertical-domain-slices.md)                                | One folder per domain holding its renderer layers and `platform/`, seen only through its api and platform files     |
| [0004](0004-sqlite-through-node-sqlite.md)                            | One SQLite file through `node:sqlite` in the main process, migrations by `user_version`                             |
| [0005](0005-claude-code-runs-the-agent-loop-in-a-bridge-process.md)   | The user's `claude` runs the loop via the Agent SDK, in a child process with a generated, versioned protocol        |
| [0006](0006-workstreams-are-worktrees-and-malini-owns-git-history.md) | Workstreams are worktrees of a private clone on `malini/<id>`; agents never commit, push or open pull requests      |
| [0007](0007-agent-launched-apps-stay-in-the-background.md)            | Agent-launched apps run with `MALINI_BACKGROUND_WINDOW=1`: one pixel on screen, never focused                       |
| [0008](0008-releases-from-conventional-commit-subjects.md)            | Conventional Commit subjects pick the version; CI signs, notarizes, publishes; packaged builds update themselves    |
| [0009](0009-malini-own-agent-work-runs-as-jobs.md)                    | malini's own agent work (naming chats, shipping fixes) is built-in jobs; the bridge holds no prompt of its own      |
| [0010](0010-skills-reach-an-agent-through-presets.md)                 | Each chat and job loads only the skills of its preset, resolved by main and passed to the SDK's `skills` option     |
