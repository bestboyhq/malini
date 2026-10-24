import { describe, expect, it } from 'vitest';
import {
	leadHeadline,
	progressDot,
	progressLabel,
	standingLabel,
	type ProgressInput,
} from './lead-progress';

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

	it('heads a lead chat with what merged and what needs the user', () => {
		expect(leadHeadline([])).toEqual({
			tone: 'idle',
			busy: false,
			label: 'No workstreams yet',
			detail: null,
		});
		expect(leadHeadline(['merged', 'needs', 'running'])).toEqual({
			tone: 'needs-you',
			busy: true,
			label: '1 of 3 merged',
			detail: '1 needs you · 1 working',
		});
		expect(leadHeadline(['merged', 'merged'])).toMatchObject({ tone: 'merged', detail: null });
		expect(leadHeadline(['idle', 'running'])).toMatchObject({ tone: 'idle', busy: true });
	});

	it('names where each workstream stands', () => {
		expect([
			standingLabel('merged', 'none'),
			standingLabel('running', 'queued'),
			standingLabel('running', 'none'),
			standingLabel('idle', 'open'),
			standingLabel('idle', 'draft'),
			standingLabel('idle', 'none'),
		]).toEqual(['Merged', 'Merging', 'Working', 'In review', 'Draft', 'Waiting']);
	});
});
