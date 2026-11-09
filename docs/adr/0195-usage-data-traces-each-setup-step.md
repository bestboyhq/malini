# 0195 - Usage data traces each setup step and a missing account

Status: accepted

## Context

0194 maps the install journey from `first_open` to `setup_finished`, and the saved funnel shows only those two points of setup.
When installs stopped before `setup_finished`, the data could not say which of the four steps they reached, or whether Claude Code or the GitHub CLI was missing.
The Mac already knows each step and both account states while setup runs, so it can count them with the same marker and the same gate as every other journey count.
0194 states that a new marker needs a new release and a new record.

## Decision

- Four journey markers join 0194's list: `setup_accounts`, `setup_sounds`, `setup_defaults` and `setup_heard_about`.
  Each is sent from `Onboarding.svelte` when its step first shows, through `app.report-setup-step` and its `ReportSetupStepArgs`, and is stored as sent only after delivery, like every other journey marker.
- `setup_accounts` carries `claude_code` and `github`, each one of `missing`, `signed-out`, `ready` or `unknown`, from the raw `claudeCodeStatusQuery` and `githubSetupStatus` values.
  The renderer sends this marker only after both checks settle, so `checking` never leaves the Mac.
  The other three markers carry only `cohort` and `days`.
- Main validates the step against `ONBOARDING_STEPS` and each state against `SETUP_ACCOUNT_STATES`, maps the step through `setupStepMarker` in `src/lib/app/platform/usage-data.ts`, and calls the same `sendJourney` as 0194.
  Sharing, `DO_NOT_TRACK`, `MALINI_USAGE_DATA=off`, the account terms, the cohort, `days`, one send per marker and the fresh-install rule are unchanged.
- `setup_finished` still comes from `onboarding.finished-at`, so the funnel now shows a reached step before it shows completion.
- Setup also offers recovery: a missing GitHub CLI shows **Download Malini**, which opens the latest `malini-arm64.dmg`; a missing Claude Code keeps **Install**, the copyable install command and **Check again**.

## Consequences

- The install journey shows where a fresh install stopped, and a missing Claude Code or GitHub CLI appears as a property of the accounts step rather than as an unknown.
- An install that quits while either check is still running records `first_open` and no setup step, because no settled account state exists to report.
- Steps are reached, not completed; only `setup_finished` proves setup ended.
- No marker carries a prompt, path, repository name or other content.
  A new marker or property needs a new release and a new record.
- Enforced by `src/lib/app/platform/usage-data.test.ts` (each step once, both states on the first, nothing twice) and `src/lib/app/platform/register.test.ts` (valid steps, settled states only).
