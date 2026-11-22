---
title: Install
description: Download Malini for macOS, pick a GitHub repository, and start. Claude Code installs itself.
---

## Requirements

- macOS 13 or later on Apple silicon.
- git.

Malini ships the GitHub CLI, and installs Claude Code on its own if you don't have it.

## Install

1. [Download Malini](https://github.com/bestboyhq/malini/releases/latest/download/malini-arm64.dmg) and drag it to Applications.
2. Open it.
3. Pick where your code is under **What are we working on?**: **GitHub**, **A folder on this Mac** or **New repository**.
   Malini starts a workstream in it and opens that workstream.

## First launch

Malini opens on **What are we working on?**, with three rows and nothing to set up first.

- **GitHub.** The card turns into your five GitHub repositories pushed to last, and **Back** returns to the rows.
  Pick one and Malini clones its own copy, starts a workstream in it and opens that workstream.
  Your own checkouts stay as they are.
  **More repositories** opens **Find a repository** in the command center (**⌘K**), where you type to search the rest, and a pick there starts a workstream too.
  The sidebar comes back with that workstream.
- **Signed out of GitHub.** A `gh` you already signed in to on this Mac counts, so the list shows at once.
  Otherwise **GitHub** shows a one-time code, puts it on your clipboard and opens GitHub in your browser, then lists your repositories once you paste it there.
  The sign-in asks for the `workflow` scope too, so agents can change your GitHub Actions workflows.
  If GitHub does not answer in 15 seconds, the card says so and offers **Try again**.
- **A folder on this Mac** (**⌘O**) starts a workstream in a repository already on your Mac.
  A folder with no git history gets one first: Malini runs `git init` in it and commits its files as **Initial commit**, leaving out `node_modules`, `.venv`, env files and `.DS_Store`, which stay in the folder.
  Malini starts no git in your home folder, a folder above it, or a folder inside another repository, and names that repository so you can open it instead.
- **New repository** makes one on GitHub under you or one of your organizations, private unless you untick it, and starts a workstream in it.
- **Send while it copies.** A prompt you send while the first copy runs waits above the composer and runs once the copy is done.
- **Claude Code installs itself.** If this Mac lacks Claude Code, Malini downloads the latest release from Anthropic as it opens, checks it against the checksum Anthropic publishes, and sets it up in `~/.local/bin`, the same place `install.sh` puts it.
  Nothing on the first screen shows it.
  It installs only when Claude Code is missing, never when the check itself fails, so it does not put a second copy beside one from Homebrew or npm.
  A prompt you send before it lands waits above the composer under **Installing Claude Code. Your prompt sends once it is in**, sends on its own once it is, and the top bar says **Needs you** meanwhile.
  A failed install says why and offers **Try again**, and Settings, Providers has the `install.sh` command to run in Terminal instead.
  Malini never asks you to sign in to Claude up front: the first prompt you send on a Claude model asks for the sign-in, and a DeepSeek or OpenCode model asks for its API key instead.
- **The GitHub CLI ships inside Malini.** You don't install it or run `gh auth login` yourself, and a `gh` you installed still comes first.
  If the bundled one cannot run, Malini downloads the same `gh` from GitHub on its own, checks it, and puts it in place, while **GitHub** reads **Loading your repositories**.
- **Usage stats.** The picker says that Malini shares usage stats, never your code or chats, and that you turn it off in Settings.
- **Somewhere to start.** A new workstream opens on the steps Malini took to set it up, then [prompts to start from](/malini/docs/workstreams.md#before-the-first-message) under **Quick suggestions**, such as **Run it in the browser** and **Plan a change with me**.
  Each one fills the composer with its prompt, for you to edit or send.
  The agent works on the workstream's own branch, so nothing reaches main until you merge.
- **Sounds.** The first time an agent finishes, a note says what that sound means, **Play again** plays it again, and **Change** opens Settings, Sounds.
- **Defaults.** A new install starts with **Resolve merge conflicts**, **Address review comments** and **Update from main** on **Touches my files**, and the [second brain](/malini/docs/brain.md) off.
  Settings, Automations has the [same switches](/malini/docs/automations.md#defaults).
- **Where you heard about Malini.** Once you archive your first merged workstream, the Repositories page asks, once: Hacker News, YouTube, Twitter, GitHub, Reddit, ChatGPT, Claude, Google, a friend or somewhere else.
  Until you pick one or close it, that question is all the page shows.
  The option you pick rides along with the usage data, so we can tell which places bring builders who stick around; what you type for somewhere else stays on your Mac.
  The × closes it for good.

## Updates

Malini updates itself.
Updates download in the background and install when you quit, or right away with **Restart to update** at the bottom of the sidebar.
See [Updates and compatibility](/malini/docs/updates.md).

## Build from source

You need macOS on Apple silicon and Node 24.

```sh
git clone https://github.com/bestboyhq/malini && cd malini
corepack enable pnpm
pnpm install
pnpm dev
```

`pnpm dev` starts the app with hot reload.
`pnpm dist` builds an unsigned `.app` under `apps/malini/release/`.
