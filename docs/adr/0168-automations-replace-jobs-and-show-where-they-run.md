# 0168 - Automations replace jobs, and show where they run

Status: accepted

## Context

0055 named Malini's one kind of agent work a job, and 0147 kept a Job center, floating and docked in every workstream, as its one list and its one way into the Jobs page.
The user: "nobody likes jobs", "too weird of a paradigm for people to get", "rename jobs to automations very simple and we should keep them simple", "remove the right bottom panel", and a job running in a workstream "should be presented in that work stream rather than [...] inside of the global jobs gutter".
Suggestions matched prompts by wording: their database held 30 dismissed and none accepted, prompts a Home chat sent to several workstreams counted as theirs, and accepting one copied the first prompt with no trigger.
Their own habit sat elsewhere: 55 minutes after #73 merged they asked whether its changelog went out, and "automations often happen [...] when you have a work stream and then you merge it [...] and you do something more", while "not everyone will always have their work streams deployed directly to production", so Malini must not ship an opinion such as a changelog after every merge.
On event channels: "if someone updates the app they will just get a different name already", so `jobs:*` is renamed too and a migration carries what the database saved under the old names.
Of four suggestion cards they picked variant D (Draft), with "a composer with a tray attached to the top edge of it" in place of a header.
On the built card they wanted that "bar with buttons to be below the card, not above of it", and Automations "shouldn't live in the sidebar", but "between the sidebar and settings icons".

## Decision

- **Automations** is the one word, in what you read and in code: `src/lib/automations`, `$contract/automations.ts`, the commands `automations.*`, the events `automations:*`, the agent tools `automations_list`, `automations_save` and `automations_run`, the route `/automations`, and the docs page `apps/site/content/automations.md`.
  `apps/site/worker/index.ts` sends `/malini/docs/jobs` and `/malini/docs/jobs.md` to their Automations page.
  GitHub Actions jobs keep their name.
- Migration 96 renames every `job_*` table and column to `automation_*`, rewrites `jobs:` to `automations:` in saved triggers, the event log and reconciler candidates, moves the `jobs.max-concurrent` setting and the recorded `jobs_*` agent actions and tool calls, revokes remembered permission rules on `jobs.*` commands, and drops `job_suggestions` for `automation_suggestions` and `automation_asks`.
- The Job center is gone, floating and docked.
  A run in a workstream shows in that workstream, under **Automations (n)** above its composer (`WorkstreamAutomationRuns`); a run with no workstream shows under **In progress** on the Automations page.
  An **Automations** icon in the top bar, between the sidebar and Settings icons, opens the page; a dot says something needs you or runs, and its name says what, such as "Automations, 1 needs you".
  The sidebar holds workstreams and chats only.
- `suggestAutomationsAfterMerges` (`src/lib/automations/platform/suggestions.service.ts`) hears every succeeded `chat:turn-finished`.
  For a prompt you typed, it finds the latest merge logged in that workstream in the 24 hours before it, keeps only the first ask after each merge (`automation_asks.merge_event_id` is unique), and gives up to six earlier unsuggested asks in that repository to the built-in **Suggest automations** (Haiku, low effort) through the bridge's `answer` command and `HABIT_SCHEMA`.
  When the model names earlier asks that want the same outcome, Malini saves a suggestion whose When is `on pull-requests:ship-changed where merged is set and repositoryId is <id>` (`mergedInRepositoryWhen`) and emits `automations:suggested`.
- `AutomationSuggestionCard` sits under the reply that suggested it, through the transcript's `afterRun` snippet, and on the Automations page.
  Its tray, under the card, reads **Suggested automation**, with why on hover ("You asked this after #73 and #75 merged."), and **Not now**, **Edit** and **Save it**; its card shows **When**, **Does** and **Runs**.
  **Edit** changes the name, what it does and Ask me first or On its own in place; **Save it** saves an automation in a new workstream on the default model, Ask me first unless you changed it, and the card stays as **Saved as an automation** with **Open**.
- No built-in automation acts after a merge: Malini suggests only what you asked after two merges.
- This replaces 0055's names (`jobs.*`, `jobs:*`, `jobs_*`, `JobDefinitionRecord`) and its line "Suggestions move to the jobs domain [...] shown on the Jobs Overview", 0147's Job center bullets, its line "The docked Job center in a workstream stays as the way into the Jobs page (0146) [...]", and 0068's "the Job Center's **Recent** keep it".
  The rest of 0055, 0068 and 0147 stands under the new names.

## Consequences

- One word for one idea, and what runs in a workstream is seen there, not in a list that covers every workstream.
- Saved triggers, run history and settings survive the update; an agent's remembered yes to a `jobs.*` command is asked again once.
- A suggestion needs two merges Malini logged in one repository and the same ask after each; schedules and other events are not suggested yet.
- Every suggestion costs one Haiku call, and only after a second first-ask following a merge.
- Enforced by `src/main/db/migrations.test.ts` (migration 96), the "suggestions after merges" tests in `src/lib/automations/platform/register.test.ts`, `src/contract/automation-trigger.test.ts`, `src/lib/automations/domain/live-automations.test.ts`, `pnpm check` (the generated contract reference and the bridge protocol), `apps/site/tests/site.test.ts` (the Jobs docs redirect), and `tests/e2e/automation-runs.spec.ts` (a suggestion under the reply, edited and saved), `tests/e2e/automations.spec.ts` (a workstream lists only its live automations and the top bar counts them) and `tests/e2e/event-reconciler.spec.ts`.
