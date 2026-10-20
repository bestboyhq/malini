import { describe, expect, it } from 'vitest';
import { runIdForPromptRequest } from '$contract/chat-identity';
import { newPromptRequestId } from './prompt-identity';

describe('prompt identity', () => {
	it('mints ids the main process will name a run after', () => {
		for (let attempt = 0; attempt < 32; attempt += 1) {
			expect(runIdForPromptRequest(newPromptRequestId())).not.toBeNull();
		}
	});
});
