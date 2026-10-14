import { describe, expect, it } from 'vitest';
import { mountBufferedStreamingMarkdown } from './buffered-streaming-markdown.harness.svelte';

describe('a streaming answer that a newer prompt has moved past', () => {
	it('shows the rest of its text at once instead of typing it out', () => {
		const answer = mountBufferedStreamingMarkdown('First line of the answer.\nSecond line.\n');
		expect(answer.bufferedCharacters()).toBeGreaterThan(0);

		answer.flush();

		expect(answer.bufferedCharacters()).toBe(0);
		answer.stop();
	});
});
