import { describe, expect, it } from 'vitest';

import { extensionRuntimeStore } from '../../infrastructure/stores/extension-runtime.store.svelte';
import { activateExtensionsHook } from './activate-extensions.hook';

const WORKSTREAM = {
	id: 'workstream-1',
	path: '/tmp/malini/worktrees/workstream-1',
	repositoryPath: '/Users/dev/work/malini',
	branch: 'malini/workstream-1',
	baseBranch: 'main',
};

describe('activateExtensionsHook', () => {
	it('waits for a mounted runtime instead of failing the inspector that asked for it', () => {
		expect(extensionRuntimeStore.isMounted()).toBe(false);
		const activate = activateExtensionsHook();

		const cancel = activate({
			workstream: WORKSTREAM,
			currentWorkstreamId: () => WORKSTREAM.id,
			creationContext: null,
			onCreationAnnounced: () => undefined,
		});

		expect(cancel).toBeTypeOf('function');
		expect(extensionRuntimeStore.requestedWorkstreamFingerprint).toBeNull();
	});
});
