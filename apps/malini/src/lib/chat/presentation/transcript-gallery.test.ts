// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { RenderItem, RunGroup } from './render-state';
import { transcriptGalleryImages } from './transcript-gallery';

const SHOT = '.malini/agent-attachments/att-1/shot.png';

function run(runId: string, items: RenderItem[]): RunGroup {
	return {
		runId,
		items,
		terminal: 'completed',
		terminalText: '',
		superseded: false,
		obsoleted: false,
	};
}

describe('transcriptGalleryImages', () => {
	it('collects every image of the chat once, in transcript order', () => {
		const images = transcriptGalleryImages([
			run('r1', [
				{
					kind: 'user',
					key: 'u1',
					seq: 1,
					text: 'look',
					attachments: [
						{
							id: 'att-1',
							displayName: 'shot.png',
							relativePath: SHOT,
							mediaType: 'image/png',
							size: 1,
							sha256: 'a',
						},
						{
							id: 'att-2',
							displayName: 'notes.txt',
							relativePath: 'n.txt',
							mediaType: 'text/plain',
							size: 1,
							sha256: 'b',
						},
					],
				},
				{
					kind: 'tool',
					key: 't1',
					seq: 2,
					tool: {
						name: 'Read',
						startedAt: 1,
						completedAt: 2,
						status: 'completed',
						input: { file_path: SHOT },
						output: { kind: 'image', mediaType: 'image/png', path: SHOT },
					},
				},
			]),
			run('r2', [
				{
					kind: 'assistant',
					key: 'a1',
					seq: 3,
					text: '![after](shots/after.png) [![badge](https://x.dev/b.svg)](https://x.dev) ![](https://x.dev/c.png)',
				},
			]),
		]);

		expect(images).toEqual([
			{ id: SHOT, name: 'shot.png', kind: 'workstream' },
			{ id: 'shots/after.png', name: 'after', kind: 'workstream' },
			{ id: 'https://x.dev/c.png', name: 'image', kind: 'url' },
		]);
	});
});
