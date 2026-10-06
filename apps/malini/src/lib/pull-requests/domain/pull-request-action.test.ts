import { describe, expect, it } from 'vitest';
import { pullRequestActionSucceededMessage } from './pull-request-action';

describe('pullRequestActionSucceededMessage for push', () => {
	it('says "Pushed" when no uncommitted files were present', () => {
		expect(pullRequestActionSucceededMessage('push', false)).toBe('Pushed');
	});

	it('says "Changes committed and pushed" when uncommitted files were present', () => {
		expect(pullRequestActionSucceededMessage('push', true)).toBe('Changes committed and pushed');
	});

	it('defaults to "Pushed" when hadUncommitted is not supplied', () => {
		expect(pullRequestActionSucceededMessage('push')).toBe('Pushed');
	});
});
