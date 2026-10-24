import { describe, expect, it } from 'vitest';
import { progressDot, progressLabel, type ProgressInput } from './lead-progress';

const idle: ProgressInput = {
	merged: false,
	pullRequest: 'none',
	needsYou: false,
	chatTone: null,
	busy: false,
	broken: false,
};

describe('lead progress', () => {
	it('shows each workstream as its most pressing state', () => {
		const inputs: ProgressInput[] = [
			{ ...idle, merged: true, needsYou: true },
			{ ...idle, pullRequest: 'merged' },
			{ ...idle, pullRequest: 'needs-you', busy: true },
			{ ...idle, needsYou: true },
			{ ...idle, chatTone: 'failed' },
			{ ...idle, broken: true, busy: true },
			{ ...idle, busy: true },
			{ ...idle, pullRequest: 'queued' },
			{ ...idle, pullRequest: 'draft' },
		];
		expect(inputs.map(progressDot)).toEqual([
			'merged',
			'merged',
			'needs',
			'needs',
			'failed',
			'failed',
			'running',
			'running',
			'idle',
		]);
	});

	it('names how the work goes in one line', () => {
		expect(progressLabel(['merged', 'merged', 'needs'])).toBe(
			'3 workstreams: 2 merged, 1 needs you',
		);
		expect(progressLabel(['running'])).toBe('1 workstream: 1 working');
		expect(progressLabel([])).toBe('0 workstreams');
	});
});
