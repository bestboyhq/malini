---
title: Extensions
description: Malini's own marketplace on bestboy.dev. Extensions add MCP servers and skills to every agent in Malini, and anyone with a Bestboy handle publishes them from a repository.
---

## Find and install extensions

Open Settings, **Extensions**, right below MCP servers.
It is one list: what you installed on top, each with a switch, and every other extension in the marketplace on bestboy.dev below, each with **Install**.
**Install** puts an extension in every chat from that chat's next prompt.
Click an extension to open it in place: its README, the MCP servers and skills it adds, the hosts it connects to, who published it, and its repository.

An extension adds remote MCP servers and skills, so nothing it adds runs on your Mac.
An extension's servers show under Settings, MCP servers beside your own, and one that needs a sign-in gets **Sign in** there.
Malini keeps extensions in its own folder and hands them to every agent session itself, never through `claude plugin install` or `~/.claude`, so the Claude Code plugins you installed yourself keep working as they are.

## Turn off, uninstall and update

An installed extension's switch turns it off in every chat from the next prompt, and **Uninstall**, in the open extension, removes it.
An agent gets at most 50 extensions at once.

Malini checks the marketplace each time Settings, Extensions opens, and at start and every hour while anything is installed.
A newer version that connects to no new host installs itself.
One that connects to a new host waits: the extension names that host and asks you to **Allow** it.
If a publisher withdraws the version you have, Malini turns it off within the hour and says so under the extension.

## Publish an extension

1. Put a `malini.json` at the root of a repository you have in Malini, and your skills in `skills/<name>/SKILL.md`.
2. Commit them: Malini publishes what is committed in `malini.json`, `README.md`, `LICENSE` and `skills/`, and refuses while any of them has uncommitted changes.
3. Open Settings, **Profile**.
   **Extensions you publish** lists that repository.
   Sign in to Bestboy at the top of Profile, claim a handle if you have none, and press **Publish**.

```json
{
	"apiVersion": 2,
	"publisher": "your-handle",
	"name": "svelte",
	"version": "1.0.0",
	"displayName": "Svelte",
	"description": "Svelte 5 docs, the autofixer and best-practice skills, for every agent.",
	"repository": "https://github.com/you/svelte-extension",
	"contributes": {
		"mcpServers": { "svelte": { "url": "https://mcp.svelte.dev/mcp" } }
	}
}
```

- `publisher` is your Bestboy handle, and `name` names the extension: each 1 to 39 lowercase letters, digits and single hyphens.
- `version` is `MAJOR.MINOR.PATCH` and goes up with every publish.
- `displayName` is at most 40 characters, `description` one line of at most 140, and `repository` an optional `https://` link.
- `contributes.mcpServers` names up to 10 remote servers, each `{ "url": "https://…" }`.
- An extension needs at least one server or one skill, and a package holds at most 500 files in 10 MB.

A Claude Code plugin becomes an extension with a `malini.json`: its `skills/` folders carry over as they are, and each remote server in its `.mcp.json` goes under `contributes.mcpServers`.
Commands, agents, hooks and local servers do not carry over.

## What reaches bestboy.dev

Malini reads the marketplace without signing in, and only while Extensions or Profile is open in Settings, or something is installed: the list, an extension's README, and the packages you install.
Profile reads it only when one of your repositories has a `malini.json`.
Publishing sends the package with your Bestboy token.
Nothing else about you, your repositories or your chats goes up.

## The inspector is built from extensions

The inspector sits next to the chat.
The built-in **Repository** extension gives you **Files**: changed files with their diffs, the full tree, file tabs, and todos.
Browser tabs sit there too.
A [chat above repositories](/malini/docs/chat.md#chats-above-repositories) has no repository, so its inspector holds only browser tabs, and only while one is open.
Don't need the files?
Right-click the **Files** tab and choose **Hide Files in every workstream**: it stays hidden everywhere, new workstreams included, until you choose **Show Files in every workstream** the same way.
The **×** on a tab closes it in that workstream only.
With no tab left, the inspector folds to a slim list, and its **Files** row opens Files again in that workstream.

The inspector's extensions are built into Malini, on the MIT licensed `@malini/extension-api` in [`packages/extension-api`](https://github.com/bestboyhq/malini/tree/main/packages/extension-api).
An extension there declares its panels, commands, settings and workflows in `manifest.json` with `apiVersion: 1`, and an automation in a repository's `.malini/workspace.json` runs its commands and workflows when a workstream is created or a frontend resource becomes ready.
