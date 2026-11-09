---
title: Install
description: Download Malini for macOS, connect Claude Code and GitHub in setup, and add your first repository.
---

## Requirements

- macOS 13 or later on Apple silicon.
- git.

Malini ships the GitHub CLI, and setup installs Claude Code if you don't have it.

## Install

1. [Download Malini](https://github.com/bestboyhq/malini/releases/latest/download/malini-arm64.dmg) and drag it to Applications.
2. Open it.
3. Add a repository.
   It opens on its scratchpad right away while Malini clones it in the background, and lists your open pull requests beside it, for you to continue the ones you want here.

## First launch

- **Claude Code and GitHub, side by side.** Setup lists Claude Code and GitHub together, so both install and connect at the same time: **Install** for Claude Code if this Mac lacks it, and a one-time code in your browser for GitHub.
  **Install** downloads the latest Claude Code from Anthropic, checks it against the checksum Anthropic publishes, and sets it up in `~/.local/bin`, the same place `install.sh` puts it.
  A bar shows the download as it arrives, and a failed install says why and offers **Try again**, plus the `install.sh` command to run in Terminal instead.
  Setup never asks you to sign in to Claude: the first prompt you send on a Claude model asks for the sign-in, and a DeepSeek or OpenCode model asks for its API key instead.
  Malini ships the GitHub CLI, so you don't install it or run `gh auth login` yourself, and a `gh` you installed still comes first.
  If it cannot run, the GitHub row offers **Install**, which downloads the same `gh` from GitHub with a bar, checks it, and puts it in place.
  If GitHub does not answer in 15 seconds, the row says so and offers **Check again**.
  Malini needs both tools, so this step has no **Skip**: **Continue** opens once Claude Code is installed and GitHub is signed in.
  A check that fails outright still lets you continue, and Settings, Providers and Settings, Accounts offer the same rows later.
  The sign-in asks for the `workflow` scope too, so agents can change your GitHub Actions workflows.
  The step also says that Malini shares usage stats, never your code or chats, and that you turn it off in Settings.
- **Hear your afternoon.** Pick the sound for when an agent finishes and the one for when it needs you, then **Try it** plays an afternoon of workstreams so you hear how it feels.
- **Pick your defaults.** What Malini does without asking.
  **Recommended** turns on all four: **Resolve merge conflicts**, **Address review comments**, **Keep a second brain**, and **Update from main** when main touches your files.
  **Customize** lets you untick any of them, and set Update from main to **Touches my files**, **Always** or **Never**.
  Each one is the trigger of a [built-in automation](/malini/docs/automations.md#built-in-automations), and the same switches live in Settings, Automations.
  The [second brain](/malini/docs/brain.md) keeps what you typed in archived chats and Home chats, with secrets taken out, in a private GitHub repository, and nowhere else.
- **Where you heard about Malini.** Pick Hacker News, YouTube, Twitter, a friend or another place, or **Skip**.
  The option you picked rides along with the usage data, so we can tell which places bring builders who stick around; what you type for another place stays on your Mac.
- **Then your repositories.** Setup ends on your five GitHub repositories pushed to last, under **What are we working on?**, and nothing to type.
  Pick one and Malini clones it, starts a workstream in it and opens that workstream.
  **More repositories** opens **Find a repository** in the command center (**⌘K**), where you type to search the rest, and a pick there starts a workstream too.
  **Open a folder** (**⌘O**) does the same for a repository already on your Mac.
  **New repository** makes one on GitHub under you or one of your organizations, private unless you untick it, and starts a workstream in it.
  The sidebar comes back with that workstream.

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
