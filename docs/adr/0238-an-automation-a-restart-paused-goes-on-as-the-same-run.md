# 0238 - An automation a restart paused goes on as the same run

Status: accepted

## Context

0153 pauses the turns a quit cuts short and continues them on **Malini started**, and 0200 has `#recoverRun` finish an automation run whose chat folds to `idle` at launch with no pause as `interrupted`.
`#sessionState` counted only a usage limit or an outage as a pause, so a turn Malini paused to quit read as no pause, and `#recover` failed its automation run before the Resume rule ran.
`continuePausedRuns` then continued that automation's chat anyway, with no automation run left to follow it.
The chat went on unseen: the user's workstream showed **Agent running** in its top bar for a **Fix checks** chat that waited on an approval to run `swift test` outside the sandbox, while its run read **Failed** and the reconciler offered to run it again.
In the user's words: "what the fuck is the "agent running" - so weird, looks like smh stale".
The top bar also called a chat that waits on your approval **Agent running**, where the sidebar says **Approval** and an automation's line says **Needs you**.

## Decision

- `pausedToGoOn` in `apps/malini/src/lib/automations/platform/automation-runner.service.ts` counts a turn ended with `PAUSED_FOR_EXIT_ERROR` as a pause, like `isPausedRunEvent`, for `#ended` and `#sessionState`, so `#recoverRun` keeps the automation run `running` and follows the turn Resume continues.
- `automationOver` in `apps/malini/src/lib/chat/platform/agent/commands.ts` skips an automation chat whose automation run is over, for `continuePausedRuns` on **Malini started** and for `continuePausedRun` on a pause's **Time reached**.
- `workstreamAgentStatusQuery` gives the workstream's agent status, `waiting_for_approval` over `running`, and `pullRequestTopBar` takes it: **Needs you** without the busy stripes while a chat waits on you, **Agent running** while one works.

## Consequences

- An automation a restart cut short ends as the same run, so nothing asks to run it again.
- A chat that goes on always has its automation run beside it, so the closed inspector and the composer tray show what it does.
- A quit-paused automation run counts against **Automations running at once** until Resume continues it.
- `register.test.ts` ("keeps tracking runs malini resumed, paused to quit or a limit paused, and fails the ones whose chat ended") checks the recovery, `commands.test.ts` ("leaves an automation chat a quit paused as it is once Malini started, when its automation run is over") the skip, and `pull-request-top-bar.test.ts` ("says a chat waiting for your approval needs you, not that the agent runs") the label.
- `tests/e2e/event-reconciler.spec.ts` ("an automation a restart cut short goes on with its chat as the same run, and nothing asks to run it again") and `tests/e2e/chat-session-status.spec.ts` ("the top bar says a chat waiting for your approval needs you, and that the agent runs once you allow it") check both in the app.
