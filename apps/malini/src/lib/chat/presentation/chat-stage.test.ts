import { describe, expect, it } from 'vitest';
import { chatStage } from './chat-stage';

const settled = {
	freshChat: false,
	presentedSessionId: null,
	bootError: null,
	presentationPending: false,
};

describe('which stage the chat surface shows', () => {
	it('offers a fresh chat before anything else', () => {
		expect(chatStage({ ...settled, freshChat: true, presentedSessionId: 's-1' })).toBe('fresh');
	});

	it('keeps a presented transcript on screen while its successor is still pending', () => {
		expect(chatStage({ ...settled, presentedSessionId: 's-1', presentationPending: true })).toBe(
			'transcript',
		);
	});

	it('lets a session error replace the transcript it could not keep', () => {
		expect(chatStage({ ...settled, presentedSessionId: 's-1', bootError: 'offline' })).toBe(
			'error',
		);
		expect(chatStage({ ...settled, bootError: 'offline', presentationPending: true })).toBe(
			'error',
		);
	});

	it('shows the cold shell only when nothing can be presented yet', () => {
		expect(chatStage({ ...settled, presentationPending: true })).toBe('cold');
	});

	it('falls back to the setup guidance once nothing is pending and nothing is presented', () => {
		expect(chatStage(settled)).toBe('empty');
	});
});
