# 0251 - Usage data names every drop-off before the first merge

Status: accepted

## Context

0242 removed setup and its `setup_*` markers, and 0249 made the picker three ways in, but nothing marked the steps between them and the first merge.
From 9 to 12 Nov 2026, 7 fresh installs opened Malini, 3 added a repository and a workstream, 1 finished a prompt run, none merged and none came back on a later day.
The data could not say why: a click on **GitHub**, the sign-in code, an empty list, a failed clone, a prompt held for Claude Code, a failed run, a run that changed nothing and a ship stopped by GitHub all looked the same, as a missing next marker.
Simon asked to know "everything about every single drop off" and "why some people haven't started merging with Malini yet".
The picker's views and a held prompt live only in the renderer, and no domain may import `app`.

## Decision

- Five journey markers join 0194's list, each sent once per fresh install with `cohort` and `days`:
  - `first_choice` with `choice`: `github`, `folder` or `new`.
  - `first_prompt_sent` with `waits`: `none` or what the prompt waits for, as in `prompt_held` below.
  - `first_changes`: the first prompt run whose captured changes hold a file, through `hasChangedPromptRun` in `usage-report.ts`, after `chat:run-changes-captured` and at launch.
  - `first_ship` with `button`: `draft` or `merge`, from `pull-requests:button-clicked`.
  - `first_pull_request`: the first ship state with a pull request number.
- New counts, sent each time, each with `phase`: `setup` until a prompt run exists, `later` after.
  - `picked` with `choice`, which can also be `more`, for **More repositories**.
  - `github_view` with `view`: `list`, `empty`, `list_failed`, `code`, `sign_in`, `install_failed` or `unknown`, each time the GitHub view settles on a new one.
  - `github_back` with the `view` that **Back** left, or `loading`.
  - `prompt_held` with `waits`: `setup`, `claude_code`, `claude_sign_in`, `chatgpt_sign_in`, `chatgpt_model` or `key`, from `ACCESS_WAITS` in `submit-prompt.command.ts`.
    An automated prompt sends nothing.
  - `setup_step` with `step`, `outcome` and `seconds`, for the eleven renderer commands in `SETUP_STEPS` in `src/lib/app/platform/usage-steps.ts`, from `repositories.pick-folder` to `chat.send-prompt`.
    A failure adds `error`, `stage` and `code`, as 0218's tool counts do, and a skipped dependency install adds `reason`.
    Once a prompt run exists, only failures go.
  - `ship_button` with `button`, from `pull-requests:button-clicked`.
  - `ship_blocked` with `by`, `needs_you`, `waits_for` or `failing`, and `reason`, the `needsYou` reason, the `waitsFor` value or the ship step, each time a workstream's block changes.
- `run_finished` carries `ending` from `runEnding`, and a failed run adds `failure`, its `RunFailureKind` or `unknown`.
- The renderer reports what only it sees through `app.count-usage-step`, typed by `UsageStep` and allowed by `USAGE_STEPS` in `$contract/system.ts`.
  Main refuses any other step or value through `isUsageStep`, and `usageStepsService` in `$shared/system` drops a report that fails.
- Every outcome comes from an allowlist, so a result that is a path, such as a picked folder, counts as `ok`.
- The switch, `DO_NOT_TRACK`, `MALINI_USAGE_DATA=off`, the account terms, the heard-about option, one send per marker and the fresh-install rule are unchanged.

## Consequences

- Logdash can chart each step from the first open to the first merge, and name what stopped each install that dropped off.
- Installs first opened before this release send none of the new markers, and the first numbers arrive with the next release.
- A new install sends a few dozen `setup_step` counts before its first prompt run, and only failures after it.
- No count carries a prompt, path, repository name, error message or other content.
- `first_ship` and `first_pull_request` come only from their events, so a pull request opened while sharing is off never counts.
- A new step or value needs a new release and changes `USAGE_STEPS` and this record.
- Enforced by `src/lib/app/platform/usage-data.test.ts` (each new marker once, run endings, held prompts, setup steps with no path and only failures later, a run with no files, each ship block once, unknown steps refused), `src/lib/app/platform/register.test.ts` (the command exists) and `pnpm check` (the contract types).
- Nothing end to end checks that the picker and the composer send their steps, because the e2e harness runs with usage data off.
