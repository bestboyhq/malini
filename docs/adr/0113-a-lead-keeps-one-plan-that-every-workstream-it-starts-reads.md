# 0113 - A lead keeps one plan that every workstream it starts reads

Status: accepted

## Context

A lead told each workstream what to build only in its first prompt and later sends, so the shared parts lived in many prompts.
In the "Public profile workstreams" chat, the lead read code for 19 minutes on screen, pasted the contract between the workstreams into each prompt by hand, and sent one of them a literal `CONTRACT_PLACEHOLDER_PLATFORM`.
A lead that starts every turn fresh (0108) also needs somewhere to keep what it worked out, since the timeline holds only what the user sees.
The lead reads only Malini's clones of its repositories (0070), and could not read the checkouts of the workstreams it started.

## Decision

- A lead's plan is `.context/plan.md` in its own checkout (`LEAD_PLAN_PATH` in `src/contract/leads.ts`, `leadPlanPath` in `src/lib/shared/repositories/platform/lineage.service.ts`), beside the captures its agent keeps there (0045).
- Bridge protocol 43 adds the pre-approved `plan_write` tool (0111), which writes the whole plan (`writeLeadPlan` in `src/lib/chat/platform/lead-decisions.service.ts`) and refuses a chat that is no lead.
- The lineage of protocol 40 grows: `lead.plan` names the lead's plan and `lead.workstreams` the checkouts of the workstreams it started, and `startedBy.plan` hands a workstream its lead's plan once the file exists (`workstreamLineage`).
- `lineageDirectories` (`packages/agent-bridge/src/agent-profile.ts`) adds those checkouts to a lead's `additionalDirectories`, and the plan's folder to a started workstream's, so each reads them without asking.
- The lead's instructions say to write the plan with `plan_write` before starting workstreams and keep it current: what each workstream builds, the contract between them and the decisions so far; to point to it in prompts instead of pasting it; and to tell each workstream with `workstreams_send` when it changes.
- A started workstream's instructions say to read the plan before it starts, build against it, read it again when its lead says it changed, and never edit it.
- The timeline shows each write as **Lead rewrote the plan every workstream reads** (0114), and the lead's brief has a line for it (0108).

## Consequences

- The contract between workstreams has one home, and a change reaches every workstream through the plan and one short prompt each.
- A workstream started before the plan exists learns of it on its next turn, which restarts its Claude Code like any changed lineage (0070).
- The plan is the lead's memory across fresh turns; a lead that leaves it stale works from a stale plan.
- A lead reads, but never writes, the checkouts of the work it started; only the plan is its to write.
- Enforced by `lead-decisions.service.test.ts` ("writes the plan into the lead's checkout", "refuses a chat that is no lead and an empty plan"), `workstreams.test.ts` (the lineage with the plan and the started checkouts), the bridge's `session.test.ts` ("keeps a lead chat to reading and planning what it started, and hands a started workstream its plan and siblings"), `instructions.test.ts` and `protocol.test.ts`, and `tests/e2e/lead-timeline.spec.ts`, whose lead writes the plan with `plan_write` and finds it on disk.
