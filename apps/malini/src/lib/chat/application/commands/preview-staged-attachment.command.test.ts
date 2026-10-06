import { afterEach, describe, expect, it, vi } from 'vitest';

import { previewStagedAttachmentCommand } from '$lib/chat/application/commands/preview-staged-attachment.command';
import { releaseImagePreviewsCommand } from '$lib/chat/application/commands/release-image-previews.command';
import { imagePreviewQuery } from '$lib/chat/application/queries/image-preview.query.svelte';
import type { StagedAgentAttachment } from '$lib/chat/domain/composer-actions';
import type { ImageBytes } from '$lib/chat/domain/image-bytes';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';

const WORKSTREAM = 'ws-composer';
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const IMAGE: StagedAgentAttachment = {
	id: 'att-0123456789abcdef0123456789abcdef',
	displayName: 'image.png',
	relativePath: '.malini/agent-attachments/att-0123456789abcdef0123456789abcdef/image.png',
	mediaType: 'image/png',
	size: 204_800,
	sha256: 'a'.repeat(64),
};

const SECOND_IMAGE: StagedAgentAttachment = {
	...IMAGE,
	id: `att-${'c'.repeat(32)}`,
	displayName: 'diagram.png',
	relativePath: `.malini/agent-attachments/att-${'c'.repeat(32)}/diagram.png`,
};

const DOCUMENT: StagedAgentAttachment = {
	id: 'att-fedcba9876543210fedcba9876543210',
	displayName: 'notes.txt',
	relativePath: '.malini/agent-attachments/att-fedcba9876543210fedcba9876543210/notes.txt',
	mediaType: 'text/plain',
	size: 512,
	sha256: 'b'.repeat(64),
};

let nextOwner = 0;

function owner(): string {
	nextOwner += 1;
	return `composer-${nextOwner}`;
}

function preview(previewOwner: string, attachment: StagedAgentAttachment): void {
	previewStagedAttachmentCommand({ owner: previewOwner, workstreamId: WORKSTREAM, attachment });
}

function urlFor(previewOwner: string, attachment: StagedAgentAttachment): string | null {
	const current = imagePreviewQuery.data(previewOwner, attachment.id);
	return current?.status === 'ready' ? current.src : null;
}

function seededPlatform(): void {
	setPlatformForTest(
		createFakePlatform({
			stagedAgentAttachments: { [WORKSTREAM]: [IMAGE, SECOND_IMAGE, DOCUMENT] },
		}),
	);
}

