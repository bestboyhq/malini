import { describe, expect, it } from 'vitest';
import {
	currentPlanLimits,
	newerPlanUsage,
	planLimitAlert,
	planUsageOf,
	type PlanUsage,
} from './plan-usage';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');

function reported(observedAt: string, rateLimits: unknown[]): PlanUsage | null {
	return planUsageOf({
		type: 'usage.updated',
		runId: 'run-1',
		providerMetrics: { anthropic: { observedAt, rateLimits } },
	});
}

describe('plan usage', () => {
	it('reads what the agent reported and skips limits it could not measure', () => {
		expect(
			reported('2026-10-12T11:00:00.000Z', [
				{ label: '5-hour limit', utilization: 104, resetsAt: '2026-10-12T13:50:00.000Z' },
				{ label: 'Weekly limit', utilization: null, resetsAt: '2026-10-15T06:00:00.000Z' },
				{ label: 'Weekly Fable limit', utilization: 12, resetsAt: 'soon' },
			]),
		).toEqual({
			observedAt: '2026-10-12T11:00:00.000Z',
			limits: [
				{ label: '5-hour limit', usedPercent: 100, resetsAt: '2026-10-12T13:50:00.000Z' },
				{ label: 'Weekly Fable limit', usedPercent: 12, resetsAt: null },
			],
		});
		expect(planUsageOf({ type: 'usage.updated', runId: 'run-1', contextTokens: 5 })).toBeNull();
	});

	it('keeps the newest reading whichever chat reported it', () => {
		const older = reported('2026-10-12T10:00:00.000Z', []);
		const newer = reported('2026-10-12T11:00:00.000Z', []);
		if (!older || !newer) throw new Error('readings did not parse');
		expect(newerPlanUsage(older, newer)).toBe(newer);
		expect(newerPlanUsage(newer, older)).toBe(newer);
		expect(newerPlanUsage(null, older)).toBe(older);
	});

	it('forgets a window once it resets and alerts only on the fullest one past 90%', () => {
		const usage = reported('2026-10-12T11:00:00.000Z', [
			{ label: 'Expired', utilization: 99, resetsAt: '2026-10-12T11:30:00.000Z' },
			{ label: '5-hour limit', utilization: 91, resetsAt: '2026-10-12T13:50:00.000Z' },
			{ label: 'Weekly limit', utilization: 95, resetsAt: '2026-10-15T06:00:00.000Z' },
			{ label: 'Weekly Opus limit', utilization: 89, resetsAt: null },
		]);
		const limits = currentPlanLimits(usage, NOW);

		expect(limits.map((limit) => limit.label)).toEqual([
			'5-hour limit',
			'Weekly limit',
			'Weekly Opus limit',
		]);
		expect(planLimitAlert(limits)?.label).toBe('Weekly limit');
		expect(planLimitAlert(limits.filter((limit) => limit.usedPercent < 90))).toBeNull();
	});
});
