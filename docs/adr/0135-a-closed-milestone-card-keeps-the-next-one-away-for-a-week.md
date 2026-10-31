# 0135 - A closed milestone card keeps the next one away for a week

Status: accepted

## Context

0131 let the × hide only the milestone it closed and every older one, so any newer milestone showed as soon as it existed, and two from one day showed one after the other.
A heavy user reaches one every few days: a best day, another thousand runs, a longer streak.
On the day 0131 shipped the user closed the card "a bunch of times today" and found it "way too intense": "it should be like an event, a big one", "probably once in a week", "let them really wait because if we are gonna ping them every 15 minutes, someone is gonna get pissed off".
The e2e reproduction: close **7 days straight**, reach a best day the next day, and **2 runs in a day** peeks out at the next launch.
Everything else in 0131 still holds and is restated below.

## Decision

- **Milestones.** `recentMoments` in `src/lib/stats/domain/moments.ts` reads the same Stats v1 snapshot as the share card, complete days through yesterday, and lists every moment of the last 7 days, newest day first, each day in this order:
  - a streak of 7, 30, 100 or 365 days;
  - the first day a streak of at least 7 days beats the longest one before it;
  - a day's runs beating every earlier day, once at least 7 active days came before it;
  - the total runs, counted up to that day, crossing another thousand.
    Each moment carries its `date`, and its id (`streak:<start>:<days>`, `best-day:<date>`, `runs:<total>`) never repeats.
- **Which one.** `unseenMoment` in the same file shows the newest moment until you close a card.
  After that, it shows nothing for 7 days from the local day you closed it, and then only a moment dated on or after that day, so every card after the quiet week is one you have never seen.
  It counts the days from the list's own `through`, which `stats.moments` now returns, so the rule is a pure function of the list and the day you closed a card, and `momentQuery` re-reads it whenever a new day's list arrives.
- **When.** `stats.moments` in `src/lib/stats/platform/register.ts` answers with the list, its `through` and its share card, or nothing while any agent run is open or the week has no moment.
  It works the list out once per local day, since it depends only on complete days.
  The sidebar asks once when it mounts and again on every `chat:turn-finished` and `stats:profile-changed`, so a card appears only between turns, carries your handle as soon as you claim it, and stays until you act on it.
- **The card.** `MomentPeek` sits above the sidebar footer and takes the place of **Recently archived**, which `Sidebar.svelte` hides while `momentQuery` has a card, with the badge, glyphs, voice and sheet of 0131 unchanged in `moment-copy.ts`, `MomentPeek.svelte` and `MomentSheet.svelte`.
  Until your profile is public the heatmap card peeks out tilted as the nudge to claim; once it is public only the badge shows, with a secondary **Share** button.
  It hides while streamer mode masks personal data.
- **Your say.** The × closes the card, and so does **Copy card** in its sheet; **Milestone cards** in Settings, Profile turns them all off.
  Both live in the renderer's `localStorage` under `malini.stats.moments` as `{ on, dismissedOn }`, the local date you last closed a card, in place of 0131's list of dismissed ids; a saved list with ids counts as closed on the day it is first read, so an update never brings back a card you closed.
  Nothing about a moment leaves the Mac until you publish.

## Consequences

- You see at most one new milestone card a week, and a card that shows is always news.
- A milestone reached during the quiet week can still show after it, while it is within its 7 days; one that is older by then is gone for good, so a busy week shows its newest milestone, not a queue.
- A card you never close stays, and turns into a newer milestone as one arrives, without a new entrance.
- "Longest" and "best" look back over the 371 days Stats v1 carries; a longer history needs a read of every run.
- A new milestone kind changes `StatsMomentKind` in `$contract/stats`, the copy in `moment-copy.ts`, and the docs page `apps/site/content/profile.md`.
- Enforced by `src/lib/stats/domain/moments.test.ts` (each milestone, the longest-streak rule, two moments on one day, the week's edge, the quiet week and its end) and `tests/e2e/profile.spec.ts` (a closed card keeps a best day reached the next day away across a relaunch, plus 0131's flows: the card in place of recently archived, its sheet, the switch, the badge with **Share** once public).
