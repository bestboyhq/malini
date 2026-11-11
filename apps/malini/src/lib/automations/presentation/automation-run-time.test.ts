import { describe, expect, it } from 'vitest';
import type { AutomationRunRecord } from '$contract/automations';
import { automationRunTime } from './automation-run-time';

const NOW = Date.parse('2026-10-11T12:00:00.000Z');

function run(patch: Partial<AutomationRunRecord>): AutomationRunRecord {
	return {
		id: 'run-1',
		definitionId: 'automation-1',
		title: 'Fix checks',
		workstreamId: 'ws-1',
		repositoryId: null,
		sessionId: null,
		agentRunId: null,
		origin: 'manual',
		status: 'queued',
		interrupted: false,
		detail: null,
		parentRunId: null,
		chatSessionId: null,
		chatAfterRunId: null,
		chainId: 'run-1',
		requests: 1,
		createdAt: '2026-10-11T11:00:00.000Z',
		startedAt: null,
		finishedAt: null,
		...patch,
	};
}

function secondsBefore(seconds: number): string {
	return new Date(NOW - seconds * 1_000).toISOString();
}

describe('the time an automation row shows', () => {
	it('counts up while the automation runs', () => {
		expect(automationRunTime(run({ status: 'running', startedAt: secondsBefore(42) }), NOW)).toBe(
			'42s',
		);
		expect(automationRunTime(run({ status: 'running', startedAt: secondsBefore(130) }), NOW)).toBe(
			'2m 10s',
		);
		expect(
			automationRunTime(run({ status: 'running', startedAt: secondsBefore(3_900) }), NOW),
		).toBe('1h 5m');
	});

	it('says how long ago a finished automation ended', () => {
		expect(
			automationRunTime(run({ status: 'succeeded', finishedAt: secondsBefore(10) }), NOW),
		).toBe('just now');
		expect(automationRunTime(run({ status: 'failed', finishedAt: secondsBefore(240) }), NOW)).toBe(
			'4m ago',
		);
		expect(
			automationRunTime(run({ status: 'cancelled', finishedAt: secondsBefore(7_300) }), NOW),
		).toBe('2h ago');
	});

	it('dates a queued automation from when it was queued', () => {
		expect(automationRunTime(run({ status: 'queued', createdAt: secondsBefore(60) }), NOW)).toBe(
			'1m ago',
		);
	});

	it('never shows a negative time when the clock lags the event', () => {
		expect(automationRunTime(run({ status: 'running', startedAt: secondsBefore(-5) }), NOW)).toBe(
			'0s',
		);
		expect(
			automationRunTime(run({ status: 'succeeded', finishedAt: secondsBefore(-5) }), NOW),
		).toBe('just now');
	});
});
