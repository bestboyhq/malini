# 0200 - Setup traces each step and recovers from a missing tool

Status: accepted

## Context

0194 maps the install journey from `first_open` to `setup_finished`, and the saved funnel shows only those two points of setup.
When installs stopped before `setup_finished`, the data could not say which of the four steps they reached, or whether Claude Code or the GitHub CLI was missing.
The first step is about tools, not accounts: Malini needs the `gh` CLI signed in to GitHub, but only the Claude Code CLI, since the first prompt on a Claude model asks for the sign-in.
A Mac without one of them could not leave the first step, and a `gh auth status` that never returned kept it on **Checking** for good.
The GitHub CLI ships inside the app (0014), but when it cannot run the only way back was to download all of Malini again.
A missing Claude Code only opened Terminal on the `install.sh` command, and Malini had no view of that install.
The step showed one tool at a time, in an accordion kept from when it only signed in to accounts, so a second tool waited behind a closed row.
Malini cannot do its work without either tool, so letting setup move on without one only moves the dead end to the first prompt or the first clone.
0194 states that a new marker needs a new release and a new record.

## Decision

- Five journey markers join 0194's list: `setup_tools`, `setup_sounds`, `setup_sidebar` (the step 0197 adds), `setup_defaults` and `setup_heard_about`.
  Each is sent from `Onboarding.svelte` when its step first shows, through `app.report-setup-step` and its `ReportSetupStepArgs`, and is stored as sent only after delivery, like every other journey marker.
- `setup_tools` carries `claude_code` and `github`, each one of `missing`, `signed-out`, `ready` or `unknown`, from the raw `claudeCodeStatusQuery` and `githubSetupStatus` values.
  Claude Code signed out still counts as ready for setup, through `claudeCodeOnboardingStatus`, because it needs no account there.
  The renderer sends this marker only after both checks settle, so `checking` never leaves the Mac.
  The other three markers carry only `cohort` and `days`.
- Main validates the step against `SETUP_STEPS` and each state against `SETUP_TOOL_STATES` in `$contract/commands.ts`, maps the step through `setupStepMarker` in `src/lib/app/platform/usage-data.ts`, and calls the same `sendJourney` as 0194.
  Sharing, `DO_NOT_TRACK`, `MALINI_USAGE_DATA=off`, the account terms, the cohort, `days`, one send per marker and the fresh-install rule are unchanged.
- `setup_finished` still comes from `onboarding.finished-at`, so the funnel now shows a reached step before it shows completion.
- A missing GitHub CLI shows **Install**, in setup and in Settings, Accounts.
  It runs `repositories.install-github-cli`, which downloads the same pinned `gh_<version>_macOS_arm64.zip` from `github.com/cli/cli/releases` that `pnpm dist` bundles, through `net.fetch`.
  `installGh` in `src/main/process/gh-install.ts` checks the zip against the pinned sha256, unpacks it with `ditto` into a scratch folder, and moves it to `<appData>/vendor/gh` in one rename, so a failed install leaves nothing behind.
  It throws `GhInstallError` with kind `download`, `checksum` or `unpack`, which Logdash receives by name and kind like every other command failure, and the row shows the message with **Try again**.
  `scripts/fetch-gh.mjs` calls the same `installGh` for the bundle, so the version and checksum live in one place.
- A missing Claude Code shows **Install** too.
  It runs `providers.install-claude-code`, which does in the app what `https://claude.ai/install.sh` does in a terminal, through `installClaudeCode` in `src/lib/shared/providers/platform/claude-install.ts`.
  It reads the version from `downloads.claude.ai/claude-code-releases/latest`, the `darwin-arm64` checksum and size from that version's `manifest.json`, downloads the binary into `<appData>/claude-setup`, and checks its sha256.
  It then copies the binary to `$XDG_DATA_HOME/claude/versions/<version>`, `~/.local/share` by default, and runs `claude install <version>` without a terminal, so Claude Code sets itself up in `~/.local/bin` as it does from `install.sh`.
  Claude Code's installer verifies a build it finds in that folder against its signed manifest and skips its own download, so the 320 MB arrive once; `install.sh` downloads them twice, the second time with no progress.
  If a later Claude Code moves that folder, its installer downloads again and setup still finishes, only slower.
  The downloaded binary is removed whether the install succeeds or fails.
  It throws `ClaudeInstallError` with kind `download`, `checksum` or `setup`, and the row shows the message with **Try again**.
  Only after a failed install does the row also show the `install.sh` command to copy into Terminal; Malini notices the new `claude` within three seconds either way.
  Off macOS the command still asks for the Terminal install.
