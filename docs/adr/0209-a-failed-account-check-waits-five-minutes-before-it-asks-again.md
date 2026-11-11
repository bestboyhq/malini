# 0209 - A failed account check waits five minutes before it asks again

Status: accepted

## Context

0156 has a usage count ask `/api/me` when the last answer is more than an hour old, and says a count "waits on `/api/me` at most once an hour, so it can still carry an id for up to an hour after the platform changes its terms."
`#checkAccount` in `stats-profile.ts` set the time before it asked, so a check that failed counted as the hour's answer, and counts went on with the last saved account for up to another hour.
Recording the time only on an answer fixes that, but then every count during an outage, error names included, asks `/api/me` again and waits up to the client's 15-second timeout.
A short wait after a failure keeps Malini from asking a platform that is down on every count, and keeps the hour from being spent on a call that learned nothing.
0156 stays accepted; this record changes only what a failed check does.

## Decision

- `ACCOUNT_RETRY_MS` in `src/lib/stats/platform/stats-profile.ts` is `5 * 60_000`.
- `#checkAccount(freshMs)` asks only when a token is saved, the last answer (`#accountCheckedAt`) is more than `freshMs` old, and the last failure (`#accountFailedAt`) is more than `Math.min(freshMs, ACCOUNT_RETRY_MS)` old.
  Callers that ask while a check is in flight share it through `#accountCheck`.
- `#readAccount` sets `#accountCheckedAt` only after `/api/me` answers for the token still saved, and `#accountFailedAt` when it throws; a 401 still drops the token.
- So usage counts (`usageAccount()`, `USAGE_ACCOUNT_FRESH_MS`, one hour) ask again five minutes after a failure, and the `stats.profile` command that Profile and the Stats panel call (`profile()`, `ACCOUNT_FRESH_MS`, one minute) one minute after it.
  Meanwhile a count carries what the last answer saved in `bestboy-profile.json`.
- Publishing that accepts new terms clears both times and checks at once.

## Consequences

- While `/api/me` fails, counts wait on at most one call every five minutes, and send with the account the last answer saved.
- A count can still carry an id for up to an hour after the platform changes its terms, as 0156 says, plus as long as `/api/me` keeps failing; before, one failure added a full hour.
- Profile and the Stats panel never wait longer than their own minute after a failure.
- Both times live in memory only, so after a restart the first count asks.
- What must stay true: a failed check never sets `#accountCheckedAt`.
- Enforced by `src/lib/stats/platform/stats-profile.test.ts` ('asks Bestboy again five minutes after an account check that failed': one call after four minutes, a second after six), with 'lends usage counts the account on current terms, holds them on old terms, and lends none once signed out' for the hour and the shared call.
