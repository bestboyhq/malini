import { flushSync } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountChatHook } from '$lib/chat/application/chat-route.testkit.svelte';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import {
	workstreamImageSourceHook,
	type WorkstreamImageSource,
} from './workstream-image-source.hook.svelte';

const PATH = '.context/report.png';
const BYTES = { mediaType: 'image/png', base64: 'AAAA', size: 3 };

afterEach(() => {
	setPlatformForTest(null);
	vi.restoreAllMocks();
});

describe('images in a transcript', () => {
	it('keep loading when the transcript switches to another workstream', async () => {
		const platform = createFakePlatform();
		setPlatformForTest(platform);
		const reads: Array<() => void> = [];
		platform.define(
			'repositories.read-workstream-image',
			() => new Promise((resolve) => reads.push(() => resolve(BYTES))),
		);
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:report');
		const route = new SvelteMap([['workstream', 'ws-plain']]);
		let source = (): WorkstreamImageSource => () => null;
		const unmount = mountChatHook(() => {
			source = workstreamImageSourceHook(() => route.get('workstream') ?? '');
			return () => {};
		});

		route.set('workstream', 'ws-pictured');
		expect(source()(PATH)).toBeNull();
		flushSync();
		for (const read of reads.splice(0)) read();

		await vi.waitFor(() => expect(source()(PATH)).toBe('blob:report'));
		expect(platform.calls).toEqual([
			{
				command: 'repositories.read-workstream-image',
				args: { workstreamId: 'ws-pictured', path: PATH },
			},
		]);
		unmount();
	});
});
