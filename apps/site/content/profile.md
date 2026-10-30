---
title: Public profile
description: Publish your Malini stats to a public profile at bestboy.dev and share cards of it. Every number Malini sends, in plain words, and what never leaves your Mac.
---

Malini counts how you work with agents on your Mac, in the Stats panel.
You can publish those stats to a public profile at `bestboy.dev/@handle`, and then share cards of them.
Your profile lives in your Bestboy account, and publishing is off until you turn it on.

## Your Bestboy account

Settings, Profile shows your Bestboy account.
Signed out, it says **Not signed in to Bestboy**, and **Sign in** opens your browser to sign in with Google or an email code.
Signing in publishes nothing; it only tells Malini who you are on bestboy.dev.
Signed in, it shows your name and email, and **Sign out**.

## Publish my stats

Turn on **Publish my stats** in Settings, Profile, or click **Publish my stats** under **Share card** in the Stats panel.

1. If you are not signed in yet, Malini opens your browser to sign in to Bestboy, and the browser hands you back to Malini through a `malini://` link.
2. Back in Malini, you choose your profile address, `bestboy.dev/@handle`, filled in with your GitHub login.
3. Malini sends your numbers, and **Copy link** copies your profile's address.

While it stays on, Malini sends your numbers once a day, and again when you change your public repositories or what your profile shows.
bestboy.dev publishes changes once a day at 03:00 UTC, for everyone at the same moment, so your profile never shows when you work.
The first upload after you turn it on goes public at once.

Turn the switch off, and Malini removes your numbers from bestboy.dev at once and hides your profile.
**Sign out** does the same first, then signs Malini out of Bestboy.
When bestboy.dev cannot be reached, Malini keeps trying until it can.

The `malini://` link opens the Malini you installed.
A link meant for another sign-in, or one that reaches a Malini that never asked for it, changes nothing.

### What your profile shows

Under **What your profile shows**, six parts each have their own switch, all on by default:

- **How runs work**: how many runs used Malini's browser, sub-agents, skills, MCP servers other than Malini's own, and web search or fetch.
- **Tools**: calls of each tool.
- **Models**: runs per model family.
- **Languages**: lines changed per language.
- **MCP servers**: calls per server.
- **Skills**: uses per skill.

Turn a part off, and Malini sends your numbers again without it.
Your profile hides that part, and you drop out of its community figures.
Runs, active days, agents at once, run lengths and the other totals always go with your numbers while you publish.

### Public repositories

Your profile names no repository unless you pick it.
Under **Public repositories**, Settings lists the repositories you ran agents in that GitHub reports public, and you can pick up to 10.
Malini names a picked repository only while GitHub still reports it public.
Every other repository counts only toward two totals, public and private, and a repository that is not on GitHub counts as private.

## Share cards

Share cards come with your profile.
Once you publish, open the Stats panel from the readout at the bottom of the sidebar.
**Share card** shows two cards drawn from your numbers: **Heatmap** and **Readout**.
Click one to copy it as a picture, then paste it anywhere.

The cards count complete days only, through yesterday, so a card you copy matches your profile.
They show your name and picture from GitHub, and your Bestboy handle.
Until you publish, **Share card** offers **Publish my stats** instead.

## Milestone cards

When yesterday brought a milestone, your share card peeks out of the sidebar, above the stats readout, with the milestone named beside it.
A milestone is a 7, 30, 100 or 365-day streak, a streak longer than any before it, a day with more runs than any before it, or another thousand runs.
The card waits until no agent is working, and hides while streamer mode masks your personal data.

Click the card to see both cards.
Once you publish, **Copy card** and **Copy link** share them; before that, the card offers to claim your `bestboy.dev/@handle`, the same steps as **Publish my stats**.
The × dismisses a milestone for good, and **Milestone cards** in Settings, Profile turns them off.
Milestones are worked out on your Mac and nothing about them leaves it until you publish.

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
- **How runs work**: how many runs used Malini's browser, handed work to a sub-agent, loaded a skill, called an MCP server other than Malini's own, and searched or fetched the web.
- **Models**: runs per model family.
- **Languages**: lines added plus removed in each language, told apart by file extension.
- **Tools**: calls of each tool.
- **MCP servers**: calls to each server the public catalog names, to Malini's own, and to every other server as one total.
- **Skills**: uses of each skill the public catalog names, and every other skill use as one total.
- **Public repositories you picked**: runs in each.
- **Other repositories**: how many and how many runs, as public and private.

### Names it sends

Every name comes from a fixed list, and anything else goes into **other**:

- **Models**: opus, sonnet, haiku, fable.
- **Languages**: TypeScript, JavaScript, Svelte, Vue, Astro, HTML, CSS, SCSS, Markdown, MDX, JSON, YAML, TOML, SQL, GraphQL, Python, Ruby, Go, Rust, Swift, Objective-C, Kotlin, Java, Scala, C, C++, C#, PHP, Shell, Dart, Elixir, Erlang, Haskell, Lua, Zig, Nix, Dockerfile, Terraform, GDScript.
- **Tools**: Claude Code's built-in tools by name, such as Bash, Read and Edit; **Browser** for Malini's browser; **MCP** for every other MCP tool.
- **MCP servers** and **skills**: only names the public catalog at `bestboy.dev/api/catalog` lists, **malini** for Malini's own server, and **other** for the rest.
- **Repositories**: only the public ones you picked.

Every list holds at most 40 names, and the rest go into **other**.

#### Skill and MCP server names

A skill or server you wrote yourself can carry the name of a private project, so Malini names one only when a public catalog lists it.
The catalog holds the skills built into Claude Code, the skills and servers of plugins in Anthropic's official plugin marketplace, and the servers in the official MCP Registry.
While **Publish my stats** is on, Malini downloads all of it, about 0.9 MB compressed, at most once a day, before it sends your numbers; it needs no account.
When the download fails, Malini uses the last catalog it downloaded, or none, and sends your numbers anyway.

Malini checks where each skill and server on your Mac came from, never the name alone:

- A built-in skill, such as `code-review`, counts by name only when no skill of yours, personal or in a repository, has the same name.
- A plugin counts only when Claude Code records that you installed it from Anthropic's official marketplace, `anthropics/claude-plugins-official` on GitHub.
  Its skills count as `plugin:skill`, such as `cloudflare:wrangler`; a plugin from any other marketplace counts as **other**, because a community plugin's name can be personal.
- Each MCP server gets one name, the first that fits:
  1. **malini** for Malini's own server.
  2. Its registry name, such as `io.github.upstash/context7`, when your Claude Code configuration or the plugin that brings it runs one of its packages or connects to one of its addresses.
  3. `plugin:server`, such as `cloudflare:cloudflare-api`, for a server of an official plugin that the catalog lists.
  4. **other** for the rest.

  So a server counts once, however you installed it.
  Malini reads a server's configuration only to find its package or address, and never keeps or sends anything else from it.

A skill or server that merely shares a catalog name counts as **other**.
The names of your own skills, MCP servers and tools never leave your Mac.

## What never leaves your Mac

- Your prompts, code, file names, and paths.
- The name of any repository you did not pick.
- When you work: no time of day, no session times, no sign of whether you are online, and bestboy.dev never shows when an upload arrived.
- Your email address and your team.

Anyone could change the numbers their own Malini sends, so a profile says its stats are self-reported by Malini.
