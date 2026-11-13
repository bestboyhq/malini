# 0242 - No setup screen: Malini opens on the picker and installs its own tools

Status: accepted

## Context

Setup had grown to five steps before the first repository: tools (0218), sounds, the sidebar (0197), defaults (0179) and where you heard about Malini (0136, 0151), then the picker (0163).
In the 14 days before this decision Logdash saw 7 new installs, 3 of them picked a repository and 1 sent a prompt, and on Nov 9 all 3 new installs stopped on the tools step, which had no **Skip** (0218).
Malini needs neither tool before you pick a repository, and Simon asked why setup should block on them at all: "we should automatically try to install Claude Code for someone if it's not installed."
He wants GitHub repositories first, since "browsing local directories is madness", with a folder kept as the way in for everything else.
He asked for the heard-about question "after someone wins", after they archive their first merged workstream, rather than before they have used Malini.
This supersedes 0163, 0179, 0197 and 0218, moves 0151's heard-about question out of setup, and amends 0194's journey list.

## Decision

- **No setup screen.** `Onboarding.svelte` and its steps are deleted, along with `app.report-setup-step`, `ReportSetupStepArgs`, `SETUP_STEPS`, `SETUP_TOOL_STATES` and the commands behind each step.
  With no repository connected, the Repositories page opens on `FirstRepositoryPicker.svelte`, **What are we working on?**, under the usage sentence from Bestboy's canon.
- **GitHub first.** Signed in, the picker lists the five GitHub repositories pushed to last, **More repositories ⌘K** and **New repository**, as 0163 had them.
  Signed out, `GitHubSetup` in its `pitch` form reads "Sign in to GitHub to list your repositories" and "Malini clones its own copy. Your checkouts stay as they are.", with **Sign in**.
  **Open a folder ⌘O** sits under the card as a text link.
- **Tools install themselves.** `installMissingToolsHook` in `src/lib/app/application/hooks/install-missing-tools.hook.svelte.ts`, mounted by `App.svelte`, runs `providers.install-claude-code` when `claudeCodeStatusQuery` reads `missing`, and `repositories.install-github-cli` when `githubSetupStatus` reads `missing`.
  It never installs on `unknown`, so a failed check cannot put a second Claude Code beside one from Homebrew or npm.
  Each runs at most once per launch, so a failure never loops; **Try again** repeats it by hand.
  The download, checksum and install paths of 0218 are unchanged.
- **The first prompt waits.** A prompt sent while Claude Code is missing is held as before, and `ProviderConnectStrip` reads "Installing Claude Code. Your prompt sends once it is in" with the download bar, or the error with **Try again**.
  `releaseWaitingPromptQueuesHook` sends it once the capability reload reads ready.
  The picker shows "Installing Claude Code in the background" with the same bar.
- **Starters.** While a workstream is the only one and none is archived, its fresh chat shows **Start with something small**: "Explain how this repository works", "Fix the first failing test or lint" and, for a GitHub remote, "Take one open issue".
  A click runs `fillComposerCommand`, which writes the draft and marks it restored with the new cause `filled`, so the composer takes the text and focus without an error line.
- **Sounds, after the fact.** The first time the finished sound plays, a toast says what it means, with **Change sounds** to `/settings/sounds`, and `sounds.noted` stores that it showed.
  An install that has `onboarding.finished-at` already passed the old sounds step and never sees it.
- **Defaults as seeded.** A new install keeps the built-in triggers as `BUILTIN_AUTOMATIONS` seeds them: Resolve conflicts, Address review and Update from main on Touches my files, the second brain off.
  Settings, Automations and Settings, Brain keep their switches (0179), and Sidebar options keeps its questions (0240).
- **Heard about, after the first merge.** `HeardAboutCard.svelte` shows on the Repositories page once an archived workstream has a merged pull request and the `heard-about` setting is still unset.
  A chip answers at once, **Somewhere else** opens a field, and × stores the setting empty so it never asks again; after an answer it reads "Noted. Thanks".
  The answer tags usage counts as `heard_about` the way 0136 and 0151 had it.
- **Usage data.** The `setup_*` markers and `usage-data.setup-started` are gone.
  `first_repository` carries `source`, one of `github`, `folder` or `new`, from `repositorySource` in `src/lib/app/platform/usage-data.ts`, remembered when `repositories.connect` starts and `new` when its clone URL matches the repository `repositories.create-github-repository` just made.
  Tool install and sign-in counts carry `phase: setup` until the first prompt run, and `later` after.
- `AGENTS.md` says both installs start on their own.

## Consequences

- A new install reaches a repository with one click when `gh` is already signed in, and two plus the GitHub code when it is not.
- The 320 MB Claude Code download starts at launch without a press, so a slow network pays for it before the user asks for anything; the bar says so.
- `heard_about` now arrives only on counts after the first merge, so it describes installs that reach a merge, and installs that leave before one carry none; the site's download sources cover the rest.
- The funnel loses its per-step setup points and gains the source of the first repository, so whether **Open a folder** earns its place shows in Logdash.
- An install that keeps its first merged workstream and never archives one is never asked.
- `src/lib/app/platform/usage-data.test.ts` fails when `first_repository` loses its source, and `src/lib/app/platform/register.test.ts` fails if `app.report-setup-step` comes back.
- The e2e specs under `apps/malini/tests/e2e` cover the picker, the held prompt with a failed install and **Try again**, the starters and the heard-about card against the fake bridge.
