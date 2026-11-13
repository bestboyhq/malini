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
3. Pick a repository under **What are we working on?**.
   Malini clones it, starts a workstream in it and opens that workstream.

## First launch

Malini opens on **What are we working on?**, with nothing to set up first.

- **Your GitHub repositories.** The card lists your five GitHub repositories pushed to last.
  Pick one and Malini clones its own copy, starts a workstream in it and opens that workstream.
  Your own checkouts stay as they are.
  **More repositories** opens **Find a repository** in the command center (**⌘K**), where you type to search the rest, and a pick there starts a workstream too.
  **New repository** makes one on GitHub under you or one of your organizations, private unless you untick it, and starts a workstream in it.
  The sidebar comes back with that workstream.
- **Signed out of GitHub.** The card reads **Sign in to GitHub to list your repositories**, and **Sign in** shows a one-time code and opens GitHub in your browser.
  A `gh` you already signed in to on this Mac counts, so you may never see this card.
  The sign-in asks for the `workflow` scope too, so agents can change your GitHub Actions workflows.
  If GitHub does not answer in 15 seconds, the card says so and offers **Check again**.
- **Not on GitHub?** **Open a folder** (**⌘O**), under the card, starts a workstream in a repository already on your Mac.
- **Claude Code installs itself.** If this Mac lacks Claude Code, Malini downloads the latest release from Anthropic as it opens, checks it against the checksum Anthropic publishes, and sets it up in `~/.local/bin`, the same place `install.sh` puts it.
  A line under the picker shows the download as it arrives.
  It installs only when Claude Code is missing, never when the check itself fails, so it does not put a second copy beside one from Homebrew or npm.
  A prompt you send before it lands waits above the composer under **Installing Claude Code. Your prompt sends once it is in**, and sends on its own once it is.
  A failed install says why and offers **Try again**, and Settings, Providers has the `install.sh` command to run in Terminal instead.
  Malini never asks you to sign in to Claude up front: the first prompt you send on a Claude model asks for the sign-in, and a DeepSeek or OpenCode model asks for its API key instead.
- **The GitHub CLI ships inside Malini.** You don't install it or run `gh auth login` yourself, and a `gh` you installed still comes first.
  If the bundled one cannot run, Malini downloads the same `gh` from GitHub on its own, checks it, and puts it in place.
- **Usage stats.** The picker says that Malini shares usage stats, never your code or chats, and that you turn it off in Settings.
- **Something small to start.** Your first workstream opens on **Start with something small**: **Explain how this repository works**, **Fix the first failing test or lint**, and, for a GitHub repository, **Take one open issue**.
  Each one fills the composer with its prompt, for you to edit or send.
  The agent works on the workstream's own branch, so nothing reaches main until you merge.
- **Sounds.** The first time an agent finishes, a note says what that sound means, and **Change sounds** opens Settings, Sounds.
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
