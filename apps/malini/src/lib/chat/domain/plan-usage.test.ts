import { describe, expect, it } from 'vitest';
import {
	currentPlanLimits,
	planLimitAlert,
	planUsageFor,
	planUsageOf,
	withNewerPlanUsage,
	type PlanUsage,
} from './plan-usage';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');

function reported(observedAt: string, rateLimits: unknown[], account?: string): PlanUsage | null {
	return planUsageOf({
		type: 'usage.updated',
		runId: 'run-1',
		providerMetrics: { anthropic: { observedAt, rateLimits, account } },
	});
}

describe('plan usage', () => {
	it('reads what the agent reported and skips limits it could not measure', () => {
		expect(
			reported(
				'2026-10-12T11:00:00.000Z',
				[
					{ label: '5-hour limit', utilization: 104, resetsAt: '2026-10-12T13:50:00.000Z' },
					{ label: 'Weekly limit', utilization: null, resetsAt: '2026-10-15T06:00:00.000Z' },
					{ label: 'Weekly Fable limit', utilization: 12, resetsAt: 'soon' },
				],
				'ada@example.com',
			),
		).toEqual({
			observedAt: '2026-10-12T11:00:00.000Z',
			account: 'ada@example.com',
			limits: [
				{ label: '5-hour limit', usedPercent: 100, resetsAt: '2026-10-12T13:50:00.000Z' },
				{ label: 'Weekly Fable limit', usedPercent: 12, resetsAt: null },
			],
		});
		expect(reported('2026-10-12T11:00:00.000Z', [])?.account).toBeNull();
		expect(planUsageOf({ type: 'usage.updated', runId: 'run-1', contextTokens: 5 })).toBeNull();
	});

	it('keeps the newest reading per account and shows only the signed-in account its own', () => {
		const older = reported('2026-10-12T10:00:00.000Z', [], 'ada@example.com');
		const newer = reported('2026-10-12T11:00:00.000Z', [], 'ada@example.com');
		const work = reported('2026-10-12T09:00:00.000Z', [], 'ada@work.example');
		const unattributed = reported('2026-10-12T12:00:00.000Z', []);
		if (!older || !newer || !work || !unattributed) throw new Error('readings did not parse');

		const byAccount = [newer, older, work, unattributed].reduce(withNewerPlanUsage, {});

		expect(planUsageFor(byAccount, 'ada@example.com')).toBe(newer);
		expect(planUsageFor(byAccount, 'ada@work.example')).toBe(work);
		expect(planUsageFor(byAccount, 'bob@example.com')).toBeNull();
		expect(planUsageFor(byAccount, null)).toBe(unattributed);
		expect(withNewerPlanUsage(byAccount, older)).toBe(byAccount);
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
