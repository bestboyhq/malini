# 0127 - A Bestboy profile is seeded once and only grows after

Status: accepted

## Context

Under 0123, every `PUT /api/stats/malini` replaced the person's stats with whatever passed the platform's checks, and those checked shape and wide bounds only: up to 10,000,000 runs, 1,000 agents at once.
So anyone signed in could send a year of invented history with `curl` in one upload, or rewrite their past at any time, and a profile and its standing showed it.
The user asked to make it unhackable.
Numbers counted on a Mac its owner controls cannot be proven: the owner can edit Malini's database or skip Malini, and a key shipped inside the app can be pulled out of it.
The user's call: "whenever you make account, we pull up current stats, seed that account with them, and since then it becomes append only. Initial seed is a single event", with limits that fit real use, no GitHub account linking, and no verified labels.
Limits are set about ten times above the heaviest real Malini use, measured on the user's own database: 12 agents at once, 311 runs in a day, 2,354 tool calls in a run, 38,695 changed lines in a run.

## Decision

- Malini's upload stays Stats v1, unchanged; the platform (`bestboyhq/platform`, `src/lib/server/stats.ts` and `profiles.ts`, `docs/api.md`) changes what it keeps.
- **Seed.** The first upload for a person and app is stored as it arrives, after the checks below, and goes public at once, as before.
- **Then it only grows.** Each later upload is folded into what the platform holds:
  - `since` stays; `through` only moves forward; a day on or before the stored `through` keeps its stored numbers, and only days after it are added.
  - `runs` and `activeDays` grow by exactly the added days.
  - Every other total grows by how much it grew since the previous upload, never shrinks, and grows only when days are added, at most by what the added runs, plus 100 still open, can account for: one job run, change run or workstream each, 25,000 tool calls or screenshots each, 400,000 lines or files each, and merged pull requests at most the workstreams.
  - Agents at once, run lengths, steps, the six parts and the picked repositories follow the latest upload, fitted to the folded totals, since the parts and picks are switches the person controls.
- **Limits.** Values above them are lowered to them, so a genuine outlier keeps publishing: 100 agents at once, 3,000 runs a day, 25,000 steps in a run, 400,000 lines in a typical change, runs at most 3,000 times active days.
  When runs are lowered, job runs, change runs, the techniques and the lists are cut to fit.
  The old ceilings of 10,000,000 runs and 1,000 agents are gone.
- **Profiles from before.** A profile published before this change has no previous upload to measure against, so its next upload seeds it again under the limits and waits for the daily publish.
- **Cross-checks.** The platform refuses an upload that breaks one, since Malini never does:
  - every day's agents at once is at most the peak;
  - tool calls are at most runs times the most steps in a run;
  - runs are at most active days times the most runs on a day, and at least the active days.
- **Off.** Turning **Publish my stats** off, signing out or the web's **Remove my stats** still removes everything at once, so the next upload seeds again.
- No GitHub account linking and no verified labels; the profile page keeps saying its stats are self-reported by Malini.

## Consequences

- A forged history now takes as long to build as a real one, and a past day never changes once uploaded.
- Someone patient who uploads plausible numbers every day still cannot be told apart from a real user: nothing outside their Mac can confirm agent work without an external record, which the user declined.
- Agents at once, run lengths, steps and the parts can still be overstated within the limits and the totals; per-day uploads would close that, at the cost of a Stats v2.
- Turning publishing off and on seeds again, the same as making a new account, which email sign-in allows anyway.
- A profile can count more than the Stats panel: deleting a chat or a repository on the Mac lowers the panel, never the profile.
- Two Macs on one Bestboy account fold oddly, since each upload is read against the other's.
- Malini must keep the three cross-checks true by construction, or every upload fails: `src/lib/stats/platform/published-stats.test.ts` asserts them on runs across midnight, three agents at once and a run still open at the cutoff, and the platform's `test/e2e.test.ts` covers the seed, the fold, each limit and each refusal.
- `apps/site/content/profile.md` describes the seed, the growth and the limits.
