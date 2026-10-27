# 0091 - The reconciler is always on, and its rules declare the events they hear

Status: accepted

## Context

0085 let you turn off the model step behind the rules in Settings, Jobs, **Reconcile events** (`jobs.reconciler`), and named the built-in job that step runs Reconcile events too.
Reading 0090's gap, that with it off a started workstream's "Needs:" reaches no one, the user said: "I don't think we should ever allow turning reconcile events off. I was sure that every single event that happens within the platform gets reconciled."
Every event did reach `Reconciler.handle` and its rules, but the model step was the only reaction to a turn ending in a started workstream, a chat's job finishing or failing, and a merge stopping on conflicts nobody resolves, so the switch, a failed Haiku call or an unreadable setting all ended those events with nothing.
Check compatibility started from its own `app:updated` subscription, outside the reconciler and against `eda.mdc`, with no cause, so the Explorer drew its run under **Your triggers** while no job had a trigger.
The user asked whether one event can start many things and "where that definition lives": each rule checked the channel inside its own handler, across five files, and the Explorer guessed the rule from `run.origin`.
They agreed that the count belongs to the reactions, not the event: independent duties all run, alternatives get one pick, and telling an existing job is folding into it, with every rule's events in one list.

## Decision

- **No switch.** `JOBS_RECONCILER_SETTING`, `reconcilerMode` and the Settings, Jobs row are gone, and migration 69 deletes a stored `jobs.reconciler`.
- **One list.** `RULE_EVENTS` in `src/lib/jobs/domain/reconciler.ts` names the events each rule of `RECONCILER_RULES` hears: Your triggers every event (each job's `when` filters it), Thens Job finished, Shipping the nine events its handler switches on, Resume Malini started, Schedules Time reached, Compatibility Malini updated, and then the model step Turn finished, Job finished and Merge conflicted.
  `Reconciler.handle` calls a rule only for an event it hears (`ruleHears`); every rule that hears it runs at once and starts as many things as it needs, and a rule that throws is logged by name.
  The model step runs after them for an event no trigger matched, and picks exactly one candidate.
  A repeat ask to an existing job still folds into its waiting or queued run, and wakes for a busy chat still go as one prompt (0085).
- **Compatibility is a rule.** `checkCompatibility` (`src/lib/jobs/platform/compatibility-check.ts`) runs Check compatibility on `app:updated` in the newest workstream, with the event as its cause, once per update (`triggeredBefore`), as the new run origin `compatibility`; migration 69 rebuilds `job_runs` and `job_run_events` so the origin check admits it.
- **A default when the model can't answer.** When the model call fails or its pick is none of the candidates, `validatePick` takes Malini's default: wake the chat waiting on the work, else ask you, never run a job.
  The decision records `rules` as who decided and why the model gave no pick, and the wake budget still turns a fourth wake into a question.
- **Choose a reaction.** The built-in `reconcile` job is named Choose a reaction, and migration 69 renames it unless you renamed it.
- **The Explorer reads the list.** Its rule rows come from `RECONCILER_RULES`, each note from `RULE_EVENTS` ("on Button clicked and 8 more"), a selected rule lists every event it hears, a **Malini updated** row joins the log, and a `compatibility` run goes through the Compatibility rule.
  Event names keep "Malini" and "MCP" capitalized inside a sentence.

## Consequences

- An event that may need a reaction always gets one, even with Haiku unreachable: a started workstream's "Needs:" or failure always reaches its lead or you, so 0090's consequence about Reconcile events off no longer holds.
- Haiku runs for every such event no trigger handles; only the three kinds of events and folding per subject bound it now.
- A rule that starts handling a new event adds it to `RULE_EVENTS`, or the reconciler never hands it over; a new rule adds a key to `RECONCILER_RULES`, a handler to `ReconcilerRules` and a label to `RULE_LABELS`, which `pnpm check` demands, and an origin when it starts jobs.
- `app:updated` is replayed at boot like every logged event, and `triggeredBefore` keeps a replay from starting Check compatibility twice.
- The new origin changes `JobRunRecord` in the contract, so the update that ships it runs Check compatibility once for jobs that filter on `run.origin`.
- This changes 0085's Settings line, its list of rules and the name Reconcile events, and 0090's consequence about turning it off; the rest of both stands.
- Enforced by `src/lib/jobs/domain/reconciler.test.ts` (the default pick), `src/lib/jobs/platform/reconciler.service.test.ts` (a rule gets only the events it hears, the default wake when the model cannot be asked, a trigger keeps the model out), `src/lib/jobs/domain/explorer.test.ts` (the Compatibility route, and a row of its own for every event a rule hears), `src/lib/jobs/platform/register.test.ts` (Check compatibility once per update, through its rule, with its cause), `src/main/db/migrations.test.ts` (migration 69 keeps every run and its events, admits `compatibility`, renames the job and drops the setting), and `tests/e2e/event-reconciler.spec.ts` ("Malini updating starts Check compatibility through the Compatibility rule, and the Explorer says why", "when the model gives no answer, Malini still wakes the lead, and Activity says its rules picked") and `settings.spec.ts`.
