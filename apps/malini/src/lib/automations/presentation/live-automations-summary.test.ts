import { describe, expect, it } from 'vitest';
import type { AutomationRunStatus, ReconcilerDecisionRecord } from '$contract/automations';
import { liveAutomationsSummary, automationQuestionReason } from './live-automations-summary';

function entry(status: AutomationRunStatus, channel: string | null = null) {
	const question: ReconcilerDecisionRecord | null =
		channel === null
			? null
			: {
					id: 'decision',
					eventId: 1,
					channel,
					chainId: 'chain',
					workstreamId: 'ws-1',
					facts: [],
					candidates: [],
					pick: null,
					chosen: 0,
					decidedBy: 'model',
					status: 'asking',
					detail: null,
					automationRunId: null,
					subjectRunId: 'run',
					createdAt: '2026-11-01T09:00:00.000Z',
					finishedAt: null,
				};
	return {
		key: 'entry',
		workstreamId: 'ws-1',
		question,
		run: {
			id: 'run',
			definitionId: 'automation',
			title: 'Update from main',
			workstreamId: 'ws-1',
			repositoryId: null,
			sessionId: null,
			agentRunId: null,
			origin: 'manual' as const,
			status,
			interrupted: false,
			detail: null,
			parentRunId: null,
			chatSessionId: null,
			chatAfterRunId: null,
			chainId: 'chain',
			requests: 1,
			createdAt: '2026-11-01T09:00:00.000Z',
			startedAt: null,
			finishedAt: null,
		},
	};
}

describe('the live automations summary', () => {
	it('counts what runs, waits in the queue and needs you', () => {
		expect(liveAutomationsSummary({ running: 2, queued: 1, needsYou: 1 })).toBe(
			'2 running, 1 queued, 1 needs you',
		);
		expect(liveAutomationsSummary({ running: 0, queued: 0, needsYou: 2 })).toBe('2 need you');
		expect(liveAutomationsSummary({ running: 0, queued: 0, needsYou: 0 })).toBe('');
	});

	it('names why an automation needs you in a few words', () => {
		expect(automationQuestionReason(entry('failed', 'automations:run-finished'))).toBe('Failed');
		expect(
			automationQuestionReason(entry('succeeded', 'repositories:workstream-merge-conflicted')),
		).toBe('Conflicts');
		expect(automationQuestionReason(entry('waiting'))).toBe('Wants to run');
		expect(automationQuestionReason(entry('needs-you'))).toBe('Asks you');
	});
});
