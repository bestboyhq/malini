# 0312 - Browser profiles open pages side by side

Status: accepted

## Context

Every browser tab used one Electron session, `persist:malini-browser`, so all pages shared one cookie store and a site knew only one account.
The user keeps several Reddit accounts, one per topic, and asked for "a grid of browsers" the agent can open, "each with dedicated context like isolated contexts so I can use them with different accounts".
A chat had only one tab, `chat-<sessionId>` (0225), so the agent could not hold two accounts of one site at once.
Of three prototypes, a grid in the inspector, a full-window wall and a deck of columns, the user picked the deck: feed-width columns that scroll sideways next to the chat.
Inspector panels stay mounted once opened, so one page must never show in a per-tab panel and in a column at the same time.

## Decision

- A browser profile is a name in letters, digits and dashes, at most 32 characters; `browserProfileName` in `src/contract/browser.ts` lowercases what a person or an agent types, turns spaces and underscores into dashes and refuses the rest.
  `DEFAULT_BROWSER_PROFILE` is `default`.
- Each profile is its own persistent Electron partition: `default` keeps `persist:malini-browser`, so the sign-ins from before stay, and any other is `persist:malini-browser-profile-<name>` (`browserPartition` in `src/lib/browser/platform/electron-view.ts`).
  `browserSessions` prepares each partition once with the Chrome user agent, the permission answers and the `malini-worktree` protocol (0010).
- Profiles belong to Malini, not to a workstream: every workstream and chat uses the same partition for a name, and the `browser_profiles` table remembers each name a tab used, for the profile menus (`browser.profiles`).
- Main owns a tab's profile: `BrowserViews.ensure` creates the tab's view in the partition asked for, and a request in another profile replaces the view, keeping the address only when the profile stays.
  `browser.navigate` carries the profile, and `browser:tab-opened` reports it.
- Every agent browser tool takes an optional `profile` (`packages/agent-bridge/src/claude/browser-tools.ts`), sent on `bridge.browser_request`; an optional field, so the protocol stays 63.
  `answerBrowserRequest` gives a chat one tab per profile, `chat-<sessionId>` for `default` and `chat-<sessionId>@<profile>` for any other, and refuses a name `browserProfileName` cannot make.
- The renderer saves each tab with its profile in `malini.browser.tabs:v1:<workstreamId>`, and reads the older list of bare ids as `default`.
  A global deck switch, `malini.browser.deck:v1`, swaps the per-tab panels for one **Browsers** panel, `malini.browser.deck`, so a page mounts in one place only.
  The deck turns on by itself when a workstream's tabs span two profiles, and **Side by side** in the browser toolbar turns it off and on.
- `BrowserDeck.svelte` shows a column per tab, with its profile menu, its title and its close button, then an **Add column** tile; `deckColumnWidth` sizes the columns so the last ones and the tile fill the width exactly, each at least 360px where it fits.
  A column the scroller cuts hides its page and shows its snapshot, as a covered page does.
- The inspector moves the cursor to a panel's tab only when the panel has not taken it, so a new column's address keeps it.

## Consequences

- The agent opens one site as several accounts side by side, and the user signs in to each profile once.
- A sign-in in a profile holds in every workstream; a person who wants a workstream apart names a profile for it.
- Deleting a profile and its cookies is not built: a profile stays until the data folder goes.
- The tab id scheme `chat-<sessionId>@<profile>` must stay stable, since saved tabs and `browser_close` find the agent's tabs by it.
- Enforced by `profiles.test.ts`, `views.test.ts` and `browser-pages.storage.test.ts` in `src/lib/browser`, `browser-deck.test.ts`, `service.test.ts` in `src/lib/chat/platform/agent`, `browser-tools.test.ts` in the agent bridge, and `tests/e2e/browser-profiles.spec.ts`, where two profiles keep their own cookies, the deck shows them as columns, and **Add column**, a profile switch, a close and **Side by side** work.
