import { describe, expect, it } from 'vitest';
import type { AgentBackgroundTask } from '$contract/agent';
import {
	backgroundTaskElapsed,
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
