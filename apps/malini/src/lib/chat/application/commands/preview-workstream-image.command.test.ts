import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewWorkstreamImageCommand } from '$lib/chat/application/commands/preview-workstream-image.command';
import { releaseImagePreviewsCommand } from '$lib/chat/application/commands/release-image-previews.command';
import { imagePreviewQuery } from '$lib/chat/application/queries/image-preview.query.svelte';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';

const OWNER = 'tool-row';
const PATH = 'docs/diagram.png';

function installPlatform(): FakePlatform {
	const platform = createFakePlatform();
	setPlatformForTest(platform);
	return platform;
}

afterEach(() => {
	releaseImagePreviewsCommand(OWNER);
	setPlatformForTest(null);
});

describe('previewing an image the agent read', () => {
	it('reads the image from the workstream and shows it', async () => {
		const platform = installPlatform();
		platform.define('repositories.read-workstream-image', async () => ({
			mediaType: 'image/png',
			base64: 'AAAA',
			size: 3,
		}));

		previewWorkstreamImageCommand({ owner: OWNER, workstreamId: 'ws-a', path: PATH });

		await vi.waitFor(() =>
			expect(imagePreviewQuery.data(OWNER, PATH)).toMatchObject({ status: 'ready' }),
		);
		expect(platform.calls).toEqual([
			{ command: 'repositories.read-workstream-image', args: { workstreamId: 'ws-a', path: PATH } },
		]);
	});

	it('says an image is too large when the host declines to send its bytes', async () => {
		const platform = installPlatform();
		platform.define('repositories.read-workstream-image', async () => null);

		previewWorkstreamImageCommand({ owner: OWNER, workstreamId: 'ws-a', path: PATH });

		await vi.waitFor(() =>
			expect(imagePreviewQuery.data(OWNER, PATH)).toEqual({
				status: 'unavailable',
				reason: 'Too large to preview here',
			}),
		);
	});

	it('says why an image could not be read', async () => {
		const platform = installPlatform();
		platform.define('repositories.read-workstream-image', async () => {
			throw new Error('file is outside the workstream');
		});

		previewWorkstreamImageCommand({ owner: OWNER, workstreamId: 'ws-a', path: PATH });

		await vi.waitFor(() =>
			expect(imagePreviewQuery.data(OWNER, PATH)).toEqual({
				status: 'unavailable',
				reason: 'file is outside the workstream',
			}),
		);
	});
});
