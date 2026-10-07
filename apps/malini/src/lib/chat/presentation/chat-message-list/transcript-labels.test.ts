import { describe, expect, it } from 'vitest';
import { PAUSED_FOR_EXIT_ERROR } from '$contract/agent-state-machine';
import type { RunGroup } from '../render-state';
import { terminalLabel, thinkingPreview, thoughtLabel } from './transcript-labels';

function run(terminal: RunGroup['terminal']): RunGroup {
	return {
		runId: 'r1',
		items: [],
		terminal,
		terminalText: '',
		superseded: false,
		obsoleted: false,
	};
}

describe('the one line of a folded thought', () => {
	it('collapses the newlines a streamed thought is full of', () => {
		expect(thinkingPreview('first\n\n  second\tthird ')).toBe('first second third');
	});

	it('cuts at 240 characters and says it cut', () => {
		const preview = thinkingPreview('x'.repeat(400));
		expect(preview).toHaveLength(241);
		expect(preview.endsWith('…')).toBe(true);
	});

	it('adds no ellipsis to a thought that fits', () => {
		expect(thinkingPreview('short')).toBe('short');
	});
});

describe('how long a thought took', () => {
	it('names the duration once there is a whole second to name', () => {
		expect(thoughtLabel(4)).toBe('Thought for 4s');
		expect(thoughtLabel(4.6)).toBe('Thought for 5s');
	});

	it('says nothing precise about a sub-second thought', () => {
		expect(thoughtLabel(0.4)).toBe('Thought briefly');
		expect(thoughtLabel(null)).toBe('Thought briefly');
	});
});

describe('how a run ended', () => {
	it('separates an instruction the reader gave from a fault the app hit', () => {
		expect(terminalLabel(run('cancelled'))).toBe('Run cancelled');
		expect(terminalLabel(run('failed'))).toBe('Run failed');
	});

	it('says a run malini closed on is paused, not cancelled', () => {
		const paused = { ...run('cancelled'), terminalText: PAUSED_FOR_EXIT_ERROR };
		expect(terminalLabel(paused)).toBe('Run paused');
	});
});
