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
   It opens on its scratchpad right away while Malini clones it in the background, and your open pull requests join the sidebar once the clone is done.

## First launch

- **Both accounts, side by side.** Setup connects Claude Code and GitHub one at a time: **Install** and **Sign in** for Claude Code, and a one-time code in your browser for GitHub.
  Malini ships the GitHub CLI, so you don't install it or run `gh auth login` yourself, and a `gh` you installed still comes first.
  The sign-in asks for the `workflow` scope too, so agents can change your GitHub Actions workflows.
- **Your jobs, introduced.** The built-in jobs are one slash away from any chat.
- **Hear your afternoon.** Pick the sound for when an agent finishes and the one for when it needs you, then **Try it** plays an afternoon of workstreams so you hear how it feels.
- **Where you heard about Malini.** Pick Hacker News, YouTube, Twitter, a friend or another place, or **Skip**.
  Your answer rides along with the usage data, so we can tell which places bring builders who stick around.
- **Then a repository.** Clone one from GitHub, with your recent repositories one search away, or open a folder on your Mac.

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
