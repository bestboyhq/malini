import { describe, expect, it } from 'vitest';
import { pullRequestActionOutcome } from './pull-request-action';

const settled = { conflictedPaths: [] };

describe('pullRequestActionOutcome', () => {
	it('announces nothing when an action simply succeeded, since the top bar already shows it', () => {
		for (const kind of ['create', 'push', 'update', 'ready', 'merge'] as const) {
			expect(pullRequestActionOutcome(kind, settled)).toBeNull();
		}
	});

	it('names the review threads it resolved on GitHub', () => {
		expect(pullRequestActionOutcome('push', settled, 1)).toEqual({
			level: 'success',
			message: '1 review thread resolved on GitHub',
		});
		expect(pullRequestActionOutcome('push', settled, 2)?.message).toBe(
			'2 review threads resolved on GitHub',
		);
	});

	it('says when an update stopped on merge conflicts', () => {
		expect(pullRequestActionOutcome('update', { conflictedPaths: ['a.txt'] })).toEqual({
			level: 'info',
			message: 'The update stopped on merge conflicts. Resolve conflicts to finish it',
		});
	});
});
