---
title: Extensions
description: Malini's inspector is built from extensions - panels, commands, settings, and workflows declared in a manifest, on an MIT licensed extension API.
---

## The inspector is built from extensions

The inspector sits next to the chat.
The built-in **Repository** extension gives you **Files**: changed files with their diffs, the full tree, file tabs, and todos.
Browser tabs sit there too.

## What an extension contributes

An extension declares its contributions in `manifest.json`:

- **panels** in the inspector,
- **commands**,
- **settings**,
- **workflows**.

A [routine](/malini/docs/routines.md) can run an extension's commands and workflows as steps.

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
