import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepWorkstreamFilesFreshHook } from '$lib/chat/application/hooks/keep-workstream-files-fresh.hook';
import { workstreamFileListingQuery } from '$lib/chat/application/queries/workstream-file-listing.query.svelte';
import { workstreamFilesAggregate } from '$lib/chat/infrastructure/aggregates/workstream-files.aggregate.svelte';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';

const releases: Array<() => void> = [];

afterEach(() => {
	for (const release of releases.splice(0)) release();
	workstreamFilesAggregate.reset();
	setPlatformForTest(null);
});

function installPlatform(files: Record<string, string[]>): FakePlatform {
	const platform = createFakePlatform();
	platform.define('repositories.workstream-files', async ({ workstreamId }) =>
		(files[workstreamId] ?? []).map((path) => ({ path })),
	);
	setPlatformForTest(platform);
	return platform;
}

function listingCalls(platform: FakePlatform): number {
	return platform.calls.filter(({ command }) => command === 'repositories.workstream-files').length;
}

function paths(workstreamId: string): readonly string[] | null {
	const listing = workstreamFileListingQuery.data(workstreamId);
	return listing?.status === 'ready' ? listing.files.map(({ path }) => path) : null;
}

function filesChanged(platform: FakePlatform, workstreamId: string): void {
	platform.emit('repositories:workstream-files-changed', {
		workstreamId,
		changedAt: new Date().toISOString(),
	});
}

describe('keeping the workstream file list current', () => {
	it('lists the workstream and lists it again when its files change', async () => {
		const files = { 'ws-a': ['src/a.ts'] };
		const platform = installPlatform(files);
		releases.push(keepWorkstreamFilesFreshHook('ws-a'));
		await vi.waitFor(() => expect(paths('ws-a')).toEqual(['src/a.ts']));

		files['ws-a'] = ['src/a.ts', 'src/new.ts'];
		filesChanged(platform, 'ws-a');

		expect(paths('ws-a')).toEqual(['src/a.ts']);
		await vi.waitFor(() => expect(paths('ws-a')).toEqual(['src/a.ts', 'src/new.ts']));
	});

	it('ignores changes in other workstreams and keeps the listing when nothing was added or removed', async () => {
		const platform = installPlatform({ 'ws-a': ['src/a.ts'], 'ws-b': ['README.md'] });
		releases.push(keepWorkstreamFilesFreshHook('ws-a'));
		await vi.waitFor(() => expect(paths('ws-a')).toEqual(['src/a.ts']));
		const listing = workstreamFileListingQuery.data('ws-a');

		filesChanged(platform, 'ws-b');
		expect(listingCalls(platform)).toBe(1);

		filesChanged(platform, 'ws-a');
		await vi.waitFor(() => expect(listingCalls(platform)).toBe(2));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(workstreamFileListingQuery.data('ws-a')).toBe(listing);
	});

	it('stops listening once released', async () => {
		const platform = installPlatform({ 'ws-a': ['src/a.ts'] });
		const release = keepWorkstreamFilesFreshHook('ws-a');
		await vi.waitFor(() => expect(paths('ws-a')).toEqual(['src/a.ts']));

		release();
		filesChanged(platform, 'ws-a');

		expect(listingCalls(platform)).toBe(1);
	});
});
