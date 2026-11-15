import { describe, expect, it } from 'vitest';
import {
	CONTINUE_AFTER_PAUSE_PROMPT,
	CONTINUE_AFTER_STOP_PROMPT,
} from '$contract/agent-state-machine';
import type { RunGroup } from '../render-state';
import { transcriptTurns } from './transcript-turns';

function run(runId: string, prompt: string, superseded = false): RunGroup {
	return {
		runId,
		items: [{ kind: 'user', key: `${runId}-prompt`, seq: 0, text: prompt }],
		terminal: null,
		terminalText: '',
		failure: null,
		resumeAt: null,
		turnEnded: false,
		answeredReports: [],
		superseded,
		obsoleted: false,
	};
}

function shape(runs: readonly RunGroup[]): string[][] {
	return transcriptTurns(runs).map((turn) => [
		turn.lead.run.runId,
		...turn.continuations.map(({ run }) => run.runId),
	]);
}

describe('transcriptTurns', () => {
	it('keeps restart and outage continuations in the turn they continue', () => {
		const runs = [
			run('a', 'Fix the sidebar'),
			run('b', CONTINUE_AFTER_PAUSE_PROMPT),
			run('c', CONTINUE_AFTER_STOP_PROMPT),
			run('d', 'Now the footer'),
		];
		expect(shape(runs)).toEqual([['a', 'b', 'c'], ['d']]);
		expect(transcriptTurns(runs)[1]?.lead.index).toBe(3);
	});

	it('starts a turn with a continuation that has nothing to continue', () => {
		expect(shape([run('a', CONTINUE_AFTER_PAUSE_PROMPT)])).toEqual([['a']]);
	});

	it('keeps an undone continuation apart from a kept run', () => {
		expect(shape([run('a', 'Fix it'), run('b', CONTINUE_AFTER_PAUSE_PROMPT, true)])).toEqual([
			['a'],
			['b'],
		]);
	});
});
