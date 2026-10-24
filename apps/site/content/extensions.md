---
title: Extensions
description: Malini's inspector is built from extensions - panels, commands, settings, and workflows declared in a manifest, on an MIT licensed extension API.
---

## The inspector is built from extensions

The inspector sits next to the chat.
The built-in **Repository** extension gives you **Files**: changed files with their diffs, the full tree, file tabs, and todos.
Browser tabs sit there too.
A [chat above repositories](/malini/docs/chat.md#chats-above-repositories) has no repository, so its inspector holds only browser tabs, and only while one is open.
Don't need the files?
Right-click the **Files** tab and choose **Hide Files in every workstream**: it stays hidden everywhere, new workstreams included, until you choose **Show Files in every workstream** the same way.
The **×** on a tab closes it in that workstream only.
With no tab left, the inspector folds to a slim list, and its **Files** row opens Files again in that workstream.

## What an extension contributes

An extension declares its contributions in `manifest.json`:

- **panels** in the inspector,
- **commands**,
- **settings**,
- **workflows**.

An automation in a repository's `.malini/workspace.json` runs an extension's commands and workflows when a new workstream is created or a frontend resource becomes ready.

## The extension API

An extension reaches the workstream and the repository through `@malini/extension-api`, in [`packages/extension-api`](https://github.com/bestboyhq/malini/tree/main/packages/extension-api).
The API is MIT licensed, so an extension can use any license.

```ts
import type { ExtensionModule } from '@malini/extension-api';

const extension: ExtensionModule = {
	async activate(api) {
		await api.notifications.show({ title: api.manifest.name, body: 'Active', level: 'info' });
	},
};

export default extension;
```

Extensions declare `apiVersion: 1` in `manifest.json`, and Malini refuses an unsupported manifest before it activates the extension.
The manifest's JSON schema is `@malini/extension-api/manifest.schema.json`, and `createTestHost` from `@malini/extension-api/test` runs an extension in tests.

The extension API package is private for now and lives inside the Malini repository.
