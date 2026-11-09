# 0195 - An OpenCode Go key answers its usage

Status: accepted

## Context

The plan chip in the composer says "X% used" off the rate limits Claude's own backend answers for a signed-in account, so it never shows for an OpenCode run.
OpenCode runs are Claude Code pointed at opencode.ai, and the plan lives on the key, not the account, so no usage event arrives for it.
OpenCode still answers one endpoint for Go usage: `GET https://opencode.ai/zen/go/v1/usage` with the key as a bearer token, read only by keys created with the Usage: Read permission, and a 403 for a key that is not on Go.
The endpoint is undocumented; the shape comes from OpenCode's own client (`packages/core/src/usage-limits.ts` in anomalyco/opencode): `{ usage: { rolling, weekly, monthly } }`, a meter `{ percent, status, resetsAt }`, where rolling is the five-hour window.
Whatever the answer is, a chip must never lie: a refusal, an outage or a body Malini cannot read shows no chip at all, the way a paused account with no usage yet does.

## Decision

- The app's eighth outbound call reads `GET <origin>/zen/go/v1/usage` with the key as a bearer token and a ten-second timeout, from `src/lib/shared/providers/platform/opencode-usage.ts`, reachable as `providers.load-opencode-usage`.
- `origin` is the probe origin of 0165: `https://opencode.ai` in a packaged build, `MALINI_OPENCODE_PROBE_URL` in an unpackaged one, so one env var covers the plan probe, the key check and the usage read.
- A meter counts only with a finite `percent`, which is clamped to 0-100; a `resetsAt` that is not a date stays null; any non-OK status, offline read, JSON that is not usage, or body with no valid meter answers null.
- `ProviderKeys.opencodeUsage` decrypts the stored key and answers null unless the row is OpenCode with plan `go` and a saved sealed key.
- `register.ts` keeps a successful reading in the main process for sixty seconds (`ponytail:` result cache; one opencode.ai read per minute however many chats mount composer controls) and reads again on a miss, so a key saved into a chat without one shows its chip without a restart.
- The wire speaks `$contract`: `AgentPlanLimit { label, usedPercent, resetsAt }` and `AgentPlanUsage { observedAt, limits }`; chat's `PlanLimit` is an alias of `AgentPlanLimit`, so one shape feeds both chip sources.
- `SessionRuntimeControls` branches on the picked provider: a Claude model keeps the SDK's rate limits as before, an OpenCode model shows `currentPlanLimits` of the OpenCode reading; `planLimitAlert`, the ninety-percent rule, decides the chip in both cases.
- The panel lists OpenCode's windows under its row whenever a reading is in, labeled "5-hour limit", "Weekly limit" and "Monthly limit", the same rows a Claude account shows.

## Consequences

- A Go subscriber sees the five-hour chip in the composer before a run starts, and the three windows in the panel, straight from OpenCode.
- A Console key sees nothing: the read answers 403 once, waits out the cache, asks again a minute later only if the chat is still open, and shows no chip.
- OpenCode may change the undocumented endpoint without notice; the design degrades to no usage shown, which never pauses a run or names a wrong percent.
- The key needs Usage: Read; without it the endpoint answers like any other refusal. OpenCode's key page controls that permission, not Malini.
- Enforced by `opencode-usage.test.ts` (endpoint, headers, the three windows, clamping and dropping bad meters, null on refusal, offline or an unreadable body), `plan-usage.test.ts` (the wider `currentPlanLimits`), and `tests/e2e/provider-models.spec.ts` (a Go key shows the chip with its percent, the panel rows and the meter, and a Console key shows no chip).
