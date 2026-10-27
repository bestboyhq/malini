---
title: Public profile
description: Copy share cards of your Malini stats, and publish them to a public profile at bestboy.dev if you want one. Every number Malini sends, in plain words, and what never leaves your Mac.
---

Malini counts how you work with agents on your Mac, in the Stats panel.
You can share those stats two ways: copy a share card, or publish them to a public profile at `bestboy.dev/@handle`.
A share card needs no account, and publishing is off until you turn it on.

## Share cards

Open the Stats panel from the readout at the bottom of the sidebar.
**Share card** shows two cards drawn from your numbers: **Heatmap** and **Readout**.
Click one to copy it as a picture, then paste it anywhere.

The cards count complete days only, through yesterday, so a card you copy matches your profile.
They show your name and picture from GitHub, and your Bestboy handle once you publish, or your GitHub login before that.

## Publish my stats

Turn on **Publish my stats** in Settings, Profile.

1. Malini opens your browser to sign in to Bestboy, with Google or an email code.
2. Back in Malini, you choose your profile address, `bestboy.dev/@handle`, filled in with your GitHub login.
3. Malini sends your numbers, and **Copy link** copies your profile's address.

While it stays on, Malini sends your numbers once a day, and again when you change your public repositories.
bestboy.dev publishes changes once a day at 03:00 UTC, for everyone at the same moment, so your profile never shows when you work.
The first upload after you turn it on goes public at once.

Turn the switch off, and Malini removes your numbers from bestboy.dev at once and hides your profile.
**Sign out** does the same first, then signs Malini out of Bestboy.
When bestboy.dev cannot be reached, Malini keeps trying until it can.

### Public repositories

Your profile names no repository unless you pick it.
Under **Public repositories**, Settings lists the repositories you ran agents in that GitHub reports public, and you can pick up to 10.
Malini names a picked repository only while GitHub still reports it public.
Every other repository counts only toward two totals, public and private, and a repository that is not on GitHub counts as private.

## Every number Malini sends

Malini sends numbers only.
Every number counts complete days in your time zone, through yesterday; today is never counted.

- **Version**: always 1.
- **Through**: the last day counted, yesterday.
- **Since**: the first day you ran an agent.
- **Runs**: every agent run up to that day, and how many of them a job started.
- **Runs that changed code**: runs that changed at least one file.
- **Active days**: days with at least one run.
- **Tool calls**: every tool call agents made, sub-agents included, and how many of them were screenshots in Malini's browser.
- **Workstreams**: workstreams you opened, and how many of them you merged through a pull request.
- **Lines and files**: lines agents added and removed, and how many different files they changed in each repository.
- **Days**: for each day with a run in the last 53 weeks, the date, how many runs started that day, and how many agents ran at once on average while any ran.
- **Agents at once**: the average weighted by time, the typical number, the number reached in the busiest tenth of the time, and the peak.
- **Run length**: the typical run, the run longer than nine in ten, and the longest run.
- **Steps per run**: tool calls in a run, typical, one in ten, and most; a run without a tool call counts as zero.
- **Runs on an active day**: typical, one in ten, and most.
- **Lines per change**: lines added plus removed in a typical run that changed code.
- **Runs per workstream**: runs in a typical workstream.
- **Models**: runs per model family.
- **Languages**: lines added plus removed in each language, told apart by file extension.
- **Tools**: calls of each tool.
- **MCP servers**: calls to Malini's own tools, and calls to every other server as one total.
- **Skills**: every skill use, as one total.
- **Public repositories you picked**: runs in each.
- **Other repositories**: how many and how many runs, as public and private.

### Names it sends

Every name comes from a fixed list, and anything else goes into **other**:

- **Models**: opus, sonnet, haiku, fable.
- **Languages**: TypeScript, JavaScript, Svelte, Vue, Astro, HTML, CSS, SCSS, Markdown, MDX, JSON, YAML, TOML, SQL, GraphQL, Python, Ruby, Go, Rust, Swift, Objective-C, Kotlin, Java, Scala, C, C++, C#, PHP, Shell, Dart, Elixir, Erlang, Haskell, Lua, Zig, Nix, Dockerfile, Terraform, GDScript.
- **Tools**: Claude Code's built-in tools by name, such as Bash, Read and Edit; **Browser** for Malini's browser; **MCP** for every other MCP tool.
- **MCP servers**: **malini** and **other**.
- **Repositories**: only the public ones you picked.

The names of your own skills, MCP servers and tools never leave your Mac.

## What never leaves your Mac

- Your prompts, code, file names, and paths.
- The name of any repository you did not pick.
- When you work: no time of day, no session times, no sign of whether you are online, and bestboy.dev never shows when an upload arrived.
- Your email address and your team.

Anyone could change the numbers their own Malini sends, so a profile says its stats are self-reported by Malini.
