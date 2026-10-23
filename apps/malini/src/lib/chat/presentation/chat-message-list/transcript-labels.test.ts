import { describe, expect, it } from 'vitest';
import { PAUSED_FOR_EXIT_ERROR } from '$contract/agent-state-machine';
import type { RunGroup } from '../render-state';
import {
	terminalLabel,
	thinkingOutcome,
	thinkingSteps,
	thinkingTicker,
	thoughtLabel,
} from './transcript-labels';

function run(terminal: RunGroup['terminal']): RunGroup {
	return {
		runId: 'r1',
		items: [],
		terminal,
		terminalText: '',
		turnEnded: terminal === 'completed',
		superseded: false,
		obsoleted: false,
	};
}

const THOUGHT =
	'The user wants the tooltip fixed. It sticks after the gallery closes.\n\n' +
	'Focus returns to the chip, and **focusin** opens the card.\n\n' +
	'I will gate it on `:focus-visible` in HoverCard.\n\n';

describe('a thought read as steps', () => {
	it('splits on paragraphs and drops the trailing break every summary ends with', () => {
		expect(thinkingSteps(THOUGHT)).toEqual([
			'The user wants the tooltip fixed. It sticks after the gallery closes.',
			'Focus returns to the chip, and **focusin** opens the card.',
			'I will gate it on `:focus-visible` in HoverCard.',
		]);
	});

	it('ticks to the sentence being written, numbered so a new one flips in', () => {
		expect(thinkingTicker('The user wants it fixed. It sticks')).toEqual({
			key: 2,
			line: 'It sticks',
		});
		expect(thinkingTicker(THOUGHT)).toEqual({
			key: 4,
			line: 'I will gate it on :focus-visible in HoverCard.',
		});
		expect(thinkingTicker('')).toEqual({ key: 0, line: '' });
	});

	it('names the last step as the outcome, without markdown marks', () => {
		expect(thinkingOutcome(THOUGHT)).toBe('I will gate it on :focus-visible in HoverCard.');
		expect(thinkingOutcome('Focus returns to the **chip**.')).toBe('Focus returns to the chip.');
	});
});

describe('how long a thought took', () => {
	it('names the duration once there is a whole second to name', () => {
		expect(thoughtLabel(4)).toBe('Thought for 4s');
		expect(thoughtLabel(4.6)).toBe('Thought for 5s');
	});

	it('says nothing precise about a sub-second thought', () => {
		expect(thoughtLabel(0.4)).toBe('Thought briefly');
	});

	it('claims no length for a thought whose duration was not measured', () => {
		expect(thoughtLabel(null)).toBe('Thought');
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
