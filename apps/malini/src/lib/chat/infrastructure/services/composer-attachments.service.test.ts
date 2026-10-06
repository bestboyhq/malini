// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { composerAttachments } from './composer-attachments.service';

function installPlatform(): FakePlatform {
	const platform = createFakePlatform();
	setPlatformForTest(platform);
	return platform;
}

function png(name: string, bytes: number[] = [0x89, 0x50, 0x4e, 0x47]): File {
	return new File([new Uint8Array(bytes)], name, { type: 'image/png' });
}

afterEach(() => {
	setPlatformForTest(null);
});

describe('staging a pasted file', () => {
	it('sends the file as bare base64, without the data-url prefix', async () => {
		const platform = installPlatform();

		const staged = await composerAttachments.stageFile('ws-1', 'shot.png', png('shot.png'));

		expect(platform.calls).toEqual([
			{
				command: 'chat.stage-attachment-bytes',
				args: { workstreamId: 'ws-1', fileName: 'shot.png', base64: 'iVBORw==' },
			},
		]);
		expect(staged).toMatchObject({ displayName: 'shot.png', mediaType: 'image/png' });
	});

	it('reads an empty file as an empty payload', async () => {
		const platform = installPlatform();

		await composerAttachments.stageFile('ws-1', 'shot.png', png('shot.png', []));

		expect(platform.calls.at(-1)?.args).toMatchObject({ base64: '' });
	});
});
