# 0241 - Report a problem files a GitHub issue

Status: accepted

## Context

Logdash shows 7 new installs since Nov 9: 3 added a repository, 1 sent a prompt and none merged.
`bestboyhq/malini` has never had an issue, and nothing in the app told a user how to reach Simon.
Users are already signed in to GitHub through `gh`, which setup asks for, and past its few named calls, `AGENTS.md` reaches everything else on GitHub through it.
Turned down: a **Talk to Simon** call link, since Simon does not want to expose his personal time.
Turned down: Slack instead of Discord, since Slack is built for company teams, each community needs its own sign-up, the free plan hides messages older than 90 days, and the audience comes from YouTube and Reddit and already uses Discord.
Turned down: a form that posts to a Bestboy backend, since Malini has no backend and the reporter could not follow up.
Turned down: the Discord invite in the app, since invites expire and the server is being reconfigured.

## Decision

- **Help and feedback** in the sidebar footer opens a menu of two items.
- **Report a problem**, "Files a GitHub issue. You approve it first", opens the **Report a problem** dialog, where the user writes what broke.
  Below the text sit the facts, each switched on and each one the user can switch off:
  - `Malini <version> · macOS <version> <arch>`.
  - `<n> repositories · <n> prompts · <n> merges`.
  - The last command that failed in the past day, as `<command> failed: <error name> (<kind>)`: names and kinds only, never messages, paths, code or chats.
- The main process reads the facts with `app.problem-report`.
  **File issue** runs `app.report-problem`, which runs the user's own `gh issue create -R bestboyhq/malini` with the text and the facts left on.
  Nothing goes before **File issue**.
- **Join the Discord**, "Other Malini people. Some helpful", opens `https://bestboy.dev/malini/discord` in the browser.
  `apps/site/worker/index.ts` answers that path with a 302 to the Bestboy Discord invite, `https://discord.com/invite/9qNqXSHm7b`.

## Consequences

- The issue is public and opened under the reporter's GitHub account, so they get GitHub's notifications and can follow up, and Simon answers where everyone can read it.
- Malini holds no token and makes no outbound call of its own for it: `AGENTS.md` still counts twelve, and the issue is one more thing on GitHub reached through `gh`.
- The facts must stay names, counts and versions.
  A fact that could carry a message, a path, code or a chat needs a new decision.
- The invite changes with a site deploy and no app release; the redirect is a 302 so browsers do not cache it.
- Enforced by `src/lib/app/domain/problem-report.test.ts` (the issue holds your words, then only the facts you kept, and names a failure without its message), `apps/malini/tests/e2e/report-a-problem.spec.ts` (the menu opens the Discord link, and **File issue** runs `gh issue create` with the text and only the facts left on) and `apps/site/tests/site.test.ts` (the Worker sends `/malini/discord` to the invite with a 302).
