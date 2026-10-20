import { describe, expect, it } from 'vitest';

import type { AgentComposerFileAttachment } from '$lib/chat/domain/composer-actions';
import type { AgentTranscriptReference } from '$lib/chat/domain/transcript-reference';
import { mergeFailedComposerSubmissions } from './composer-submission-recovery';

const attachment = (id: string): AgentComposerFileAttachment => ({
	id: `att-${id.padEnd(32, '0')}`,
	displayName: `${id}.md`,
	relativePath: `.malini/agent-attachments/${id}.md`,
	mediaType: 'text/markdown',
	size: 1,
	sha256: id.padEnd(64, 'a').slice(0, 64),
});

const transcript = (sessionId: string): AgentTranscriptReference => ({
	sessionId,
	label: `Chat ${sessionId}`,
});

describe('mergeFailedComposerSubmissions', () => {
	it('restores two failures in FIFO order before a newer draft without losing context', () => {
		const shared = attachment('shared');
		const recovered = mergeFailedComposerSubmissions(
			[
				{
					prompt: 'first failed turn',
					contextFiles: ['src/first.ts'],
					attachments: [attachment('first'), shared],
					transcriptReferences: [transcript('one')],
				},
				{
					prompt: 'second failed turn',
					contextFiles: ['src/second.ts', 'src/first.ts'],
					attachments: [attachment('second'), shared],
					transcriptReferences: [transcript('two'), transcript('one')],
				},
			],
			{
				prompt: 'newer unsubmitted draft',
				contextFiles: ['src/newer.ts'],
				attachments: [attachment('newer')],
				transcriptReferences: [transcript('three')],
			},
		);

		expect(recovered.prompt).toBe(
			'first failed turn\n\nsecond failed turn\n\nnewer unsubmitted draft',
		);
		expect(recovered.contextFiles).toEqual(['src/first.ts', 'src/second.ts', 'src/newer.ts']);
		expect(recovered.attachments.map(({ displayName }) => displayName)).toEqual([
			'first.md',
			'shared.md',
			'second.md',
			'newer.md',
		]);
		expect(recovered.transcriptReferences?.map(({ sessionId }) => sessionId)).toEqual([
			'one',
			'two',
			'three',
		]);
	});
});
