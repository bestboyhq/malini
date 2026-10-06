import { describe, expect, it } from 'vitest';

import { extensionDirectoryHref, extensionInspectorHref } from './extension-directory-navigation';

describe('extension directory navigation', () => {
	it('keeps discovery inside the active workstream inspector and preserves the agent session', () => {
		const location = {
			workstreamId: 'workstream/one',
			agentSessionId: 'agent?one',
		};

		expect(extensionDirectoryHref(location)).toBe(
			'/workstreams/workstream%2Fone?agent=agent%3Fone&inspector=extensions',
		);
		expect(extensionDirectoryHref(location, 'example.terminal')).toBe(
			'/workstreams/workstream%2Fone?agent=agent%3Fone&inspector=extensions&extension=example.terminal',
		);
		expect(extensionInspectorHref(location)).toBe(
			'/workstreams/workstream%2Fone?agent=agent%3Fone',
		);
	});

	it('omits an empty agent session query and never puts the workstream in the path', () => {
		expect(
			extensionDirectoryHref({
				workstreamId: 'workstream',
			}),
		).toBe('/workstreams/workstream?inspector=extensions');
	});
});
