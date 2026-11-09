import type { AgentPlanLimit, AgentPlanUsage } from '$contract/agent';

export type UsageFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface UsageProbe {
	readonly apiKey: string;
	readonly origin: string;
	readonly fetch: UsageFetch;
}

const USAGE_TIMEOUT_MS = 10_000;

const GO_WINDOWS: readonly (readonly [string, string])[] = [
	['rolling', '5-hour limit'],
	['weekly', 'Weekly limit'],
	['monthly', 'Monthly limit'],
];

export async function loadOpencodeUsage(probe: UsageProbe): Promise<AgentPlanUsage | null> {
	try {
		const response = await probe.fetch(`${probe.origin}/zen/go/v1/usage`, {
			headers: { accept: 'application/json', authorization: `Bearer ${probe.apiKey}` },
			signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
		});
		if (!response.ok) {
			response.body?.cancel().catch(() => undefined);
			return null;
		}
		const body: unknown = await response.json().catch(() => null);
		const usage = limitsOf(body);
		return usage === null ? null : { observedAt: new Date().toISOString(), limits: usage };
	} catch {
		return null;
	}
}

function limitsOf(body: unknown): readonly AgentPlanLimit[] | null {
	if (!isRecord(body) || !('usage' in body)) return null;
	const usage = body.usage;
	if (!isRecord(usage)) return null;
	const limits = GO_WINDOWS.flatMap(([window, label]) => {
		const meter = usage[window];
		if (!isMeter(meter)) return [];
		return [
			{
				label,
				usedPercent: Math.min(100, Math.max(0, meter.percent)),
				resetsAt: resetOf(meter.resetsAt),
			},
		];
	});
	return limits.length > 0 ? limits : null;
}

function isMeter(value: unknown): value is { percent: number; resetsAt: unknown } {
	if (!isRecord(value)) return false;
	const { percent } = value;
	return typeof percent === 'number' && Number.isFinite(percent);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resetOf(resetsAt: unknown): string | null {
	return typeof resetsAt === 'string' && !Number.isNaN(Date.parse(resetsAt)) ? resetsAt : null;
}
