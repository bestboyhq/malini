# 0169 - Commits are yours, and a pull request says who cooked it

Status: accepted

## Context

Since the first commit, `commitConfig` in `apps/malini/src/main/git/remote.ts` wrote every workstream commit as `malini-agent[bot]`, so every squash merge on GitHub ended with `Co-authored-by: malini-agent[bot]` and the history read as a bot's work.
The user: "i dont think we should attribute our commits. We should maybe add at the end of each PR smh cool and not cringe, like "Cooked with malini"".
They wanted the line to point at the person: "link it to someone's profile in malini (like bestboy.dev/@<gh_nickname>)", since "its critical that ppl feel recognized and those profiles have tangible sense of awesomeness for them".
A Bestboy handle starts as the GitHub login but can change, the platform keeps no GitHub login, and a handle that was never published or went private answers 404, so `bestboy.dev/@<login>` can open a stranger's profile or nothing.
Of seven footers over two rounds they picked a collapsed one, "maybe this with cooking emoji?".
On the built footer, which showed a streak and the workstream's agents, turns and hours: "dont log days straight or turns/hours, should be "agents did em"".
Shown the agent count alone in a Kitchen row, they said "very nice".
Apple draws 🍳 as a black pan, so on GitHub's dark theme it read as a 🔍; of 🧑‍🍳, 🥘 and 🔥 at full size they picked 🧑‍🍳.
0084's last consequence about the CLA check said `malini-agent[bot]` writes every commit in pull requests `szymeo` opens; that is no longer true.

## Decision

- Malini commits, rebases and merges main in a workstream as the git identity the checkout already has.
  When git has no `user.email`, `identityWhenGitHasNone` takes it from `gh api user`: the GitHub name, or the login, and `<id>+<login>@users.noreply.github.com`.
  Without either, git decides, as it would for you.
- `malini-agent[bot]` stays only on archive snapshot commits (`AGENT_IDENTITY` in `snapshots.ts`), which live on private refs and are never pushed.
- Every pull request body Malini writes, opened or retitled, ends with a footer from `cookedFooter` in `apps/malini/src/lib/shared/repositories/domain/pull-request-metadata.ts`: a `<details>` whose summary reads `🧑‍🍳 Cooked with Malini`, the emoji at full size and the words in `<sub>` linking `https://bestboy.dev/malini`, over a table.
  - **Chef** is `@<handle>` linking the Bestboy profile while **Publish my stats** is on, the profile is public and it has a handle and URL, and `@<login>` linking `https://github.com/<login>` otherwise (`stats.chef()` in `apps/malini/src/lib/stats/platform/register.ts`).
    A handle that is not a GitHub-shaped name drops the row, and a URL that is not http or https drops the link.
  - **Kitchen** is how many agents worked in the workstream, its chats plus their `Agent` tool calls, from `workstreamAgentCount` in `apps/malini/src/lib/chat/platform/ship-context.repository.ts`, and shows once there is one.
  - **Dishes** reads `Agents did em`, always.
- The agent count is the footer's only number: no streak, turns or time.
- The footer counts against the 4,000-character body limit first, so a long body is cut and the footer never is.
- Like the rest of the body, the footer comes only from Malini's own derivations, never from what you typed, as 0150 requires.

## Consequences

- Squash merges carry no bot trailer, and GitHub counts the commits as yours.
- A contributor who ships with Malini now writes their own commits, so the CLA check sees them as the author instead of failing a pull request whose opener wrote none of its commits; pull requests `szymeo` opens are still skipped.
- Every Malini pull request names its author and how many agents worked on it, in a line that stays shut until someone opens it.
- The agent count reaches GitHub without **Publish my stats**; it says how many, never when or for how long.
- A user who never published sees the Chef row link their GitHub profile; the placeholder profile and a nudge when someone visits it need the platform and are not built.
- There is no switch to turn the footer off.
- `pull-request-metadata.test.ts` fails when the footer's rows, links, guards or place in a cut body change; `remote.test.ts` fails when a commit's author is not the checkout's identity; `open-draft.spec.ts` fails when a pushed commit's author differs from `git config user.name` or the opened draft's body does not end with the footer.
