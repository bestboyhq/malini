import type { AgentEvent } from './events';

export type PlanLimit = {
	readonly label: string;
	readonly usedPercent: number;
	readonly resetsAt: string | null;
};

export type PlanUsage = {
	readonly observedAt: string;
	readonly limits: readonly PlanLimit[];
};

export const PLAN_LIMIT_ALERT_PERCENT = 90;

export function planUsageOf(event: AgentEvent): PlanUsage | null {
	if (event.type !== 'usage.updated') return null;
	const anthropic = event.providerMetrics?.['anthropic'];
	if (!isRecord(anthropic)) return null;
	const { observedAt, rateLimits } = anthropic;
	if (typeof observedAt !== 'string' || !Array.isArray(rateLimits)) return null;
	return { observedAt, limits: rateLimits.flatMap(planLimitOf) };
}

export function newerPlanUsage(current: PlanUsage | null, next: PlanUsage): PlanUsage {
	return current && current.observedAt >= next.observedAt ? current : next;
}

export function currentPlanLimits(usage: PlanUsage | null, nowMs: number): readonly PlanLimit[] {
	return (usage?.limits ?? []).filter(
		(limit) => limit.resetsAt === null || Date.parse(limit.resetsAt) > nowMs,
	);
}

export function planLimitAlert(limits: readonly PlanLimit[]): PlanLimit | null {
	return limits.reduce<PlanLimit | null>(
		(highest, limit) =>
			limit.usedPercent >= PLAN_LIMIT_ALERT_PERCENT &&
			(!highest || limit.usedPercent > highest.usedPercent)
				? limit
				: highest,
		null,
	);
}

function planLimitOf(value: unknown): PlanLimit[] {
	if (!isRecord(value)) return [];
	const { label, utilization, resetsAt } = value;
	if (typeof label !== 'string' || typeof utilization !== 'number') return [];
	if (!Number.isFinite(utilization)) return [];
	const validReset = typeof resetsAt === 'string' && !Number.isNaN(Date.parse(resetsAt));
	return [
		{
			label,
			usedPercent: Math.min(100, Math.max(0, utilization)),
			resetsAt: validReset ? resetsAt : null,
		},
	];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
