# 0138 - Usage data counts yesterday's loop and shows you the numbers

Status: accepted

## Context

0058 kept usage data to `app_active` once per launch, `run_finished` per run and error names, with no properties and no id, and 0121, 0129 and 0137 restated it unchanged.
The user wants funnels and to see "how the loop goes", from a prompt to a merge, and had nothing for it.
A funnel usually needs an id per install, which makes usage data personal and, in the EU, asks for consent first; asking first would also hide the drop-off, since people who leave early rarely say yes.
Malini already keeps every step of the loop in its own database, so the Mac can count it and send numbers only.
The user wants any ask to give its reason and what you get from it, and turned down copy that read mechanical: "it's very verbal text ... it doesn't feel human".
Of three places to explain it, a receipt in Settings, a card after a merge and a funnel in Stats, they picked the receipt in Settings, Privacy.

## Decision

- Once a local day, usage data sends one more Logdash web event, `malini_desktop_loop`, to the same `POST https://api.logdash.io/web_events` and site as `app_active`, with up to seven properties and no id:
  - `started`, workstreams created yesterday; `prompts`, the runs you prompted yesterday; `merged`, workstreams merged yesterday; `archived`, workstreams archived yesterday without a merge;
  - `turns`, the median prompts per workstream merged yesterday, and `minutes`, the median minutes from its start to its merge, both left out on a day without a merge;
  - `age`, `day_1`, `week_1`, `month_1` or `later`, counted from the first workstream on the Mac.
- `usageReport` in `src/lib/app/domain/usage-report.ts` counts it from the readers Stats v1 already uses, through `readUsageReport` in `src/lib/app/platform/usage-report.ts`.
  Lead and Home workstreams are left out, a merged workstream's archive time is its merge time, and a prompt is a run that is neither a job's nor automated (`RunFact.job`, `RunFact.automated`), so a prompt a lead sends with `workstreams_send` is not yours.
- `startUsageData` checks on `app:started` and every hour, sends the report for yesterday once (`usage-data.reported-day` in `settings`), and sends nothing about a day where nothing happened.
  The **Share usage data** switch, `DO_NOT_TRACK=1` and `MALINI_USAGE_DATA=off` stop it like every other usage call.
- `app.usage-report` returns the same report, and **Yesterday's numbers** under **Share usage data** in Settings, Privacy shows it while sharing is on, under copy that says who reads the numbers and why.
- Usage data stays on until you turn it off: it carries no id and no content, so nothing in it points to a person.

## Consequences

- Logdash shows how many installs start, prompt, merge and drop work each day, how many prompts and minutes a merge takes, and by `age` how far new installs get, all without an id.
- There are no per-person paths or retention curves, and a funnel cannot be recut after the fact: a new count needs a new property and a release.
- Logdash keeps property values as strings and counts a visitor once a day, so totals across installs come from its breakdowns or an export.
- The receipt counts yesterday from the database when Settings opens, so it matches what Malini sends, and changes only if yesterday's records do, such as a workstream deleted since.
- A new property changes this record, the receipt and `apps/site/content/index.md`.
- Enforced by `src/lib/app/platform/usage-data.test.ts` (yesterday's counts and medians, once a day across launches, a quiet day, nothing once off), `src/lib/app/platform/register.test.ts` (the command) and `tests/e2e/settings.spec.ts` (the receipt by role, gone once sharing is off).
