# 0195 - Setup traces each step and recovers from a missing tool

Status: accepted

## Context

0194 maps the install journey from `first_open` to `setup_finished`, and the saved funnel shows only those two points of setup.
When installs stopped before `setup_finished`, the data could not say which of the four steps they reached, or whether Claude Code or the GitHub CLI was missing.
The first step is about tools, not accounts: Malini needs the `gh` CLI signed in to GitHub, but only the Claude Code CLI, since the first prompt on a Claude model asks for the sign-in.
A Mac without one of them could not leave the first step, and a `gh auth status` that never returned kept it on **Checking** for good.
The GitHub CLI ships inside the app (0014), but when it cannot run the only way back was to download all of Malini again.
0194 states that a new marker needs a new release and a new record.

## Decision

- Four journey markers join 0194's list: `setup_tools`, `setup_sounds`, `setup_defaults` and `setup_heard_about`.
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
- `withBundledGh` appends the bundled folder, then `<appData>/vendor/gh/bin`, to `PATH` at boot, so a `gh` the user installed still comes first.
- `gh auth status` and `gh api user` stop after `GITHUB_AUTH_CHECK_TIMEOUT_MS`, 15 seconds, with `GhError` kind `unreachable`, and the row shows **Check again**.
- **Skip** shows on the tools step while either tool is missing or signed out, so setup never holds a Mac it cannot finish.
  **Continue** still waits for both tools to settle.
- `MALINI_GH_PATH` replaces the search path of every `gh` call, so the e2e harness can run setup on a Mac without `gh`.

## Consequences

- The install journey shows where a fresh install stopped, and a missing Claude Code or GitHub CLI appears as a property of the tools step rather than as an unknown.
- An install that quits while either check is still running records `first_open` and no setup step, because no settled tool state exists to report.
- Steps are reached, not completed; only `setup_finished` proves setup ended.
- No marker carries a prompt, path, repository name or other content.
  A new marker or property needs a new release and a new record.
- Malini makes one more outbound call, to `github.com`, only after the user presses **Install**.
  A new `gh` version changes `GH_VERSION` and `GH_SHA256` together.
- The install takes as long as the download, with only a spinner meanwhile.
- Enforced by `src/lib/app/platform/usage-data.test.ts` (each step once, both states on the first, nothing twice), `src/lib/app/platform/register.test.ts` (valid steps, settled states only), `src/main/process/gh-install.test.ts` (checksum, one install, each failure stage leaves nothing), `src/main/process/gh.test.ts` (`PATH` order, the time limit), `tests/e2e/first-run.spec.ts` (Skip past a missing Claude Code) and `tests/e2e/github-sign-in.spec.ts` (Install, its failure and Skip past a missing `gh`).
