<p align="center">
  <img src="apps/malini/build/icon.png" width="128" height="128" alt="malini app icon">
</p>

<h1 align="center">malini</h1>

<p align="center">
  <b>You had one job. Now you can have hundreds.</b><br>
  Many Claude Code agents, one window, one merged pull request each.<br>
  Free and open source, for the Mac.
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
  <img src=".github/readme/hero.webp" width="100%" alt="The malini window: six workstreams across malini, grip and tony in the sidebar, a finished malini chat that read the code, edited package.json and docs/packaging.md, ran the new script, and ended with a commit subject and a pull request title, and 2 files changed with Draft and Merge in the top bar.">
</p>

---

If Cursor, Codex, Conductor, and Claude Code had a baby, it would look a lot like malini.
We use and admire all four.

## Why it exists

The best AI coding tools are closed source.
They belong to companies with investors to answer to, and when the two of you disagree, the investors win.
Prices change.
Limits change.
Features go away.
You can't look inside, and you can't take your setup with you.

malini is the other way.

**Open source, so we can't rug pull you.**
The code is public under AGPL.
There is no account, no subscription and no malini server.
We can't take it back, and if we ever go wrong, you can fork it.

**Transparent, all the way down.**
Your code goes to Anthropic through your own Claude Code, and to GitHub through your own `gh`.
That's it.
malini makes two calls of its own: update checks, and anonymous usage data you can turn off.
Every big decision is written down in [`docs/adr`](docs/adr).

**On your side of the token.**
An AI lab earns more when you use more tokens.
It has no reason to help you use fewer.
Its interest and yours point in opposite directions.
malini earns nothing from tokens.
It shows your context window and your plan usage, and you pick the model and the effort for every prompt.

**Outcomes, not skills.**
You never wanted skills.
A skill is a pile of markdown files, and that's an implementation detail.
What you wanted was the outcome: checks green, branch up to date, review answered.
So malini has jobs.
A job is an outcome you ask for by name, and you can have as many as you like.
That leaves your time for the work that matters, instead of fighting your setup.

<p align="center">
  <img src=".github/readme/jobs.webp" width="100%" alt="The Jobs page: an empty Your jobs section and the three built-in jobs, Fix checks, Update from main, and Address bot review, each with its model, effort, and an Edit and a Reset button.">
</p>

## How it works

1. **Start a task.**
   Each task is a workstream: its own git worktree, its own branch, its own chats.
   Start one or start a hundred.
2. **Keep it moving.**
   Queue prompts, run jobs, plan first if you like.
   Agents write code, and malini owns git.
3. **Press Draft, then Merge.**
   malini commits, opens the pull request, fixes red checks, answers bot reviews, and merges once GitHub allows.

Everything malini can do is in [`docs/features.md`](docs/features.md).

## Install

1. [Download malini](https://github.com/bestboyhq/malini/releases/latest/download/malini-arm64.dmg) and drag it to Applications.
2. Open it.
   Setup checks Claude Code, and **Sign in** uses your Claude account.
3. Add a repository.
   Your first workstream is ready.

You need macOS 13 or later on Apple silicon, git, and Claude Code.
Cloning from GitHub and pull requests need the [GitHub CLI](https://cli.github.com), signed in with `gh auth login`.

## Build from source

You need macOS on Apple silicon and Node 24.

```sh
git clone https://github.com/bestboyhq/malini && cd malini
corepack enable pnpm   # once; the repository pins pnpm 12
pnpm install
pnpm dev               # the app, with hot reload
```

Read [AGENTS.md](AGENTS.md) for the layout and the conventions.
Issues and pull requests are welcome.
Pull request titles follow [Conventional Commits](https://www.conventionalcommits.org), and every merged `feat`, `fix`, or `perf` ships to users as an in-app update.

malini is a sibling of [Grip](https://github.com/bestboyhq/grip), the free and open source screen recorder, and [Tony](https://github.com/bestboyhq/tony), free and open source dictation for the Mac.

## License

Copyright (C) 2026 Best Boy

malini is licensed under [AGPL-3.0-only](LICENSE).
`packages/extension-api` is licensed under [MIT](packages/extension-api/LICENSE), so an extension can use any license.

Additional permission under GNU AGPL version 3 section 7: if you modify this program, or any covered work, by linking or combining it with the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`, or a modified version of that library), containing parts covered by the terms of Anthropic's license for that SDK, the licensors of this program grant you additional permission to convey the resulting work.

Claude, Claude Code and the Claude logo are trademarks of Anthropic, PBC.
Third-party names and logos are not covered by this license and appear only to identify those products.
