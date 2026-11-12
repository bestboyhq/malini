import { describe, expect, it } from 'vitest';
import { progressDot, standingLabel, type ProgressInput } from './started-progress';

const idle: ProgressInput = {
	merged: false,
	pullRequest: 'none',
	needsYou: false,
	chatTone: null,
	busy: false,
	broken: false,
};

describe('started progress', () => {
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
			'blocked',
			'needs',
			'failed',
			'failed',
			'running',
			'running',
			'idle',
		]);
	});

	it('names where each workstream stands', () => {
		expect([
			standingLabel('blocked', 'needs-you'),
			standingLabel('needs', 'none'),
			standingLabel('merged', 'none'),
			standingLabel('running', 'queued'),
			standingLabel('running', 'none'),
			standingLabel('idle', 'open'),
			standingLabel('idle', 'draft'),
			standingLabel('idle', 'none'),
		]).toEqual([
			'Needs you',
			'Needs you',
			'Merged',
			'Merging',
			'Working',
			'In review',
			'Draft',
			'Waiting',
		]);
	});
});
