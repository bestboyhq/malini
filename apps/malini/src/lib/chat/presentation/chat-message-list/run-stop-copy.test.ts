import { describe, expect, it } from 'vitest';
import {
	CONTINUE_AFTER_PAUSE_PROMPT,
	CONTINUE_AFTER_STOP_PROMPT,
} from '$contract/agent-state-machine';
import { continuationNotice, failedRunNextStep, pauseReason, pauseTitle } from './run-stop-copy';

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
	it('rolls a notice for each continuation Malini sent, in every wording it has sent', () => {
		expect(continuationNotice(CONTINUE_AFTER_PAUSE_PROMPT, 0, 'Claude')).toBe(
			'Malini restarted. Back for more',
		);
		expect(continuationNotice(CONTINUE_AFTER_PAUSE_PROMPT, 4, 'Claude')).toBe(
			'Malini restarted. Now with upgrades',
		);
		expect(
			continuationNotice(CONTINUE_AFTER_PAUSE_PROMPT.replace('Malini', 'malini'), 8, 'Claude'),
		).toBe('Malini restarted. Feeling brand new');
		expect(continuationNotice(CONTINUE_AFTER_STOP_PROMPT, 2, 'Claude')).toBe(
			'Claude is back. Well rested',
		);
		expect(continuationNotice(CONTINUE_AFTER_STOP_PROMPT, 3, 'Claude')).toBe(
			'Claude is back. Coffee break over',
		);
		expect(continuationNotice('Malini restarted, can you check why?', 0, 'Claude')).toBeNull();
	});

	it("names the chat's provider when it is back", () => {
		expect(continuationNotice(CONTINUE_AFTER_STOP_PROMPT, 2, 'OpenCode')).toBe(
			'OpenCode is back. Well rested',
		);
	});
});

describe('a stopped run', () => {
	it("names the chat's provider, not Claude, in what stopped it and what to do next", () => {
		expect(pauseReason('billing', 'DeepSeek')).toBe(
			'Your DeepSeek plan or billing stopped the turn.',
		);
		expect(failedRunNextStep('billing', 'DeepSeek')).toBe(
			'Check your DeepSeek plan or billing, then try again.',
		);
		expect(pauseReason('usage-limit', 'Claude')).toBe(
			'You hit your Claude usage limit. Malini goes on when it resets.',
		);
		expect(failedRunNextStep('sign-in', 'DeepSeek')).toBeNull();
	});
});
