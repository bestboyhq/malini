# 0030 - Every event is documented and diffed

Status: accepted

## Context

Routines trigger on any contract event (ADR 0028), and agents inside Malini create jobs and routines through tools, so the event channels and their payloads became a public interface.
Users and LLM agents need one exact description of each event, and the public docs at bestboy.dev/malini must never drift from the code.
A release that renames a channel or reshapes a payload silently breaks the user's routines that filter on it.
The contract already lives in one typed place, `ContractEvents` in `apps/malini/src/contract/events.ts` (ADR 0002).

## Decision

`apps/malini/src/contract/event-catalog.ts` exports `EVENT_CATALOG`, a `Record<EventChannel, { description }>` with one sentence per channel: what happened and when it fires.
`apps/malini/scripts/generate-contract-reference.mjs` reads `ContractEvents` and `EVENT_CATALOG` with the TypeScript compiler API and expands each payload type into the contract declarations it uses.
It writes `apps/malini/src/contract/contract-reference.generated.ts` (`CONTRACT_REFERENCE`) and `apps/site/content/reference/events.md`.
`pnpm --filter malini generate:contract-reference` regenerates both, and `dev` and `build` run it first.
At boot, after jobs register, the app platform (`src/lib/app/platform/contract-updates.ts`) compares the stored `app.last-seen-version` and `app.last-seen-contract` settings with the running version and `CONTRACT_REFERENCE`.
When the version changed and events were added, removed or changed payload, it emits `app:updated` with `{ from, to, changes }`; the first launch and an update with an unchanged contract only store the new state.
The jobs platform answers `app:updated` by running the built-in Check compatibility job with the changes as its context, in the newest workstream, and the agent repairs the affected jobs and routines through Malini's tools with the user's approval, never deleting anything.
A second built-in job, Update docs, brings any repository's docs up to date with its base branch in a new workstream and opens a draft.

## Consequences

Adding an event without a description fails `pnpm check`, because `EVENT_CATALOG` is a record over `EventChannel`.
A stale reference or events page fails `pnpm check` through `generate-contract-reference.mjs --check`.
Changing a payload is now a user-visible change: the next update starts Check compatibility for every user whose Malini has seen the old contract.
The compatibility job runs in an arbitrary workstream until jobs gain an app-level target.
A new built-in job key needs a migration, since `job_definitions.builtin` lists its keys in a CHECK constraint (migration 51).
`src/lib/app/platform/contract-updates.test.ts` and `src/lib/jobs/platform/register.test.ts` cover the diff, the boot announcement and the job start.
