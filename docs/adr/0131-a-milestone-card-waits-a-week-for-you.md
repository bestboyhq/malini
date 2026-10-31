# 0131 - A milestone card waits a week for you

Status: accepted

## Context

0124 found at most one moment, and only about yesterday, so a milestone you did not see on its day was gone for good.
On the user's own history, the 3,000th run on Oct 28 never showed: the cards shipped on Oct 30, and the restart that brought them found nothing about Oct 29.
The same rule dropped their 1,000th and 2,000th runs, because a best day on the same day came first and only one moment fit.
The user's words: "I may have hit a milestone in the past, so I should see the card if I did, right?", and the card "is gonna be the main entrance for the funnel to create an account".
Seeing it on their own sidebar, the user added: "that card should be showing up instead of archived list, not together with it".
Everything else in 0124 still holds and is restated below.

## Decision

- **Milestones.** `recentMoments` in `src/lib/stats/domain/moments.ts` reads the same Stats v1 snapshot as the share card, complete days through yesterday, and lists every moment of the last 7 days, newest day first, each day in this order:
  - a streak of 7, 30, 100 or 365 days;
  - the first day a streak of at least 7 days beats the longest one before it;
  - a day's runs beating every earlier day, once at least 7 active days came before it;
  - the total runs, counted up to that day, crossing another thousand.
    Each moment carries its `date`, and its id (`streak:<start>:<days>`, `best-day:<date>`, `runs:<total>`) never repeats.
- **Which one.** `unseenMoment` in the same file shows the newest moment you have not dismissed, skipping any moment older than one you dismissed; a moment from the same day as a dismissed one still shows.
  `momentQuery` applies it to the list and to your dismissals, so a dismissal never needs the main process.
- **When.** `stats.moments` in `src/lib/stats/platform/register.ts` answers with the list and its share card, or nothing while any agent run is open or the week has no moment.
  It works the list out once per local day, since it depends only on complete days.
  The sidebar asks once when it mounts and again on every `chat:turn-finished`, so a card appears only between turns and stays until you act on it.
- **The card.** `MomentPeek` sits above the sidebar footer and takes the place of **Recently archived**, which `Sidebar.svelte` hides while `momentQuery` has a card: a line badge cheers and names the milestone, a pack glyph in its own semantic tint and no pill (a flickering `flame` for "You're on fire", `bolt` Unstoppable, `crown` Legendary, `sun` A whole year, `trophy` New record, `trend-up` Best day yet, `sparkles` for runs, from `moment-copy.ts`).
  Then the heatmap card, drawn by `shareCardPng` exactly as it is copied, peeks out tilted and straightens on hover.
  It hides while streamer mode masks personal data, a check `momentQuery` owns so the card and the archived list never disagree.
  Clicking it opens `MomentSheet`: both cards, then **Copy card** and **Copy link** when your profile is public, or "Claim `bestboy.dev/@handle` to share it", which starts the same sign-in and handle steps as **Publish my stats** in Settings, Profile.
  Copying the card dismisses the moment.
- **Your say.** The × dismisses a moment, and with it every older one, for good, and **Milestone cards** in Settings, Profile turns them all off.
  Both live in the renderer's `localStorage` under `malini.stats.moments`, keeping the last 50 dismissed ids; nothing about a moment leaves the Mac until you publish.

## Consequences

- A restart, a day away or a busy day no longer loses a milestone; it waits up to 7 days, and two milestones on one day show one after the other.
- Closing a card never brings back an older one, so the card stays a reward, not a queue; it brings back **Recently archived** instead.
- The sidebar shows one thing above its footer, so the card no longer squeezes the workstream list.
- "Longest" and "best" look back over the 371 days Stats v1 carries; a longer history needs a read of every run.
- A moment that is never dismissed stays until the app restarts once the week has no moment.
- A new milestone kind changes `StatsMomentKind` in `$contract/stats`, the copy in `moment-copy.ts`, and the docs page `apps/site/content/profile.md`.
- Enforced by `src/lib/stats/domain/moments.test.ts` (each milestone, the longest-streak rule, two moments on one day, the week's edge, which moment a dismissal leaves) and `tests/e2e/profile.spec.ts` (a 7-day streak that ended three days ago peeks out in place of recently archived, its sheet claims your profile, the switch hides it, a dismissal outlasts a reload).
