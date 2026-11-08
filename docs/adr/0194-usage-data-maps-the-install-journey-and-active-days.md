# 0194 - Usage data maps the install journey and active days

Status: accepted

## Context

0058 and 0156 send `app_active`, `run_finished`, `profile_published` and `stats_off` to Logdash, and 0143 adds yesterday's `loop` report.
Seven saved insights on bestboy.dev read more: a funnel from first open to setup, a first repository, workstream, prompt, merge and published profile; daily and weekly active installs; the active days of the last 30; and return cohorts for each install week.
None of those insights can count an install without a stable cohort, and an id per install would make the numbers personal.
The Mac already knows every step, so it can count them and send numbers only, through the same `send()` as every other count.
An existing install would report a false first open and false first steps after an update, so the journey belongs only to installs first opened after this release.
Logdash keeps property values as strings and buckets counts, so each marker carries its facts as properties and no content.

## Decision

- Every marker goes through `send()` in `src/lib/app/platform/usage-data.ts`, so it waits for **Share usage stats**, `DO_NOT_TRACK=1` from the shell or the environment, and `MALINI_USAGE_DATA=off`, carries `userId: logdashUserId(site, id)` only when signed in on current Bestboy terms, no id signed out, and nothing on old terms.
- Each marker is sent at most once, except `day` and `month`, which have their own period. `settings` stores `usage-data.first-open`, `usage-data.journey` (the markers sent, as a JSON array), `usage-data.last-active-day`, `usage-data.active-days` (JSON array of `YYYY-MM-DD`) and `usage-data.reported-month`.
  A marker enters `usage-data.journey` only inside the delivery callback, so a marker that happens while sharing is off is not consumed.
- Journey markers, only for an install whose first `malini.sqlite` did not exist before `openMigratedDatabase` created it: `first_open`, `setup_finished`, `first_repository`, `first_workstream`, `first_prompt`, `first_merge`, `first_profile_published`, `returned_week_1` on the first launch 1 to 7 local days after the first open, and `returned_month_1` on the first launch 8 to 30 days after it.
  Every journey marker carries `cohort`, the local `YYYY-MM-DD` of the first open, and `days`, the whole local days since then, from `localDate` and `shiftDate` in `$lib/stats/domain/activity`.
- `day` goes on the first launch of each local day. It carries `week_first`, `yes` when no earlier recorded active day falls in the same ISO week (Monday start), else `no`; `month_first` the same for the calendar month; and `age`, `day_1`, `week_1`, `month_1` or `later`, from the first open, or from the earliest project for an existing install, else `later`.
- `month` goes on the first launch of a new calendar month, once per month, for the last earlier month with a recorded active day. It carries `month` as `YYYY-MM` and `active_days`, the distinct local days open in that month, 1 to 31.
  Days before the reported month are pruned only after its marker is delivered; an install with no earlier active month sends nothing.
- Hooks: `first_open`, the returns, `day` and `month` at launch in `startUsageData`; `setup_finished` from `app.set-setting` when the key is `onboarding.finished-at`, and at launch when that setting already exists; `first_repository` from `repositories:changed` through `listRepositoryCatalog` and at launch; `first_workstream` from `repositories:workstream-created` when `workstream.scope` is null; `first_merge` from `pull-requests:ship-changed` with `merged`; `first_prompt` after a run completes or fails and at launch, through `hasPromptRun` with the same predicate as `readUsageReport`; `first_profile_published` from `stats:profile-published`.
- A fresh install is `!existsSync(<userData>/malini.sqlite)` before the database opens in `src/main/index.ts`, passed through `ModuleOptions.freshInstall` to `AppDeps` and `startUsageData`.
  An existing install stores no first open, so it sends no journey marker, but it sends `day` and `month` from this release on, and its first `month` counts only the days recorded since it.
- No marker carries a prompt, path, repository name, file name or other content. `app_active`, `run_finished`, `profile_published`, `stats_off` and `loop` stay as they were, and pending sends still flush on shutdown.

## Consequences

- The seven saved insights fill: the funnel by `cohort`, daily and weekly active installs, the L30 active-day distribution, and return cohorts for each install week.
- There are still no per-person paths, and a new marker or property needs a new release and changes this record.
- Existing installs contribute days and months but no journey, so the funnel only counts installs from this release on; their first month undercounts because days before this release were never recorded.
- `first_repository` is checked once more at launch, so a repository added while sharing was off still counts when sharing returns; the other event-driven firsts send only when their event happens while sharing is on.
- Enforced by `src/lib/app/platform/usage-data.test.ts` (fresh installs only, each journey once with `cohort` and `days`, returns on day 7 and day 30, `day` once with its flags, `month` with `active_days` and pruning, nothing while off or on old terms, the accepted id, and nothing twice), and the existing checks on the other counts.
