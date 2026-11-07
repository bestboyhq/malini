# 0178 - Setup asks for your defaults, and their triggers hold them

Status: accepted

## Context

0159 cut setup to three steps, Connect, Sounds and Heard-about, once the user said of the old jobs step "I'm not sure if anyone will even read that", and 0163 kept those three steps.
What Malini does without asking was left to defaults nobody saw: Resolve conflicts ran on its trigger, Update from main ran when main reached a workstream's files (0137), and Address review ran only once Shipping found a review while it merged.
For setup and Settings the user asked for "customized vs recommended defaults selection", "checkbox: auto resolve conflicts?" and "checkbox: auto address review?", with "descriptions for each option even with recommended ones".
About Update from main they said "Id love my all workstreams always to do it, but thats because there arent many contributors on repos im working on", and that a common change covered in two workstreams should reach the second "right away w/o me even thinking of it".
Each of these is already one built-in automation's trigger, which its page edits, so a stored "defaults" value would be a second truth that the automation's page could contradict.

## Decision

- **Setup has four steps.**
  `ONBOARDING_STEPS` in `src/lib/app/domain/onboarding.ts` is `accounts`, `sounds`, `defaults`, `heard-about`, so **Pick your defaults** is step 3 of 4.
  **Recommended**, picked to start with, lists every default with what it does; **Customize** shows a checkbox for **Resolve merge conflicts**, **Address review comments** and **Keep a second brain**, and **Touches my files**, **Always** or **Never** for **Update from main** (0180).
- **The triggers are the setting.**
  Malini stores no defaults: **Continue** rewrites the trigger of each built-in automation through `automations.save-definition`, `auto` for a ticked one and `off` for one left unticked, and Update from main gets the When of its mode.
  `RECOMMENDED` in `src/lib/app/domain/automation-defaults.ts` is the constant map, Resolve conflicts, Address review and the second brain on and Update from main on **Touches my files**, and `defaultsTriggerChanges` turns a choice into the trigger changes it needs.
  **Keep a second brain** runs `brain.set-up` (0181), which arms its two automations, without holding **Continue**.
- **Settings reads them live.**
  Settings, Automations shows the same switches above its limits, under a **Defaults** row whose **Recommended** and **Custom** come from `defaultsChoice` over the automations' live triggers on every read, so setup, Settings and each automation's page never disagree.
  It reads **Recommended** only while every one of them runs on its own with the recommended When; **Ask me first** counts as on, but not as Recommended.
  Pressing **Recommended** applies the map, and changing any switch reads **Custom**.
- This changes 0159's `ONBOARDING_STEPS` line and 0163's "The three setup steps [...] stay as they are" only in the new step; the rest of both stands.

## Consequences

- A new user sees, once, what Malini does on its own, and turns any of it off before it happens.
- An install that finished setup before this never sees the step and keeps every trigger as it was; only a new install, the step and Settings turn Address review on (0179).
- A default is one automation's trigger, so a When you write by hand on an automation's page shows as **Custom**.
- Enforced by `src/lib/app/domain/automation-defaults.test.ts` (the map, the derived choice and the trigger changes), `tests/e2e/first-run.spec.ts` (Recommended turns every default on; Customize with a box unticked writes `off` and keeps it across a reload) and `tests/e2e/settings.spec.ts` (a switch flips Recommended to Custom, and Recommended flips it back).
