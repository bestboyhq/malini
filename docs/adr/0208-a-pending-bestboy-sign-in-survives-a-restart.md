# 0208 - A pending Bestboy sign-in survives a restart

Status: accepted

## Context

0121 signs in to Bestboy with PKCE in the browser and the code back through `malini://auth`, and 0129, which carries that sign-in forward, says `stats-profile.ts` "gives up after 10 minutes" and `src/main/index.ts` "routes `open-url` and second-instance URLs to the pending sign-in".
The pending sign-in, its PKCE verifier and `state`, lived only in memory, so a sign-in that came back after Malini restarted, as `pnpm dogfood` does when a merge lands, found nothing to match and changed nothing.
`src/main/index.ts` passed each link to `modules?.openUrl`, so a link that arrived before the modules existed, as when the link itself launches Malini, was dropped.
When the 10 minutes ran out, the sign-in ended and set no problem, so Profile never said why it stopped.
0121 and 0129 keep their status; this record changes only where the pending sign-in lives, how a link reaches it, and what its end says.

## Decision

- `PendingSignIn` in `src/lib/stats/platform/profile-store.ts` is `{ verifier, state, until }`, and `SavedProfile.signIn` keeps it in `bestboy-profile.json`, with the verifier sealed by the same `safeStorage` cipher as the token, in the same `0600` file.
- `StatsProfile.signIn()` sets `until` to now plus `SIGN_IN_TIMEOUT_MS`, 10 minutes, saves the pending sign-in, and opens the browser only once that save has settled.
  A Mac that cannot seal refuses the sign-in as before, and now also ends one already pending.
- `ProfileStore.load()` keeps `signIn` only when it is a record with a verifier it can unseal, a string `state` and a number `until`; anything else, a file written before this change included, loads as `signIn: null`.
- At launch, the `StatsProfile` constructor keeps a pending sign-in whose `until` is still ahead and drops one that ran out, with no message, and `start()` waits out the time left.
- When the time runs out, `#waitForSignIn` saves `signIn: null` and sets the problem "Malini stopped waiting for your Bestboy sign-in after 10 minutes."
  Finishing, cancelling and a browser that would not open also save `signIn: null`.
- `completeSignIn` accepts only `malini://auth` with a `code` and the saved `state`, as 0121 had it, and exchanges the code with the saved verifier.
- `urlInbox()` in `src/main/url-scheme.ts` holds links until it has somewhere to send them.
  `src/main/index.ts` creates it before boot, sends it each `open-url` link and each `malini://` argument of `second-instance`, and calls `deliverTo(modules.openUrl)` once `registerModules` resolves, which opens the waiting links in order and every later link at once.

## Consequences

- A sign-in finishes when the browser comes back within 10 minutes, even after Malini restarted, and when the link itself starts Malini.
- The PKCE verifier now sits on disk for up to 10 minutes, sealed like the token; a token also needs the code, which comes only through the `malini://auth` link.
- A sign-in that ran out while Malini was closed ends silently at the next launch; one that runs out while Malini is open says so.
- A link that arrives before boot finishes waits only in memory, so quitting before then loses it.
- What must stay true: the pending sign-in is saved before the browser opens, and a `state` Malini did not save still changes nothing.
- Enforced by `src/lib/stats/platform/stats-profile.test.ts` ('finishes a Bestboy sign-in that comes back after Malini restarts', and 'says so when the Bestboy sign-in runs out of time', which checks that a problem shows but not its words) and `src/main/url-scheme.test.ts` ('keeps the links that arrive before Malini is ready and opens them in order once it is').
  Nothing tests that an older file loads with `signIn: null` or that the verifier is sealed on disk.
