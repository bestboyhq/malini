<p align="center">
  <img src="apps/malini/build/icon.png" width="128" height="128" alt="Malini app icon">
</p>

<h1 align="center">Malini</h1>

<p align="center">
  <b>An agentic development environment for builders moving fast.</b><br>
  Run as many agents as you want. Malini handles the chores, so you only review pull requests and the gains compound.<br>
  Free and open source macOS app.
</p>

<p align="center">
  <a href="https://github.com/bestboyhq/malini/releases/latest/download/malini-arm64.dmg"><img src="https://img.shields.io/badge/Download_for_macOS-000?style=for-the-badge&logo=apple&logoColor=white" alt="Download for macOS" height="40"></a>
</p>

<p align="center">
  <a href="https://github.com/bestboyhq/malini/releases/latest"><img src="https://img.shields.io/github/v/release/bestboyhq/malini?label=release&color=5e5ce6" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/macOS-13%2B-1c1c1e?logo=apple" alt="macOS 13 or later, Apple silicon">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-1c1c1e" alt="AGPL-3.0 license"></a>
</p>

<p align="center">
  <img src=".github/readme/hero.webp" width="100%" alt="The Malini window: six workstreams across malini, grip and tony in the sidebar, a finished malini chat that read the code, edited package.json and docs/packaging.md, and ended each turn with a Done report, 2 files changed with Draft and Merge in the top bar, and a Builder skills chip in the composer.">
</p>

---

## Why it exists

The best AI coding tools are closed source.
They belong to companies with investors to answer to, and when the two of you disagree, the investors win.
Prices change.
Limits change.
Features go away.
You can't look inside, and you can't take your setup with you.

Malini is the other way.

**Open source, so we can't rug pull you.**
The code is public under AGPL.
There is no account, no subscription and no Malini server.
We can't take it back, and if we ever go wrong, you can fork it.

**Transparent, all the way down.**
Your code goes to Anthropic through your own Claude Code, and to GitHub through the GitHub CLI.
That's it.
Malini makes two calls of its own: update checks, and anonymous usage data you can turn off.
Every big decision is written down in [`docs/adr`](docs/adr).

**On your side of the token.**
An AI lab earns more when you use more tokens.
It has no reason to help you use fewer.
Its interest and yours point in opposite directions.
Malini earns nothing from tokens.
It shows your context window and your plan usage, and you pick the model and the effort for every prompt.
Claude Code also loads every skill you own into every chat.
With 47 skills that is about 7,400 tokens before you type a word.
Malini ranks them by how often your agents use them, so you can turn off the ones no chat needs.

**Outcomes, not skills.**
You never wanted skills.
A skill is a pile of markdown files, and that's an implementation detail.
What you wanted was the outcome: checks green, branch up to date, review answered.
So Malini has jobs.
A job is an outcome you ask for by name, and you can have as many as you like.
Name the skills a job needs, and it loads only those.
That leaves your time for the work that matters, instead of fighting your setup.

<p align="center">
  <img src=".github/readme/jobs.webp" width="100%" alt="The Changelog on merge job open on the Jobs page: When a pull request merges, it runs on its own in the workstream it fires in, and then runs Open draft. Below are its recent run and its instructions.">
</p>

<p align="center">
  <img src=".github/readme/job-running.webp" width="50%" alt="The top of a chat's composer: 71 files changed in this chat, and the Update from main job running.">
</p>

<p align="center">
  <sub>A job running inside a chat.</sub>
</p>

## How it works

1. **Start a task.**
   Each task is a workstream: its own git worktree, its own branch, its own chats.
   Start one or start a hundred.
2. **Keep it moving.**
   Queue prompts, run jobs, plan first if you like.
   Agents write code, and Malini owns git.
3. **Press Draft, then Merge.**
   Malini commits, opens the pull request, fixes red checks, addresses reviews, and merges once GitHub allows.

Everything Malini can do is in [`docs/features.md`](docs/features.md).

## Install

1. [Download Malini](https://github.com/bestboyhq/malini/releases/latest/download/malini-arm64.dmg) and drag it to Applications.
2. Open it.
   Setup connects Claude Code and GitHub: **Install** and **Sign in** for Claude Code, and a one-time code in your browser for GitHub.
3. Add a repository.
   Your first workstream is ready.

You need macOS 13 or later on Apple silicon, and git.
Malini ships the GitHub CLI, and setup installs Claude Code if you don't have it.

## Build from source

You need macOS on Apple silicon and Node 24.

```sh
git clone https://github.com/bestboyhq/malini && cd malini
corepack enable pnpm   # once; the repository pins pnpm 12
pnpm install
pnpm dev               # the app, with hot reload
```

Read [AGENTS.md](AGENTS.md) for the layout and the conventions.
Issues and pull requests are welcome; your first pull request asks you to sign the [CLA](CLA.md).
Pull request titles follow [Conventional Commits](https://www.conventionalcommits.org), and every merged `feat`, `fix`, or `perf` ships to users as an in-app update.

Malini is a sibling of [Grip](https://bestboy.dev/grip), the free and open source screen recorder, and [Tony](https://bestboy.dev/tony), free and open source dictation for the Mac.

## License

Copyright (C) 2026 Szymon Grącki and Malini contributors

Licensed under [AGPL-3.0-only](LICENSE).
`packages/extension-api` is licensed under [MIT](packages/extension-api/LICENSE), so an extension can use any license.

Additional permission under GNU AGPL version 3 section 7: if you modify this program, or any covered work, by linking or combining it with the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`, or a modified version of that library), containing parts covered by the terms of Anthropic's license for that SDK, the licensors of this program grant you additional permission to convey the resulting work.

Additional term under GNU AGPL version 3 section 7(e): the license grants no rights to the Malini and Best Boy names and logos, which [TRADEMARKS.md](TRADEMARKS.md) covers.

Third-party components and their notices are listed in [NOTICE](NOTICE).

Contributions require signing the [Contributor License Agreement](CLA.md); the CLA bot asks on your first pull request.

Claude, Claude Code and the Claude logo are trademarks of Anthropic, PBC.
Third-party names and logos are not covered by this license and appear only to identify those products.
