# 0124 - Milestone cards invite you to share your stats

Status: accepted

## Context

0123 tied share cards to a published profile, and the only way to them was the Stats panel and Settings.
The user's words: "user doesnt have a signing up intent, they have intent of showing the world how awesome they are", so Malini should notice a streak or a personal best and invite a share, with a piece of UI it lacked.
Of three prototypes the user picked the card peek: the real share card peeking out of the sidebar, with "a bit less shadow".
A moment must feel like a reward, not a nag, and must never interrupt work.

## Decision

- **Milestones.** `latestMoment` in `src/lib/stats/domain/moments.ts` reads the same Stats v1 snapshot as the share card, complete days through yesterday, and finds at most one moment, in this order:
  - a streak of 7, 30, 100 or 365 days, marked as your longest when no earlier streak in the snapshot was as long;
  - the first day a streak of at least 7 days beats the longest one before it;
  - yesterday's runs beating every earlier day, once at least 7 active days came before it;
  - the total runs crossing another thousand yesterday.
    Every moment needs runs yesterday, so a moment is always about the last complete day, and its id (`streak:<start>:<days>`, `best-day:<date>`, `runs:<total>`) never repeats.
- **When.** `stats.moment` in `src/lib/stats/platform/register.ts` answers with the moment and its share card, or nothing while any agent run is open.
  It works the moment out once per local day, since it depends only on complete days.
  The sidebar asks once when it mounts and again on every `chat:turn-finished`, so a card appears only between turns and stays until you act on it.
- **The card.** `MomentPeek` sits above the sidebar footer: a chip names the milestone, and the heatmap card, drawn by `shareCardPng` exactly as it is copied, peeks out tilted and straightens on hover.
  It hides while streamer mode masks personal data.
  Clicking it opens `MomentSheet`: both cards, then **Copy card** and **Copy link** when your profile is public, or "Claim `bestboy.dev/@handle` to share it", which starts the same sign-in and handle steps as **Publish my stats** in Settings, Profile.
  Copying the card dismisses the moment.
- **Your say.** The × dismisses a moment for good, and **Milestone cards** in Settings, Profile turns them all off.
  Both live in the renderer's `localStorage` under `malini.stats.moments`, keeping the last 50 dismissed ids; nothing about a moment leaves the Mac until you publish.

## Consequences

- A streak, a best day and a thousand runs now reach you without opening the Stats panel, and the sign-in shows up as claiming your handle at the moment you want to share.
- "Longest" and "best" look back over the 371 days Stats v1 carries; a longer history needs a read of every run.
- A moment that is never dismissed stays until the app restarts on a day without one.
- A new milestone kind changes `StatsMomentKind` in `$contract/stats`, the copy in `moment-copy.ts`, and the docs page `apps/site/content/profile.md`.
- Enforced by `src/lib/stats/domain/moments.test.ts` (each milestone, the longest-streak rule, quiet days) and `tests/e2e/profile.spec.ts` (a seeded 7-day streak peeks out, its sheet claims your profile, the switch hides it, a dismissal outlasts a reload).
