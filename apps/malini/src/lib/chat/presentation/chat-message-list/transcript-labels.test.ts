import { describe, expect, it } from 'vitest';
import type { RenderItem, RunGroup } from '../render-state';
import { formatUsage, terminalLabel, thinkingPreview, thoughtLabel } from './transcript-labels';

function usage(fields: Partial<Extract<RenderItem, { kind: 'usage' }>>): RenderItem {
	return {
		kind: 'usage',
		key: 'u1',
		seq: 1,
		inputTokens: null,
		outputTokens: null,
		costUsd: null,
		...fields,
	};
}

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
});

describe('run token usage', () => {
	it('reads out both directions with thousands separators', () => {
		expect(formatUsage(usage({ inputTokens: 12345, outputTokens: 678 }), false)).toBe(
			'12,345 input · 678 output',
		);
	});

	it('adds the cost only where the reader is actually billed per run', () => {
		const item = usage({ inputTokens: 1, outputTokens: 2, costUsd: 0.5 });
		expect(formatUsage(item, true)).toContain('$0.50');
		expect(formatUsage(item, false)).not.toContain('$');
	});

	it('omits the cost when the provider reported none', () => {
		expect(formatUsage(usage({ inputTokens: 1, outputTokens: 2 }), true)).not.toContain('$');
	});

	it('has nothing to say about an item that is not a usage row', () => {
		expect(formatUsage({ kind: 'plan', key: 'p', seq: 1, text: 'x' }, true)).toBe('');
	});
});