- Both downloads go through `saveDownload` in `src/main/fs/download.ts`.
  It streams to disk, hashes as it goes, and gives up after 30 seconds without data, `DOWNLOAD_STALL_MS`.
  It reports progress on `repositories:github-cli-install-progress` and `providers:claude-code-install-progress`, about a hundred times a download, and the row shows a bar with the megabytes received under its status.
  Main runs one install of each tool at a time, so a second press joins the first.
- `withBundledGh` appends the bundled folder, then `<appData>/vendor/gh/bin`, to `PATH` at boot, so a `gh` the user installed still comes first.
- `gh auth status` and `gh api user` stop after `GITHUB_AUTH_CHECK_TIMEOUT_MS`, 15 seconds, with `GhError` kind `unreachable`, and the row shows **Check again**.
- The tools step shows every tool at once.
  Each row has its number, its name and status, its action on the right and its download bar below, so both installs and the GitHub sign-in run side by side.
  A ready tool folds to one line with its detail.
- The tools step has no **Skip**.
  **Continue** opens once both tools are ready, with Claude Code signed out counted as ready.
  A check that failed, `unknown`, also lets **Continue** through, so a broken check never holds setup; a tool known to be missing or GitHub known to be signed out never does.
- `MALINI_GH_PATH` replaces the search path of every `gh` call, so the e2e harness can run setup on a Mac without `gh`.
- Every setup marker carries `setup_seconds`, the seconds from the first time the tools step showed to the moment the step was reached; `setup_finished` counts to `onboarding.finished-at`.
  The start is kept in `usage-data.setup-started`, so a restart does not reset it.
  An install that never reported the tools step sends no `setup_seconds`.
- Seven repeatable counts follow each tool through setup and after it: `tool_install_started`, `tool_install_finished`, `tool_install_failed`, `tool_sign_in_started`, `tool_sign_in_finished`, `tool_sign_in_cancelled` and `tool_sign_in_failed`.
  Each carries `tool` (`claude_code` or `github`), `attempt` (the press, counted from launch) and `phase` (`setup` until onboarding finishes, `later` after).
  The outcomes also carry `seconds` from the press to the outcome, and a failure carries `stage` (the error's kind, such as `download`, `checksum`, `setup` or `unpack`), `error` (its name) and `code` when it has one, never its message.
  A start with no outcome is an install or sign-in that was still running when Malini quit.
- They come from the command registry, not from the installers: `CommandRegistry.observeStarts` reports a command before its handler runs, and `CompletedCommand` now carries the handler's `result`, so a GitHub or Claude sign-in that resolves `cancelled` counts as cancelled.
  `src/lib/app/platform/usage-tools.ts` maps `providers.install-claude-code`, `repositories.install-github-cli`, `providers.sign-in-to-claude`, `repositories.start-github-sign-in` and `repositories.finish-github-sign-in`; the GitHub workflow-access sign-in is not counted.
  They follow the same rules as every count: the switch, `DO_NOT_TRACK`, `MALINI_USAGE_DATA=off`, the account terms and the heard-about option.

## Consequences

- The install journey shows where a fresh install stopped, and a missing Claude Code or GitHub CLI appears as a property of the tools step rather than as an unknown.
- An install that quits while either check is still running records `first_open` and no setup step, because no settled tool state exists to report.
- Steps are reached, not completed; only `setup_finished` proves setup ended.
- No marker or tool count carries a prompt, path, repository name, error message or other content.
  A new marker or property needs a new release and a new record.
- Malini makes two more outbound calls, to `github.com` and to `downloads.claude.ai`, each only after the user presses **Install** on its row.
  A new `gh` version changes `GH_VERSION` and `GH_SHA256` together; Claude Code always installs its latest release, checked against the checksum Anthropic publishes with it.
- An install shows how much of the download has arrived; the Claude Code binary is about 320 MB.
- A Mac with no network cannot finish setup, since neither tool can arrive without one.
- Enforced by `src/lib/app/platform/usage-data.test.ts` (each step once, both states on the first, nothing twice, `setup_seconds`, each tool count with its attempt, stage and phase) and `src/main/ipc/registry.test.ts` (start observers and results), `src/lib/app/platform/register.test.ts` (valid steps, settled states only), `src/main/process/gh-install.test.ts` (checksum, progress, one install, each failure stage leaves nothing), `src/lib/shared/providers/platform/claude-install.test.ts` (the `install.sh` steps, progress, each failure stage leaves nothing), `src/main/fs/download.test.ts` (progress, sha256, the stall limit), `src/main/process/gh.test.ts` (`PATH` order, the time limit), `tests/e2e/first-run.spec.ts` (no way past a missing Claude Code, Install and its failure) and `tests/e2e/github-sign-in.spec.ts` (no way past a missing `gh`, every tool shown at once, both installs side by side and their failures).
