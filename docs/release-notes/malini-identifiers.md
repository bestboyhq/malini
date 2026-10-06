# malini identifiers

smack is now malini.
Every stored name moved from `smack` to `malini`, and almost everything moves itself on the first launch.
One file needs a hand.

## Before the first launch

Quit smack.
On its first start, malini moves the smack data folder into its own, and it refuses to start while smack still runs.
Quitting also stops the containers smack started, which malini would not recognize.

## What you do by hand

Rename the extension configuration file in each of your own repositories that has one.
It is tracked in your repository, so malini does not move it for you:

1.  Move it: `mkdir -p .malini && git mv .smack/workspace.json .malini/workspace.json` (or `.core/workspace.json` from before smack).
2.  Inside it, replace `smack.repository` (or `core.repository`) with `malini.repository`.
3.  Commit the change.

Until you do, malini reads no extension configuration for that repository and uses the defaults.

## What upgrades itself

- **App data folder.** `~/Library/Application Support/smack` becomes `~/Library/Application Support/malini`, and `smack.sqlite` becomes `malini.sqlite`.
  The recorded checkout paths and the git links between each checkout and its repository follow the folder.
- **Provider sign-ins.** The credentials smack sealed with its own keychain key are read once and sealed again with the key of malini.
  A packaged build cannot read them, so there you sign in again in Settings.
- **Database.** The database migrates to schema version 32.
  Checkpoint, run and baseline refs move to `refs/malini/`, and attachment paths to `.malini/`.
- **Branches.** New workstreams branch as `malini/<id>`.
  Existing workstreams keep their `smack/<id>` or `agentic/<id>` branches and keep working.
- **Checkpoints.** Refs under `refs/smack/` and `refs/core/` move to `refs/malini/` in each repository the first time malini touches them.
- **Worktree folders.** `.smack/` and `.core/` agent attachments and sandboxes move to `.malini/` in each worktree when malini opens it.
- **App settings.** Drafts, queued prompts, model choices, panel sizes, extension state and settings, and the last open page move to their `malini.` names before the window loads.
  The order of the inspector panels resets to the default.
- **Transcripts.** Earlier chats keep their issue references and context handoffs.

There is no way back: smack cannot use the moved data.
