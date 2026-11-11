# 0219 - Usage counts follow only the Share usage stats switch

Status: accepted

## Context

0156 sent nothing at all while Malini was signed in to Bestboy on terms older than the current ones.
Every early install had signed in before the November 2, 2026 terms, and Settings, Profile shows no button that accepts them, so from v0.91.0 those installs sent no count, day, loop or error name.
Logdash shows it: runs fell from 43 to 192 a day to zero after November 5, and since November 9 only four new installs sent anything.
An agent on the user's other Mac, on v0.103.0 and running agents every day, found it signed in on unaccepted terms, with sharing on and `DO_NOT_TRACK` unset.
The user, on a product with about eight users: "I want to know if my thing works and if it gets used", and "someone can really disable sending data in their settings".

## Decision

- **Share usage stats** alone decides whether Malini sends; Bestboy terms never stop a count.
- `StatsProfile.usageAccount()` in `src/lib/stats/platform/stats-profile.ts` answers `accepted` with the id only while signed in on current terms, and `anonymous` otherwise; the `old-terms` answer is gone.
- `startUsageData` in `src/lib/app/platform/usage-data.ts` sends every count, journey marker, loop and error name while sharing is on, with `userId` only when `accepted`.
- `malini_desktop_stats_off`, `DO_NOT_TRACK=1` and `MALINI_USAGE_DATA=off` keep their meaning from 0156.

## Consequences

- Installs signed in on old terms count again, with no id, from the release that carries this change.
- The account id still waits for the current terms, so Logdash joins no one to an account they did not accept terms for.
- `docs/api.md` in `bestboyhq/platform` still says Malini sends nothing on older terms, and must change to match.
- Enforced by `src/lib/app/platform/usage-data.test.ts` ('carries the account when lent one, no id otherwise, and nothing once sharing is off') and `src/lib/stats/platform/stats-profile.test.ts` ('lends usage counts the account on current terms, and none on old terms or signed out').
