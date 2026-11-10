import { describe, expect, it } from 'vitest';
import { RETIRED_CHATS_PROJECT_ID, isRetiredChat } from './retired-chats';

describe('isRetiredChat', () => {
	it('marks every chat of the retired Home and organization project', () => {
		expect(isRetiredChat({ projectId: RETIRED_CHATS_PROJECT_ID })).toBe(true);
	});

	it('keeps repository work', () => {
		expect(isRetiredChat({ projectId: 'acme-api' })).toBe(false);
	});
});
