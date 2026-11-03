# 0157 - Setup ends in a bare chat at Home that sets up the workspace

Status: accepted

## Context

Setup had five steps: Connect Claude Code and GitHub, Meet your jobs, Hear your afternoon, Where did you hear about Malini, and Open your first repository.
On the jobs step the user said "I'm not sure if anyone will even read that", and the built-in jobs are already one `/` away in every composer, on the Jobs card beside every chat and on the Jobs page.
On the repository step they asked to "just take you to the home screen or something like that so you don't feel like you're in the onboarding still".
They picked a chat at Home with nothing but the composer, because "it's super simple and it has little things to fuck up", asking "what are you working on?", since "the first goal is to basically populate the sidebar" and "the moment someone sends a message, we can show the sidebar and then we can set up their whole working space for them".
A new user cares about none of the rest of a Home chat yet: the chat tabs, the suggestions, "No workstreams yet" and the Jobs card.

## Decision

- `ONBOARDING_STEPS` in `src/lib/app/domain/onboarding.ts` is `accounts`, `sounds`, `heard-about`, and Continue or Skip on the last step finishes setup; `JobsIntro` and `OnboardingRepositoryStep` are deleted.
- `finishOnboardingCommand` picks the Home chat's id with `nextWorkstreamId`, provisions it with `startLeadChatCommand(HOME_SCOPE, { workstreamId, inBackground: true })`, opens it, and only then marks setup finished, so the setup card stays until the route changes.
- That id is the first chat, kept in `localStorage` under `malini.app.first-chat:v1` so a relaunch reads it before the first paint.
  `leaveFirstChatCommand` clears it once `firstChatBegan` in `src/lib/app/presentation/first-chat.ts`: a repository is connected, a prompt is pending, or the chat has a session.
- While `firstChatWaits`, `WorkstreamsLayout` drops the sidebar, `TopBar` its history, `WorkstreamPage` the lead status and inspector, and `WorkstreamLayout` the docked Jobs card.
  `ChatSurface` gets a `welcome` snippet that hides the chat tabs and suggestions, centers the composer with the placeholder "What are you working on?", and renders `FirstChatActions` under it: **Clone repo** and **Open folder**, the same commands the Repositories page runs.
  On the first send the actions fade, the composer slides to the bottom, and everything else comes back.
- `lineageInstructions` in `packages/agent-bridge/src/claude/instructions.ts` tells a Home lead, while Malini has no repositories, to set up the workspace first: work out the repositories from what the user says and `gh repo list`, add each with `repositories_clone`, one when one covers it, then carry on with what they asked.

## Consequences

- Setup is three steps, and the first thing a new user types fills the sidebar: the lead asks once to clone each repository, and it lands under its owner.
- Jobs are no longer introduced; a new user meets them on `/` and the Jobs card once the first chat starts.
- The bare chat has no sidebar link to Settings; the app menu's **Settings…** and `⌘,` still open it.
- The first chat is a real lead workstream from the moment setup ends, so a listing of workstreams or repositories on a fresh install holds the Home chat and Malini's lead space.
- The flow needs a lead's own approvals to show in its timeline; `LeadTimeline` now syncs its session's interactions, which it never did, so every approval a lead asked for itself read "No longer active" and its turn waited forever.
- Enforced by `tests/e2e/first-run.spec.ts` (three steps, heard-about last, the bare chat with its two buttons across a reload, the chrome back after a send and after a reload), `tests/e2e/lead-timeline.spec.ts` (a lead's own approval waits on its card and goes on once allowed), the `passSetup` walk every setup spec shares in `tests/e2e/harness.ts`, and `instructions.test.ts` (the setup line only for a Home lead with no repositories).
