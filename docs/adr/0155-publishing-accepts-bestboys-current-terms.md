# 0155 - Publishing accepts Bestboy's current terms

Status: accepted

## Context

bestboy.dev changed its Privacy Policy on November 2, 2026, and instead of emailing people, every Bestboy app tells them in place; the platform counts nobody's account events until they accept the current version.
`GET /api/me` carries `terms`, the date of the current Terms and Privacy Policy, and `user.terms`, the date this person accepted, or `null`; signing in accepts the current ones (`docs/api.md` in `bestboyhq/platform`).
Grip shows "Sharing accepts the Terms and Privacy Policy." under its Share button and sends `terms` with the item it creates.
Malini has no Share button: it uses the account only for Settings, Profile and **Publish my stats** (0129), so the user put the line beside that switch and the acceptance in the call that publishes.

## Decision

- `Bestboy.me` in `src/lib/stats/platform/bestboy.ts` reads both dates and keeps `unacceptedTerms`: the current date while it differs from the accepted one, else `null`.
  A platform that sends no `terms` shows nothing.
- `StatsProfile` saves it with the account in `bestboy-profile.json` from every `/api/me`, at sign-in and when Settings opens, and `ProfileState.unacceptedTerms` carries it to the renderer with `<origin>/terms` and `<origin>/privacy`, so `MALINI_BESTBOY_ORIGIN` points the links at a local platform too.
- While it is set, `PublishStatsSettings.svelte` shows "Publishing accepts the Terms and Privacy Policy." under the switch's description, and both links open in the default browser.
- Publishing sends `PUT /api/profile { handle, public: true, terms }` with that date, only while the line shows.
  The platform records acceptance only when the date equals its current one, ignores any other value, and publishes either way.
  Malini then asks `/api/me` again, so the line goes away once the dates match.
- No other call carries `terms`: the daily upload, a switch-off and a handle change never accept anything for you.
- The app still makes the four outbound calls `AGENTS.md` lists; this adds a field to one of them.

## Consequences

- A new terms date on the platform needs no Malini release.
- Someone who published before the change sees the line under a switch that is already on, and Malini accepts nothing for them until they publish again or sign in, in Malini, on the web or in Grip; turning the switch off and on seeds their profile again (0130).
- `apps/site/content/profile.md` describes the line.
- Enforced by `tests/e2e/profile.spec.ts`: after a fresh sign-in the line never shows and no `PUT /api/profile` carries `terms`; once the fake platform in `tests/e2e/fake-bestboy.ts` moves its date, the line shows, its links open `<origin>/terms` and `<origin>/privacy`, publishing sends the date, and the line goes away.
