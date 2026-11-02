import { describe, expect, it } from 'vitest';
import {
	CONTINUE_AFTER_PAUSE_PROMPT,
	CONTINUE_AFTER_STOP_PROMPT,
} from '$contract/agent-state-machine';
import { continuationNotice, pauseTitle } from './run-stop-copy';

const NOW = new Date(2026, 9, 27, 12, 0);

describe('pauseTitle', () => {
	it('names the time a pause ends, with its day once that is not today', () => {
		expect(pauseTitle(new Date(2026, 9, 27, 15, 31).toISOString(), NOW)).toBe('Paused until 15:31');
		expect(pauseTitle(new Date(2026, 9, 29, 9, 5).toISOString(), NOW)).toBe(
			'Paused until Thu 09:05',
		);
		expect(pauseTitle(new Date(2026, 10, 5, 9, 0).toISOString(), NOW)).toBe(
			'Paused until Nov 5, 09:00',
		);
	});
});

describe('continuationNotice', () => {
	it('names what a continuation Malini sent recovers from, in every wording it has sent', () => {
		expect(continuationNotice(CONTINUE_AFTER_PAUSE_PROMPT)).toBe('Malini restarted, continuing');
		expect(continuationNotice(CONTINUE_AFTER_PAUSE_PROMPT.replace('Malini', 'malini'))).toBe(
			'Malini restarted, continuing',
		);
		expect(continuationNotice(CONTINUE_AFTER_STOP_PROMPT)).toBe('Claude is back, continuing');
		expect(continuationNotice('Malini restarted, can you check why?')).toBeNull();
	});
});
