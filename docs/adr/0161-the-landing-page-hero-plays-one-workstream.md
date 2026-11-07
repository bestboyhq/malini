# 0161 - The landing page hero plays one workstream

Status: superseded by 0176

## Context

0119's hero opened on an organization chat that started a workstream in malini, grip and tony, then rested on that chat as it reported three Open Graph directions.
The user: "Our landing page shouldn't be a lead chat, it should be work stream", and "Lead chat is a feature that can stay, it's more or less fine, but I don't think it should be our main thing."
The landing page already says what the main thing is: "Each task you start is a workstream", and its How it works steps are Start a task, then Press Draft, then Merge.
The chat above repositories keeps its own row, Chats, whose tour starts at Home (0120).
This replaces 0119's hero script; 0119's demo bridge, report cards, build and Open Graph view stay in force.

## Decision

- `Hero.svelte` opens `app` on `/workstreams/ws-tony-hero` with `?play=hero`.
- While the hero plays, `demo-live.ts` lists Tony's "Show the words in the hero" workstream with no name, files or runs, so it opens on a generated name and an empty chat.
  Under reduced motion, which skips the script, it lists the finished workstream instead.
- `demo-script.ts` puts that workstream's own prompt in the composer and sends it.
  `heroSteps` names the workstream as Name chats would, thinks `HERO_THOUGHT`, runs its four tools over `HERO_WORK_MS`, then lands its files, its run and its report with Tony's hero before and after.
- The cursor wipes the before and after, presses **Merge**, and opens Grip's "Captions land on the word" while Tony's pull request merges in the sidebar.
  It leaves because a merged workstream sends the app to Repositories, as `acceptShipChangeCommand` does in the app.
- The organization chat's script, its three started workstreams and the Grip and Tony Open Graph media are deleted.
  The Experiments card keeps the organization chat's report under `ws-og-lead`, and `demo-live.ts` keeps only the tour's `LeadScript`.
- `stats.profile` gets a signed-out demo handler, so the profile badge no longer logs a refusal when the demo boots.

## Consequences

- A visitor first sees one task go from prompt to report to merged pull request, the loop How it works describes, with the other workstreams waiting in the sidebar on a draft and a queued merge.
- The chat above repositories is one row further down instead of the first thing on the page.
- The script finds the app by `chat-composer-input`, `chat-composer-submit`, "Wipe between before and after", the "Merge" button and a sidebar row's `data-workstream-id`, so renaming any of them stalls it at that step.
- Nothing tests the script; `apps/site/tests/site.test.ts` fails only when the landing page stops embedding `app`.
