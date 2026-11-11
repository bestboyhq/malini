# 0213 - Usage data day flags count from the last day that went out

Status: accepted

## Context

0194 says `week_first` and `month_first` are `yes` when no earlier recorded active day falls in the same ISO week or calendar month, that each marker is sent at most once, and that only `first_repository` is checked once more at launch.
The flag wording matched the code 0194 shipped with: `sendDay` compared today with the latest earlier day in `usage-data.active-days`, which records every launch day, even with **Share usage stats** off, and each marker was stored as sent before its post went out, so a failed post lost it.
Now a marker counts as sent only once Logdash takes it, and in the same change `sendDay` began to compare with the last day whose `day` went out, which 0194 does not say.
Counted from recorded days, a week whose first days never reached Logdash, with sharing off or a failed post, had no `day` with `week_first: yes`, and a `day` retried after the `month` marker pruned the earlier month would have read a week across two months as new.
The launch wording was already narrower than 0194's own hooks, which check `setup_finished` and `first_prompt` at launch too, and a workstream, merge or published profile made while sharing was off never counted.
This record replaces those three statements of 0194; the rest of 0194 stands.

## Decision

- **Sent means Logdash took it.**
  Every marker goes through `sendOnce` in `src/lib/app/platform/usage-data.ts`: `send()` keeps 0194's gates, the sink resolves `true` only when Logdash answers with a 2xx status, and only then is the marker stored.
  A journey marker joins `usage-data.journey`, `day` writes `usage-data.last-active-day`, `month` writes `usage-data.reported-month` and prunes `usage-data.active-days` to the current month, and yesterday's `loop` (0143) writes `usage-data.reported-day`.
  `sending` runs one attempt per marker at a time, and each attempt reads the stored value again first, so two events never send a marker twice.
- **The day flags count from the last day that went out.**
  `sendDay` compares today with `usage-data.last-active-day`: `week_first` is `yes` when there is none or it falls in another ISO week (Monday start), and `month_first` the same for the calendar month.
  `age` stays as 0194 set it, and `usage-data.active-days` still records every launch day, read only by `month`.
- **What did not go goes again.**
  `launch` runs at every launch and whenever **Share usage stats** turns on, since `share` calls it, and it tries again whatever has not gone.
  A `day` goes only on its own day, so the next day sends its own instead, and a `month` keeps its days until it goes.
  A journey marker also goes at its next event, and `loop` at its next check, on `app:started` or the hourly timer.
- **`launch` checks every first-use marker again.**
  `setup_finished` goes once `onboarding.finished-at` is set, `first_repository` once `listRepositoryCatalog` lists one, and `first_prompt` once `hasPromptRun` finds one.
  For an install with a first open, `first_workstream` goes once `userWorkstreams` lists an open or archived workstream with no `scope`, `first_merge` once one of them has a merged pull request, and `first_profile_published` while **Publish my stats** is on (`stats.published()`, passed from `src/main/modules.ts` as `profilePublished`).
- **No new call or field.**
  The markers, their properties and Logdash's two endpoints stay as 0058 and 0194 set them.

## Consequences

- `week_first: yes` and `month_first: yes` mark the first day of a week or month that Logdash has from an install, so a week counts once when any of its days went out, even when its first days stayed on the Mac.
- `month`'s `active_days` still counts every day Malini ran that month, from `usage-data.active-days`, whether or not that day's `day` went out.
- Delivery is at least once instead of at most once: a post that Logdash stored but whose answer never came back goes again, so a marker can arrive twice.
- A first setup, repository, workstream, prompt, merge or published profile that happened while sharing was off counts once sharing turns on.
  The check sees only what is true then, so a profile published and unpublished while sharing was off never counts.
- What must stay true: a sink resolves `true` only for a post Logdash took, and the flags read `usage-data.last-active-day`.
- Enforced by `src/lib/app/platform/usage-data.test.ts`: "starts each week and month on the last day that went, across months and years", "keeps a marker a failed post did not deliver, and sends it on the next launch", "keeps a month a failed post did not deliver, with its days", "keeps yesterday's loop when its post fails, and reports it on the next check", "counts a workstream, a merge and a published profile made while sharing was off", "records the first repository, workstream, merge and prompt once each" and "posts a marker again on the next launch when Logdash does not take it".
