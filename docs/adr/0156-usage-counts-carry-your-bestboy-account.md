# 0156 - Usage counts carry your Bestboy account, and stop on old terms

Status: accepted

## Context

0143 kept usage data on until you turn it off because it carried no id, and nothing told anyone it was on; everything else in 0143 still stands.
The user wants usage counts on by default in every Bestboy app, with a short notice and an off switch, and the counts of someone signed in to carry their Bestboy account, "so he can see which accounts are most active on which days".
A first notice, a setup step and a sidebar card with a heading and a button, was turned down: the user "found Grip's full-page notice far too big" and asked for "one line of fine print (12px, muted)" at the bottom of every setup step, in the same spot "so buttons don't jump between steps", and nothing new for people who set up before.
That line was turned down too: the user said "this text at the bottom just looks horrible" and asked to "just kind of blend it into the existing design", with "Turn it off in Settings" as the wording everywhere, since "Settings turns them off" read as weird.
The platform counts nobody's account events until they accept its Terms and Privacy Policy of November 2, 2026 (0155), and its `docs/api.md` in `bestboyhq/platform` says Malini's events carry `userId`, the lowercase hex sha256 of `<site>:<user.id>`, only on the current terms, that Malini sends nothing while signed in on older ones, and that `malini_desktop_stats_off` "never carries an ID and always goes".
Logdash's `POST /web_events` takes that hash as an optional `userId` per event, so the raw id never leaves the Mac.

## Decision

- `Bestboy.me` in `src/lib/stats/platform/bestboy.ts` reads `user.id` and keeps it as `acceptedUserId` only while `user.terms` equals a non-empty `terms`.
  `StatsProfile` saves it with the account in `bestboy-profile.json`; a save from before this change reads as `null`.
- `StatsProfile.usageAccount()` answers `accepted` with the id, `old-terms` while the saved terms are unaccepted, or `anonymous` when signed out or without an id; **Sign out** and a 401 make it `anonymous` at once.
  When the last `/api/me` is more than an hour old, it asks again before it answers, and every count that asks meanwhile waits on that one call.
- `registerStats` runs before `registerApp` in `src/main/modules.ts`, so the `app_active` count at launch can ask it.
- `startUsageData` in `src/lib/app/platform/usage-data.ts` awaits the account for every count, loop and error name while sharing is on.
  `accepted` sends each `/web_events` event with `userId: logdashUserId(site, id)`, `anonymous` sends it without, and `old-terms` sends nothing, not even the error names to `/logs`, which never carry an id.
  A count still waiting when the switch turns off is dropped.
- The **Share usage stats** switch goes through `app.share-usage-data { shared }` instead of `app.set-setting`, so the main process sees it turn off and sends `malini_desktop_stats_off` once, with no props and no `userId`, whatever the account.
  Turning it on sends nothing extra, and nothing else goes while it is off; `DO_NOT_TRACK=1` and `MALINI_USAGE_DATA=off` still send nothing at all.
- The first setup step, **Connect Claude Code and GitHub**, reads "Malini runs Claude Code and works in your GitHub repositories. It shares usage stats, never your code or chats. Turn it off in Settings.", the user's own wording, in two lines of the setup card.
  The step's older first sentence, "Malini runs Claude Code with your Claude plan, and works in your GitHub repositories.", went, since with the two new sentences it left "in Settings." alone on a third line.
  The last two sentences hide while sharing is off or `DO_NOT_TRACK` is set; there is no notice step, card, heading, button or line of its own, and nobody past setup sees anything new.
- Settings, Privacy names the switch **Share usage stats** and describes it as "Once a day, Malini sends a few counts, like how many workstreams you started and merged, with your Bestboy account when signed in. Never your code or chats."
  The receipt under **Yesterday's numbers** no longer says "Nothing in it says it's you", and does not repeat the account.

## Consequences

- Logdash counts days and loops per Bestboy account for people signed in on current terms, and the same hash joins them to the platform's own events.
- Someone signed out or never signed in sends the same counts as before, with no id; someone signed in on old terms sends none until they accept, so their days are missing, not anonymous.
- `malini_desktop_stats_off` counts the people the numbers leave out, once per switch-off.
- A count waits on `/api/me` at most once an hour, so it can still carry an id for up to an hour after the platform changes its terms.
- People who set up before learn about the account only from the Settings switch's description and the privacy policy.
- Enforced by `src/lib/app/platform/usage-data.test.ts` (the id on current terms, none signed out, nothing at all on old terms, nothing sent or asked once off, `stats_off` once with no id even on old terms and nothing after it, the hash against a known vector), `src/lib/stats/platform/stats-profile.test.ts` (the three answers, one `/api/me` an hour shared by counts that ask at once, `anonymous` at sign-out), `tests/e2e/usage-stats.spec.ts` (the sentences in the first step's description and on no other step, none while `DO_NOT_TRACK` is set, the switch's name) and `tests/e2e/settings.spec.ts` (the switch stores off).
