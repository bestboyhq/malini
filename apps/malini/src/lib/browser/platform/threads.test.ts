import { describe, expect, it } from 'vitest';
import { LIFECYCLE_KINDS, SESSION_STATUSES } from '$contract/agent-state-machine';
import { movesPin, threadPin } from './threads';

describe('thread pins', () => {
	it('move on a new prompt and on every turn of a run, an answered question included', () => {
		const missed = ['user.message', ...LIFECYCLE_KINDS].filter((kind) => !movesPin(kind));
		expect(missed).toEqual([]);
		expect(movesPin('assistant.delta')).toBe(false);
	});

	it('wait while the thread asks the user, work while its run is open, and end done or failed', () => {
		const statuses = SESSION_STATUSES.map((status) => [
			status,
			threadPin({
				sessionId: 's',
				status,
				waiting: status === 'waiting_for_approval',
				prompt: 'p',
				url: 'https://example.com/',
				domPath: 'body',
				outcome: null,
			}).status,
		]);
		expect(Object.fromEntries(statuses)).toEqual({
			idle: 'done',
			running: 'working',
			waiting_for_approval: 'waiting',
			completed: 'done',
			failed: 'failed',
		});
	});
});
