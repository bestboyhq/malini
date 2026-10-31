---
title: Extensions
description: Malini's own marketplace on bestboy.dev. Extensions add MCP servers and skills to every agent in Malini, and anyone with a Bestboy handle publishes them from a repository.
---

## Find and install extensions

The **Extensions** button in the sidebar footer, next to Jobs, opens **Discover**: every extension in the marketplace on bestboy.dev, with who published it and what it does.
**Install** puts it in every chat from that chat's next prompt.
Open an extension to see its MCP servers, its skills, the hosts it reaches, and its README.

An extension adds remote MCP servers and skills, so nothing it adds runs on your Mac.
An extension's servers show under Settings, MCP servers beside your own, and one that needs a sign-in gets **Sign in** there.
Malini keeps extensions in its own folder and hands them to every agent session itself, never through `claude plugin install` or `~/.claude`, so the Claude Code plugins you installed yourself keep working as they are.

## Installed

**Installed** lists what you installed.
Its switch turns an extension off in every chat from the next prompt, and **Uninstall** on the extension's page removes it.
An agent gets at most 50 extensions at once.

Malini checks the marketplace when Extensions opens, and when it starts while anything is installed.
A newer version that reaches no new host installs itself.
One that reaches a new host waits for **Update**, which names that host.
If a publisher withdraws the version you have, Malini turns it off and Installed says so.

## Publish an extension

1. Put a `malini.json` at the root of a repository you have in Malini, and your skills in `skills/<name>/SKILL.md`.
2. Commit them: Malini publishes what is committed in `malini.json`, `README.md`, `LICENSE` and `skills/`, and refuses while any of them has uncommitted changes.
3. Open Extensions, **Published**, sign in to Bestboy, claim a handle if you have none, and press **Publish**.

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

Malini reads the marketplace without signing in, and only while Extensions is open or something is installed: the list, an extension's page, and the packages you install.
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
