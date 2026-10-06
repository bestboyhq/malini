import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	currentPath,
	installRepositoriesPlatform,
	openRoute,
	resetRepositoriesState,
	stageFailedProvisioning,
	workstream,
} from '$shared/repositories/application/provisioning.testkit';
import { removeFailedWorkstreamCommand } from '$shared/repositories/application/commands/remove-failed-workstream.command';
import { activeWorkstreamsQuery } from '$shared/repositories/application/queries/active-workstreams.query.svelte';
import { provisioningRecordQuery } from '$shared/repositories/application/queries/provisioning-record.query.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';

afterEach(() => {
	resetRepositoriesState();
});

describe('removing a workstream whose setup failed', () => {
	it('drops the workstream and opens the next usable workstream', async () => {
		installRepositoriesPlatform();
		workstreamsAggregate.upsert(workstream('ws-next'));
		stageFailedProvisioning('ws-failed');
		await openRoute('/workstreams/ws-failed');

		removeFailedWorkstreamCommand('ws-failed');

		await vi.waitFor(() => expect(currentPath()).toBe('/workstreams/ws-next'));
		expect(provisioningRecordQuery.data('ws-failed')).toBeNull();
		expect(activeWorkstreamsQuery.data.map(({ id }) => id)).toEqual(['ws-next']);
	});

	it('returns to the repositories list when no usable workstream is left', async () => {
		installRepositoriesPlatform();
		workstreamsAggregate.upsert(workstream('ws-archived', { status: 'archived' }));
		stageFailedProvisioning('ws-still-provisioning');
		stageFailedProvisioning('ws-failed');
		await openRoute('/workstreams/ws-failed');

		removeFailedWorkstreamCommand('ws-failed');

		await vi.waitFor(() => expect(currentPath()).toBe('/'));
		expect(provisioningRecordQuery.data('ws-failed')).toBeNull();
	});
});
