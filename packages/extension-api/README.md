# @malini/extension-api

`@malini/extension-api` is Malini's versioned internal extension contract.
Every extension uses the same manifest, lifecycle, contributions, workstream and repository APIs, and deterministic test host.
The package is private and consumed only inside this monorepo for now.

```ts
import type { ExtensionModule } from '@malini/extension-api';

const extension: ExtensionModule = {
	async activate(api) {
		await api.notifications.show({ title: api.manifest.name, body: 'Active', level: 'info' });
	},
};

export default extension;
```

Use `createTestHost` from `@malini/extension-api/test` for contract, scenario, and replay tests.
The JSON manifest schema is exported as `@malini/extension-api/manifest.schema.json`.

API v1 follows semantic versioning.
Extensions declare `apiVersion: 1` in `manifest.json`, and Malini rejects unsupported manifests before activation.