function settled(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function deferredPlatform(): {
	reads: string[];
	settle(bytes: ImageBytes | null): Promise<void>;
	refuse(message: string): Promise<void>;
} {
	const reads: string[] = [];
	let resolveRead: ((bytes: ImageBytes | null) => void) | null = null;
	let rejectRead: ((error: Error) => void) | null = null;
	const platform = createFakePlatform();
	platform.define('chat.read-staged-attachment', (input) => {
		reads.push(input.attachmentId);
		return new Promise((resolve, reject) => {
			resolveRead = resolve;
			rejectRead = reject;
		});
	});
	setPlatformForTest(platform);
	return {
		reads,
		settle: async (bytes) => {
			resolveRead?.(bytes);
			await settled();
		},
		refuse: async (message) => {
			rejectRead?.(new Error(message));
			await settled();
		},
	};
}

describe('previewing a staged attachment chip', () => {
	afterEach(() => {
		setPlatformForTest(null);
		vi.restoreAllMocks();
	});

	it('turns a previewed image into an object url over a blob of the host bytes', async () => {
		seededPlatform();
		const created = vi.spyOn(URL, 'createObjectURL');
		const composer = owner();

		expect(urlFor(composer, IMAGE)).toBeNull();
		preview(composer, IMAGE);
		await vi.waitFor(() => expect(urlFor(composer, IMAGE)).not.toBeNull());

		expect(urlFor(composer, IMAGE)).toMatch(/^blob:/u);
		const blob = created.mock.calls[0]?.[0];
		if (!(blob instanceof Blob)) throw new Error('createObjectURL was not called with a Blob');
		expect(blob.type).toBe('image/png');
		expect(blob.size).toBe(70);
		expect(new Uint8Array(await blob.arrayBuffer()).subarray(0, 8)).toEqual(PNG_SIGNATURE);

		releaseImagePreviewsCommand(composer);
	});

	it('reads once however often the same chip is hovered', async () => {
		const { reads, settle } = deferredPlatform();
		const composer = owner();

		preview(composer, IMAGE);
		preview(composer, IMAGE);
		expect(reads).toEqual([IMAGE.id]);

		await settle({ mediaType: 'image/png', base64: 'AAAA', size: 3 });
		expect(urlFor(composer, IMAGE)).not.toBeNull();
		preview(composer, IMAGE);

		expect(reads).toEqual([IMAGE.id]);
		releaseImagePreviewsCommand(composer);
	});

	it('never reaches for a non-image attachment', () => {
		const { reads } = deferredPlatform();
		const composer = owner();

		preview(composer, DOCUMENT);

		expect(reads).toEqual([]);
		expect(urlFor(composer, DOCUMENT)).toBeNull();
		releaseImagePreviewsCommand(composer);
	});

	it('caches a refusal so a declined attachment is asked for once', async () => {
		const { reads, refuse } = deferredPlatform();
		const composer = owner();

		preview(composer, IMAGE);
		await refuse('attachment is not staged for this workstream');
		preview(composer, IMAGE);
		await settled();

		expect(reads).toEqual([IMAGE.id]);
		expect(urlFor(composer, IMAGE)).toBeNull();
		releaseImagePreviewsCommand(composer);
	});

	it('caches a decline so an attachment past the preview cap is asked for once', async () => {
		const { reads, settle } = deferredPlatform();
		const composer = owner();

		preview(composer, IMAGE);
		await settle(null);
		preview(composer, IMAGE);
		await settled();

		expect(reads).toEqual([IMAGE.id]);
		expect(urlFor(composer, IMAGE)).toBeNull();
		releaseImagePreviewsCommand(composer);
	});

	it('revokes every url it handed out and forgets them on release', async () => {
		seededPlatform();
		const revoked = vi.spyOn(URL, 'revokeObjectURL');
		const composer = owner();

		preview(composer, IMAGE);
		preview(composer, SECOND_IMAGE);
		await vi.waitFor(() => {
			expect(urlFor(composer, IMAGE)).not.toBeNull();
			expect(urlFor(composer, SECOND_IMAGE)).not.toBeNull();
		});
		const handedOut = [urlFor(composer, IMAGE), urlFor(composer, SECOND_IMAGE)];

		releaseImagePreviewsCommand(composer);

		expect(revoked.mock.calls.map(([url]) => url).sort()).toEqual([...handedOut].sort());
		expect(urlFor(composer, IMAGE)).toBeNull();
		expect(urlFor(composer, SECOND_IMAGE)).toBeNull();
	});

	it('keeps another composer’s previews when one composer releases its own', async () => {
		seededPlatform();
		const released = owner();
		const kept = owner();

		preview(released, IMAGE);
		preview(kept, IMAGE);
		await vi.waitFor(() => {
			expect(urlFor(released, IMAGE)).not.toBeNull();
			expect(urlFor(kept, IMAGE)).not.toBeNull();
		});

		releaseImagePreviewsCommand(released);

		expect(urlFor(released, IMAGE)).toBeNull();
		expect(urlFor(kept, IMAGE)).not.toBeNull();
		releaseImagePreviewsCommand(kept);
	});

	it('mints nothing for a read that lands after release', async () => {
		const { settle } = deferredPlatform();
		const created = vi.spyOn(URL, 'createObjectURL');
		const composer = owner();

		preview(composer, IMAGE);
		releaseImagePreviewsCommand(composer);
		await settle({ mediaType: 'image/png', base64: 'AAAA', size: 3 });

		expect(created).not.toHaveBeenCalled();
		expect(urlFor(composer, IMAGE)).toBeNull();
	});
});
