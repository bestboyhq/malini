import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadWorkstreamFilesCommand } from '$lib/chat/application/commands/load-workstream-files.command';
import { workstreamFileListingQuery } from '$lib/chat/application/queries/workstream-file-listing.query.svelte';
import { workstreamFilesAggregate } from '$lib/chat/infrastructure/aggregates/workstream-files.aggregate.svelte';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';

function installPlatform(): FakePlatform {
	const platform = createFakePlatform({
		workstreamFiles: { 'ws-a': ['src/a.ts', 'src/b.ts'], 'ws-b': ['README.md'] },
	});
	setPlatformForTest(platform);
	return platform;
}

function listingCalls(platform: FakePlatform): unknown[] {
	return platform.calls
		.filter(({ command }) => command === 'repositories.workstream-files')
		.map(({ args }) => args);
}

afterEach(() => {
	workstreamFilesAggregate.reset();
	setPlatformForTest(null);
});

describe('listing workstream files for the context picker', () => {
	it('lists the workstream once and answers later opens from what it read', async () => {
		const platform = installPlatform();

		loadWorkstreamFilesCommand('ws-a');
		expect(workstreamFileListingQuery.data('ws-a')?.status).toBe('loading');
		await vi.waitFor(() =>
			expect(workstreamFileListingQuery.data('ws-a')).toEqual({
				workstreamId: 'ws-a',
				status: 'ready',
				files: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }],
			}),
		);
		loadWorkstreamFilesCommand('ws-a');

		expect(listingCalls(platform)).toEqual([{ workstreamId: 'ws-a' }]);
	});

	it('answers only for the workstream it listed, and lists again for another one', async () => {
		const platform = installPlatform();
		loadWorkstreamFilesCommand('ws-a');
		await vi.waitFor(() => expect(workstreamFileListingQuery.data('ws-a')?.status).toBe('ready'));

		loadWorkstreamFilesCommand('ws-b');

		expect(workstreamFileListingQuery.data('ws-a')).toBeNull();
		await vi.waitFor(() =>
			expect(workstreamFileListingQuery.data('ws-b')).toMatchObject({
				status: 'ready',
				files: [{ path: 'README.md' }],
			}),
		);
		expect(listingCalls(platform)).toEqual([{ workstreamId: 'ws-a' }, { workstreamId: 'ws-b' }]);
	});

	it('states a listing failure and lists again on the next open', async () => {
		const platform = installPlatform();
		platform.define('repositories.workstream-files', async () => {
			throw new Error('worktree is missing');
		});

		loadWorkstreamFilesCommand('ws-a');
		await vi.waitFor(() =>
			expect(workstreamFileListingQuery.data('ws-a')).toEqual({
				workstreamId: 'ws-a',
				status: 'failed',
				error: 'worktree is missing',
			}),
		);
		loadWorkstreamFilesCommand('ws-a');

		expect(listingCalls(platform)).toHaveLength(2);
	});
});
