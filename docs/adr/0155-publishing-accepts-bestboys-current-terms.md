# 0155 - Publishing accepts Bestboy's current terms

Status: accepted

## Context

bestboy.dev changed its Privacy Policy on November 2, 2026, and instead of emailing people, every Bestboy app tells them in place; the platform counts nobody's account events until they accept the current version.
`GET /api/me` carries `terms`, the date of the current Terms and Privacy Policy, and `user.terms`, the date this person accepted, or `null`; signing in accepts the current ones (`docs/api.md` in `bestboyhq/platform`).
Grip shows "Sharing accepts the Terms and Privacy Policy." under its Share button and sends `terms` with the item it creates.
Malini has no Share button: it uses the account only for Settings, Profile and **Publish my stats** (0129), so the user put the line beside that switch and the acceptance in the call that publishes.
Someone who already publishes has no action left that publishes, and the user's call was: "Someone who already publishes keeps publishing as before; the platform simply doesn't count their account events until they sign in again or publish anew", which keeps the promise that the new terms apply only once you accept them.

## Decision

- `Bestboy.me` in `src/lib/stats/platform/bestboy.ts` reads both dates and keeps `unacceptedTerms`: the current date while it differs from the accepted one, else `null`.
  A platform that sends no `terms` shows nothing.
- `StatsProfile` saves it with the account in `bestboy-profile.json` from every `/api/me`, at sign-in and when Settings opens.
  `ProfileState.unacceptedTerms` carries it to the renderer with `<origin>/terms` and `<origin>/privacy`, only while publishing is not on, so `MALINI_BESTBOY_ORIGIN` points the links at a local platform too.
- While it is set, `PublishStatsSettings.svelte` shows "Publishing accepts the Terms and Privacy Policy." under the switch's description, and both links open in the default browser.
  It shows while the switch is off and in the handle step that follows turning it on, whose **Publish** is the action that accepts; once publishing is on, it shows nothing.
- Publishing sends `PUT /api/profile { handle, public: true, terms }` with that date, only while the line shows: `publish` takes the date from the same `ProfileState`.
  The platform records acceptance only when the date equals its current one, ignores any other value, and publishes either way.
  Malini then asks `/api/me` again, so the line goes away once the dates match.
- No other call carries `terms`: the daily upload, a switch-off and a handle change never accept anything for you, and Malini has no Accept button.
- The app still makes the four outbound calls `AGENTS.md` lists; this adds a field to one of them.

## Consequences

- A new terms date on the platform needs no Malini release.
- Someone who published before the change sees no line and keeps publishing as before; the platform counts none of their account events until they sign in again, in Malini, on the web or in Grip, or publish anew, which seeds their profile again (0130).
- `apps/site/content/profile.md` describes the line.
- Enforced by `tests/e2e/profile.spec.ts`: after a fresh sign-in the line never shows and no `PUT /api/profile` carries `terms`; once the fake platform in `tests/e2e/fake-bestboy.ts` moves its date, the line stays hidden while the switch is on, shows once it is off, its links open `<origin>/terms` and `<origin>/privacy`, publishing anew sends the date, and the line stays away after the next switch-off.
