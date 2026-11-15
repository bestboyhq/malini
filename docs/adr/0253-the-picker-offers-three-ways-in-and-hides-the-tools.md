# 0253 - The picker offers three ways in and hides the tools

Status: accepted

## Context

A run with no `gh` and no `claude` (Nov 2026) showed the first screen of 0242 asking about both tools before anything else: a 14 MB GitHub CLI download, a 347 MB Claude Code download line, then a **Sign in** card as the only way forward.
Simon found it gated: "A lot of people will not know what is github cli", so its download should read as "loading the repositories list", and Claude Code "is not necessary for moving forward here", so it should show only "when they try to send a message".
He asked to "let them choose from where they would like to get the repo": GitHub, a local folder or a new repository, since the goal is "a fresh copy as soon as possible".
Picking GitHub must not assume a sign-in, because "they may have already authorized GitHub CLI on their machine", and the copy should be short: "There's a lot of text. I don't know if people will read all that."
A prompt held for Claude Code also left the top bar on **No changes**, so nothing said the chat waited for you.
This amends 0242's picker and its Claude Code line.

## Decision

- **Three rows.** `FirstRepositoryPicker.svelte` shows one card with **GitHub**, **A folder on this Mac ⌘O** and **New repository**, labels only.
  The folder row runs `openRepositoryFolderCommand`, and **New repository** opens the command center's new-repository mode as before.
- **GitHub in place.** A click on **GitHub** turns the card into a GitHub view with **Back**.
  Signed in, it lists the five repositories pushed to last and **More repositories ⌘K**, with the account under **GitHub**.
  With `gh` missing it reads "Loading your repositories", with the download bar while it downloads, and never names the GitHub CLI; a failed install reads "Could not load your repositories" with the reason folded under it and **Try again**.
  Signed out, it starts the device sign-in on its own once per visit, shows the code with "Paste this code on GitHub", then the list; a cancelled sign-in leaves **Sign in**.
  `watchGithubAuthHook` checks again whenever the window takes focus, and the list loads whenever `githubSetupStatus` turns `ready`.
- **Claude Code out of sight.** The picker no longer shows Claude Code's download or its failure.
  `installMissingToolsHook` still starts the install at launch, and `ProviderConnectStrip` shows it only once a prompt waits for it.
- **The wait says Needs you.** `workstreamAgentStatusQuery` reads `waiting_for_approval` while `heldPromptQuery` holds a prompt for the workstream, so the top bar says **Needs you** over a prompt held for Claude Code's install or sign-in.
- `GitHubSetup` loses its `pitch` form, and `GitHubDeviceCode` reads "It’s on your clipboard", in Settings and the command center too.
- A prompt sent while the first copy runs already waited for it in the queue, and keeps doing so.

## Consequences

- A signed-in `gh` reaches the list in two clicks, one more than 0242, and a signed-out one in two clicks plus the GitHub page, one fewer.
- Nothing on the first screen asks about a tool, so a failed Claude Code download first shows when you send.
- GitHub's device page still names the app "GitHub CLI", and the hint no longer explains it.
- `apps/malini/tests/e2e/github-sign-in.spec.ts` fails when **GitHub** needs a second click to sign in, when its view names the GitHub CLI, or when **Back** loses the rows.
- `apps/malini/tests/e2e/first-run.spec.ts` fails when the picker shows Claude Code's install, when a held prompt leaves the top bar without **Needs you**, or when a prompt sent during the first copy does not run after it.
