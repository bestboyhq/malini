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
   It opens on its scratchpad, with your open pull requests already in the sidebar.

## First launch

- **Both accounts, side by side.** Setup connects Claude Code and GitHub one at a time: **Install** and **Sign in** for Claude Code, and a one-time code in your browser for GitHub.
  Malini ships the GitHub CLI, so you don't install it or run `gh auth login` yourself, and a `gh` you installed still comes first.
- **Your jobs, introduced.** The built-in jobs are one slash away from any chat.
- **Then a repository.** Clone one from GitHub, with your recent repositories one search away, or open a folder on your Mac.

## Updates

Malini updates itself.
Updates download in the background and install when you quit, or right away with **Restart to Update** in the app menu.
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
