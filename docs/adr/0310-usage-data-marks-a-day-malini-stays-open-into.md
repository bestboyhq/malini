# 0310 - Usage data marks a day Malini stays open into

Status: accepted

## Context

0194 sends `day` on the first launch of each local day, and the docs say usage data counts the days Malini runs.
Malini stays open for days: it holds the user's chats and runs their automations, so many installs never relaunch after midnight.
On 2026-11-26 the bestboy.dev Logdash had three installs finishing runs and no `malini_desktop_day`, so the DAU line read 0 while WAU read 6.
The L30 chart (0243) and the release health card (0272) read the same `day`, so they undercounted the same installs.
This record replaces 0194's "first launch" with every day Malini runs; the rest of 0194 and 0213 stands.

## Decision

- `day` goes on the first launch of each local day, as before, and from the hourly usage check in `src/lib/app/platform/usage-data.ts`, which already sends yesterday's `loop` (0143) and error repeats.
- `sendDay` stays idempotent per local day through `usage-data.last-active-day` (0213), so the hourly check sends at most one `day` per day and nothing on a day that already went.
- A day counts when Malini runs on it, idle or not: renderer timers call commands without the user, so no command or event marks use more truly than the app running.
- No new call or field: `day` keeps its properties, and Logdash's endpoint stays as 0058 set it.

## Consequences

- An install open past midnight marks the new day within an hour of the Mac being awake.
- An install left open and unused counts as active on every day it stays open, which matches the days Malini runs.
- A day on which Malini runs less than an hour after midnight, with no launch, can stay unmarked.
- Enforced by `src/lib/app/platform/usage-data.test.ts`: "marks the next day within the hour while Malini stays open past midnight".
