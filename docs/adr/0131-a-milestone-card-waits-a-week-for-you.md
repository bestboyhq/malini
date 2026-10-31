# 0131 - A milestone card waits a week for you

Status: superseded by 0135

## Context

0124 found at most one moment, and only about yesterday, so a milestone you did not see on its day was gone for good.
On the user's own history, the 3,000th run on Oct 28 never showed: the cards shipped on Oct 30, and the restart that brought them found nothing about Oct 29.
The same rule dropped their 1,000th and 2,000th runs, because a best day on the same day came first and only one moment fit.
The user's words: "I may have hit a milestone in the past, so I should see the card if I did, right?", and the card "is gonna be the main entrance for the funnel to create an account".
Seeing it on their own sidebar, the user added: "that card should be showing up instead of archived list, not together with it".
On the copy, 0124's cheers ("You're on fire", "Unstoppable", "Legendary") read as the hype every app uses, and the sheet turned the reward into a toll ("Claim … to share it"); of three prototyped voices the user picked the one that names how you work, and asked for more: "we're going after devs, builders or founders. Our copy could be more playful, sarcastic quality lines".
Of four playful voices (deadpan, founder mode, dev in-jokes, overworked agents) they picked overworked agents, "by far the best style": you run a team, and the team has opinions.
Then the user found the whole card too much once your profile is claimed: "card nudge only if some1 hasnt claimed it before", with only the badge and a secondary **Share** button after.
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
  The sidebar asks once when it mounts and again on every `chat:turn-finished` and `stats:profile-changed`, so a card appears only between turns, carries your handle as soon as you claim it, and stays until you act on it.
- **The card.** `MomentPeek` sits above the sidebar footer and takes the place of **Recently archived**, which `Sidebar.svelte` hides while `momentQuery` has a card: a line badge names the milestone and lets your agents complain about it, a pack glyph in its own semantic tint and no pill, all from `moment-copy.ts`: a flickering `flame` for "7 days straight, agents skipped lunch", `bolt` "30 days straight, agents want PTO", `crown` "100 days straight, agents are unionizing", `sun` "A whole year, agents threw a party", `trophy` "12 days straight, agents are impressed" for a longest streak, `trend-up` "311 runs in a day, agents need a nap", `sparkles` "3,000 runs, agents want a raise".
  The sheet's title is the same line as two sentences, and every line fits the badge's 264px beside its ×.
  Until your profile is public (`publishedProfileUrl` in `src/lib/stats/domain/published-profile.ts`), the heatmap card, drawn by `shareCardPng` exactly as it is copied, peeks out tilted and straightens on hover: it is the nudge to claim.
  Once it is public, only the badge shows, with a secondary **Share** button that opens the sheet, and the badge takes two lines, the milestone over its aside beside a 20px glyph, since one line beside **Share** and × would cut even "agents skipped lunch".
  It hides while streamer mode masks personal data, a check `momentQuery` owns so the card and the archived list never disagree.
  The card or **Share** opens `MomentSheet`: both cards, then **Copy card** and **Copy link** when your profile is public, or "Brag at `bestboy.dev/@handle`" ("Numbers only, never your code. Your agents won't tell.") with **Claim @handle**, which starts the same sign-in and handle steps as **Publish my stats** in Settings, Profile.
  Copying the card dismisses the moment.
- **The Stats panel.** Its **Share card** nudge speaks the same voice, "Your agents did the work. Take the credit on bestboy.dev.", one sentence per line, and still offers **Publish my stats**, the name of the switch it opens.
- **Your say.** The × dismisses a moment, and with it every older one, for good, and **Milestone cards** in Settings, Profile turns them all off.
  Both live in the renderer's `localStorage` under `malini.stats.moments`, keeping the last 50 dismissed ids; nothing about a moment leaves the Mac until you publish.

## Consequences

- A restart, a day away or a busy day no longer loses a milestone; it waits up to 7 days, and two milestones on one day show one after the other.
- Closing a card never brings back an older one, so the card stays a reward, not a queue; it brings back **Recently archived** instead.
- The sidebar shows one thing above its footer, so the card no longer squeezes the workstream list.
- "Longest" and "best" look back over the 371 days Stats v1 carries; a longer history needs a read of every run.
- A moment that is never dismissed stays until the app restarts once the week has no moment.
- A new milestone kind changes `StatsMomentKind` in `$contract/stats`, the copy in `moment-copy.ts`, and the docs page `apps/site/content/profile.md`.
- Enforced by `src/lib/stats/domain/moments.test.ts` (each milestone, the longest-streak rule, two moments on one day, the week's edge, which moment a dismissal leaves) and `tests/e2e/profile.spec.ts` (a 7-day streak that ended three days ago peeks out in place of recently archived, its sheet claims your profile, the switch hides it, a dismissal outlasts a reload; once the profile is public, the same milestone shows only its badge, whose **Share** opens **Copy card** and **Copy link**).
