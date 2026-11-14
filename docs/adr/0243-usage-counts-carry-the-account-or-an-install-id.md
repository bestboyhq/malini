# 0243 - Usage counts carry the signed-in account or an install ID

Status: accepted

## Context

0194 sends `day` on the first launch of each local day and `month` on the first launch of a new month, with the active days of the last month Malini ran.
0194 also kept usage counts free of any per-install id, since "an id per install would make the numbers personal", and 0219 sends counts with `userId` only for an account on current Bestboy terms.
The owner wants a true L30 chart on the bestboy.dev Logdash dashboard: the distinct active days per person over the last 30 days.
`month` cannot give it: it sums the previous calendar month, and a person who stops using Malini never sends their last month.
Logdash can count each user id's distinct days of `malini_desktop_day`, but signed-out installs and accounts on old terms carry no id, so they are invisible to that chart.
The owner approved a random install ID for it: "it is fully anonymous, an ID; I can see when someone comes back, nothing else".
The owner also decided that data collection must never be gated on accepting the platform's terms, since the privacy text may change several times a week, and the platform relay drops its terms gate too.
Grip, Tony and the platform relay follow the same design, and the relay hashes `<site>:install:<uuid>` (`docs/api.md` in `bestboyhq/platform`).
This record replaces 0194's statements on `month`, `usage-data.active-days`, `usage-data.reported-month` and the per-install id, and 0219's "with `userId` only when `accepted`" and "the account id still waits for the current terms"; the rest of both stands.

## Decision

- Signed in to Bestboy, every count carries `userId: logdashUserId(site, user.id)`, whatever `user.terms` in `/api/me` says.
  `Bestboy.me` in `src/lib/stats/platform/bestboy.ts` keeps `user.id` as `userId`, saved in `bestboy-profile.json`, and `StatsProfile.usageAccount()` answers that id while signed in, or `null`.
  `unacceptedTerms` stays for **Publish my stats**, which shows the new terms and accepts them when it publishes.
- Signed out, `startUsageData` in `src/lib/app/platform/usage-data.ts` makes one UUID v4 per install with `randomUUID()` and stores it in `settings` as `usage-data.install-id`.
  It makes the ID only in `send()`, after **Share usage stats** is checked twice around the account lookup, so nothing makes one while counts are off.
- Every count, journey marker, `day` and `loop` without an account carries `userId: logdashUserId(site, 'install:<uuid>')`, the lowercase hex sha256 of `<site>:install:<uuid>`; with an account, only the account hash goes, never both.
- `malini_desktop_stats_off` still carries no `userId`, and error names to `/logs` carry none.
- Turning **Share usage stats** off deletes `usage-data.install-id`, so turning it on again starts a new ID.
- The ID identifies only this install's usage counts, never a person, a Mac or an account.
- `month` is gone, with `usage-data.active-days`, `usage-data.reported-month` and the code that kept them.
  A migration in `src/main/db/migrations.ts` deletes both settings from existing databases.
- `day`, `loop`, `app_active`, `run_finished`, the tool counts and the journey markers keep their names and properties.
- Settings, Privacy describes **Share usage stats** as "Once a day, Malini sends a few counts, like how many workstreams you started and merged, with your Bestboy account when signed in, or a random install ID when not. Never your code or chats.", still two lines at the Settings width.

## Consequences

- Logdash counts the distinct `day` events per user id, so the L30 chart covers every install that shares usage stats.
- A change to Bestboy's terms never changes what Malini sends.
- One person on two installs, or one install that turns stats off and on, counts as two ids.
- A signed-in install sends its account hash and a signed-out spell sends the install hash, so the two are never joined.
- A profile saved before this change has no `userId`, so the first count after the update waits on `/api/me` to learn it, as every count does once the last answer is an hour old (0209).
- No monthly active-day count remains; the L30 chart replaces it.
- Enforced by `src/lib/app/platform/usage-data.test.ts` ("carries the signed-in account, this install id signed out, and nothing once sharing is off", "carries one install id signed out across launches, none on stats_off, and a new one after", "posts signed-out counts with the hash of this install id, and stats_off with none", "marks each local day once with the week and month it starts", which sees no `month`), `src/lib/stats/platform/stats-profile.test.ts` ("lends usage counts the account whatever its terms, and none signed out") and `src/main/db/migrations.test.ts` ("forgets the launch days the month count kept, and keeps the other usage settings").
