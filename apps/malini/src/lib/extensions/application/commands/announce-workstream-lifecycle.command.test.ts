import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from '$hyper-ui/components/toast';

import { announceWorkstreamLifecycleCommand } from './announce-workstream-lifecycle.command';

const runtime = vi.hoisted(() => ({
	archived: async (_workstreamId: string): Promise<void> => undefined,
	deleted: async (_workstreamId: string): Promise<void> => undefined,
}));

vi.mock('../../infrastructure/stores/extension-runtime.store.svelte', () => ({
	extensionRuntimeStore: {
		isMounted: () => true,
		deferLifecycle: () => undefined,
		coordinator: () => ({
			announceWorkstreamArchived: (workstreamId: string) => runtime.archived(workstreamId),
			announceWorkstreamDeleted: (workstreamId: string) => runtime.deleted(workstreamId),
		}),
	},
}));

afterEach(() => {
	vi.restoreAllMocks();
});

async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('announceWorkstreamLifecycleCommand', () => {
	it('tells extensions about an archived and a deleted workstream without a warning', async () => {
		const archived = vi.spyOn(runtime, 'archived');
		const deleted = vi.spyOn(runtime, 'deleted');
		const warning = vi.spyOn(toast, 'warning');

		announceWorkstreamLifecycleCommand('archived', 'workstream-a');
		announceWorkstreamLifecycleCommand('deleted', 'workstream-b');
		await settle();

		expect(archived).toHaveBeenCalledWith('workstream-a');
		expect(deleted).toHaveBeenCalledWith('workstream-b');
		expect(warning).not.toHaveBeenCalled();
	});

	it('warns that extension cleanup needs attention when an extension fails', async () => {
		vi.spyOn(runtime, 'deleted').mockRejectedValueOnce(new Error('cleanup crashed'));
		vi.spyOn(runtime, 'archived').mockRejectedValueOnce('   ');
		const warning = vi.spyOn(toast, 'warning');

		announceWorkstreamLifecycleCommand('deleted', 'workstream-a');
		announceWorkstreamLifecycleCommand('archived', 'workstream-b');
		await settle();

		expect(warning.mock.calls.map(([message]) => message)).toEqual([
			'Workstream deleted, but its extension cleanup needs attention · cleanup crashed',
			'Workstream archived, but its extension cleanup needs attention · An extension did not finish its workstream cleanup',
		]);
		expect(warning.mock.calls.map(([, options]) => options?.context)).toEqual([
			{ workstream: 'workstream-a' },
			{ workstream: 'workstream-b' },
		]);
	});
});
