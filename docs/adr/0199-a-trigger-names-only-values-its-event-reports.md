# 0199 - A trigger names only values its event reports

Status: accepted

## Context

An event trigger reads `on <channel> where <path> is <value>`, and Malini starts the automation when the field at `<path>` of the event's payload equals `<value>` as text (`holds` in `src/lib/automations/platform/automation-triggers.service.ts`).
The parser checked the channel and the form of each condition but not the value, so `on automations:run-finished where run.status is succeded` saved, armed and never fired.
The state machine audit named it: "trigger `where` compares other machines' states as raw text."
Triggers saved before any check can name any value, and `parseAutomationTrigger` reads every stored trigger: in arming, in the Explorer's `triggerKind`, in `triggerChannel` for an automation's boundary and in each save.
A parser that refused such a value would drop the automation from arming, throw in the other readers, and keep you from saving the automation again, even to turn it off.

## Decision

- An entry of `EVENT_CATALOG` in `src/contract/event-catalog.ts` lists in `values`, per fact path, every value that field takes.
  The type `EventCatalogEntry` allows only paths among the entry's `facts` and only values of that field's type.
- Each list is a constant of `src/contract/automations.ts` that its field's type derives from: `AUTOMATION_RUN_STATUSES`, `AUTOMATION_RUN_ORIGINS`, `AGENT_ACTION_STATUSES`, `AGENT_ACTION_APPROVALS`, `RECONCILER_DECISION_STATUSES`, `RECONCILER_DECIDERS` and `AUTOMATION_SUGGESTION_STATUSES`.
  `automations:run-started` lists only `running` for `run.status`, and `automations:run-finished` lists the statuses outside `UNFINISHED_AUTOMATION_RUN_STATUSES`.
- Seven channels list values: `automations:run-changed`, `automations:run-started`, `automations:run-finished`, `automations:agent-action-changed`, `automations:tool-called`, `automations:decision-changed` and `automations:suggested`.
- `eventFactValues(channel, path)` returns the values of a path, or `null` when its entry lists none.
  `unknownTriggerValueMessage(trigger)` in `src/contract/automation-trigger.ts` names the first condition whose value is not among them, as "`<channel>` never reports `<path>` `<value>`. It reports a, b, or c.", and returns `null` for every other trigger.
- Two places call it, both on a trigger that is new.
  `triggerWhen` in `src/lib/automations/platform/commands.ts` runs behind `automations.save-definition`, which every save of an automation goes through, and refuses the trigger with that message; it skips the check when `when` equals the trigger the automation already stores.
  The event pane of `TriggerPicker.svelte` shows the message as an alert and turns off **Use this event**.
- `parseAutomationTrigger` still refuses an unknown channel or a malformed condition, but reads any value, so a stored trigger always loads, lists and arms.
  `eventTriggerOf` logs "`<name>` does not start on its own" with the reason for a stored trigger it cannot read, where it dropped the automation in silence before.

## Consequences

- A misspelled state, such as `run.status is succeded`, is refused when you save it, with the values the field takes, instead of an automation that never starts.
- A trigger saved before the check keeps its value: it lists, arms, and saves again unchanged, also to turn it off.
  It still never fires, and nothing flags it until you edit its `when`.
- A new status in one of the constants reaches the check with no other change; a new state field reaches it only once its entry lists it in `values`.
- Only the paths with `values` are checked: `status` of `chat:turn-finished`, `state.phase` and `state.step` of `pull-requests:ship-changed`, `checks` of `pull-requests:pull-request-changed` and a path that no event reports still take any text.
- A condition still compares text when the event fires, so a listed value and the value Malini sends must stay the same string.
- Enforced by `pnpm check` (the type of `values`), `src/contract/automation-trigger.test.ts` ("reads a stored trigger with a state its event never reports", "names the states an event reports for a state it never reports"), `src/lib/automations/platform/commands.test.ts` ("refuses a trigger on a state its event never reports, naming the states it does", "keeps a stored trigger on such a state: it lists and turns off, and a new one is refused") and `tests/e2e/automations-page.spec.ts` ("an automation's When, run mode and Then are fields of the automation, and a Then that would loop is refused").
