import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewWorkstreamImageCommand } from '$lib/chat/application/commands/preview-workstream-image.command';
import { releaseImagePreviewsCommand } from '$lib/chat/application/commands/release-image-previews.command';
import { keepWorkstreamFilesFreshHook } from '$lib/chat/application/hooks/keep-workstream-files-fresh.hook';
import { imagePreviewQuery } from '$lib/chat/application/queries/image-preview.query.svelte';
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

function filesChanged(
	platform: FakePlatform,
	workstreamId: string,
	changedPaths: string[] | null = null,
): void {
	platform.emit('repositories:workstream-files-changed', {
		workstreamId,
		changedAt: new Date().toISOString(),
		paths: changedPaths,
	});
}

function imageReads(platform: FakePlatform): number {
	return platform.calls.filter(({ command }) => command === 'repositories.read-workstream-image')
		.length;
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

	it('shows an image the agent overwrote, and re-reads only the image that changed', async () => {
		const platform = installPlatform({ 'ws-a': ['.context/shot.png'] });
		let base64 = 'AAAA';
		platform.define('repositories.read-workstream-image', async () => ({
			status: 'ready',
			bytes: { mediaType: 'image/png', base64, size: 3 },
		}));
		const owner = 'transcript';
		const path = './.context/shot.png';
		const source = (): string | null => {
			const preview = imagePreviewQuery.data(owner, path);
			return preview?.status === 'ready' ? preview.src : null;
		};
		releases.push(keepWorkstreamFilesFreshHook('ws-a'), () => releaseImagePreviewsCommand(owner));
		previewWorkstreamImageCommand({ owner, workstreamId: 'ws-a', path });
		await vi.waitFor(() => expect(source()).not.toBeNull());
		const first = source();

		filesChanged(platform, 'ws-a', ['src/unrelated.ts']);
		filesChanged(platform, 'ws-b', ['.context/shot.png']);
		await vi.waitFor(() => expect(listingCalls(platform)).toBe(2));
		expect(imageReads(platform)).toBe(1);

		base64 = 'BBBB';
		filesChanged(platform, 'ws-a', ['.context/shot.png']);

		expect(source()).toBe(first);
		await vi.waitFor(() => expect(source()).not.toBe(first));
		expect(imageReads(platform)).toBe(2);
	});
});
