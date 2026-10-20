import { describe, expect, it } from 'vitest';
import type { AgentBackgroundTask } from '$contract/agent';
import {
	backgroundTaskElapsed,
	backgroundWaitOf,
	backgroundWorkSummary,
	latestBackgroundWork,
} from './background-work';
import type { AgentEvent, EventEnvelope } from './events';

const E2E: AgentBackgroundTask = {
	taskId: 'b1',
	kind: 'command',
	description: 'e2e',
	startedAt: 0,
};
const REVIEW: AgentBackgroundTask = {
	taskId: 'a1',
	kind: 'agent',
	description: 'review',
	startedAt: 0,
};

function envelopes(...events: AgentEvent[]): EventEnvelope[] {
	return events.map((event, index) => {
		const runId = 'runId' in event ? event.runId : '';
		return { sessionId: 's', runId, seq: index + 1, event: { ...event, runId: '' } };
	});
}

describe('latestBackgroundWork', () => {
	it('shows the background work of the open run, with live output on top', () => {
		const transcript = envelopes(
			{ type: 'run.started', runId: 'r1', sessionId: 's' },
			{ type: 'background.updated', runId: 'r1', waiting: true, tasks: [E2E] },
		);
		const live = { runId: 'r1', waiting: true, tasks: [{ ...E2E, detail: '12 passed' }] };

		expect(latestBackgroundWork(transcript, null)).toEqual({
			runId: 'r1',
			waiting: true,
			tasks: [E2E],
		});
		expect(latestBackgroundWork(transcript, live)?.tasks[0]?.detail).toBe('12 passed');
		expect(latestBackgroundWork(transcript, { ...live, runId: 'r0' })?.tasks).toEqual([E2E]);
	});

	it('shows nothing once the run ends or its tasks are done', () => {
		const ended = envelopes(
			{ type: 'background.updated', runId: 'r1', waiting: true, tasks: [E2E] },
			{ type: 'run.completed', runId: 'r1', summary: 'done' },
		);
		const settled = envelopes(
			{ type: 'background.updated', runId: 'r1', waiting: true, tasks: [E2E] },
			{ type: 'background.updated', runId: 'r1', waiting: false, tasks: [] },
		);

		expect(latestBackgroundWork(ended, null)).toBeNull();
		expect(latestBackgroundWork(settled, null)).toBeNull();
		expect(latestBackgroundWork([], null)).toBeNull();
	});

	it('follows the tasks into the run a prompt handed them to', () => {
		const transcript = envelopes(
			{ type: 'background.updated', runId: 'r1', waiting: true, tasks: [E2E] },
			{ type: 'background.updated', runId: 'r1', waiting: false, tasks: [] },
			{ type: 'run.completed', runId: 'r1', summary: 'launched' },
			{ type: 'run.started', runId: 'r2', sessionId: 's' },
			{ type: 'background.updated', runId: 'r2', waiting: false, tasks: [E2E] },
		);

		expect(latestBackgroundWork(transcript, null)).toEqual({
			runId: 'r2',
			waiting: false,
			tasks: [E2E],
		});
	});

	it('keeps the tasks on screen through every step of a hand-off to the next prompt', () => {
		const endings = [
			{ type: 'run.completed', runId: 'r1', summary: 'launched', handedOff: true },
			{ type: 'run.failed', runId: 'r1', error: 'cancelled', handedOff: true },
		] satisfies AgentEvent[];
		for (const ending of endings) {
			const handOff: AgentEvent[] = [
				{ type: 'background.updated', runId: 'r1', waiting: true, tasks: [E2E] },
				{ type: 'background.updated', runId: 'r1', waiting: false, tasks: [], handedOff: true },
				ending,
				{ type: 'run.started', runId: 'r2', sessionId: 's' },
				{ type: 'background.updated', runId: 'r2', waiting: false, tasks: [E2E] },
			];
			for (let delivered = 1; delivered <= handOff.length; delivered += 1) {
				expect(latestBackgroundWork(envelopes(...handOff.slice(0, delivered)), null)).toMatchObject(
					{ waiting: delivered === 1, tasks: [E2E] },
				);
			}
			const settled: AgentEvent = {
				type: 'background.updated',
				runId: 'r2',
				waiting: false,
				tasks: [],
			};
			const done: AgentEvent = { type: 'run.completed', runId: 'r2', summary: 'done' };
			expect(latestBackgroundWork(envelopes(...handOff, settled), null)).toBeNull();
			expect(latestBackgroundWork(envelopes(...handOff, done), null)).toBeNull();
		}
	});

	it('ends the tasks with a run cancelled without handing them on', () => {
		const cancelled = envelopes(
			{ type: 'background.updated', runId: 'r1', waiting: false, tasks: [E2E] },
			{ type: 'run.failed', runId: 'r1', error: 'cancelled' },
		);

		expect(latestBackgroundWork(cancelled, null)).toBeNull();
	});
});

describe('backgroundWaitOf', () => {
	it('tells a run that only waits on commands from one whose agent still works', () => {
		const SCAN = { ...E2E, taskId: 't1', kind: 'task' } as const;
		expect(backgroundWaitOf({ waiting: true, tasks: [E2E, E2E] })).toBe('commands');
		expect(backgroundWaitOf({ waiting: true, tasks: [E2E, REVIEW] })).toBe('agents');
		expect(backgroundWaitOf({ waiting: true, tasks: [SCAN] })).toBe('agents');
		expect(backgroundWaitOf({ waiting: false, tasks: [E2E] })).toBeNull();
		expect(backgroundWaitOf({ waiting: true, tasks: [] })).toBeNull();
		expect(backgroundWaitOf(null)).toBeNull();
	});
});

describe('backgroundWorkSummary', () => {
	it('names the kind when every task shares it and counts them', () => {
		expect(backgroundWorkSummary([E2E])).toBe('1 background command');
		expect(backgroundWorkSummary([REVIEW, REVIEW])).toBe('2 background agents');
		expect(backgroundWorkSummary([E2E, REVIEW])).toBe('2 background tasks');
	});
});

describe('backgroundTaskElapsed', () => {
	it('reads seconds, then minutes, then hours', () => {
		expect(backgroundTaskElapsed(0, 42_000)).toBe('42s');
		expect(backgroundTaskElapsed(0, 5 * 60_000 + 10_000)).toBe('5m');
		expect(backgroundTaskElapsed(0, 125 * 60_000)).toBe('2h 5m');
	});
});
