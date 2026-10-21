export type UsageSnapshot = {
	inputTokens: number | null;
	outputTokens: number | null;
};

export function formatRunSeconds(ms: number): string {
	const total = Number.isFinite(ms) ? Math.max(0, ms) : 0;
	return `${Math.floor(total / 60_000)}m, ${Math.floor((total % 60_000) / 1_000)}`;
}

export function tenthsPhaseDelayMs(startedAtMs: number, timelineOriginMs: number): number {
	return -((((timelineOriginMs - startedAtMs) % 1_000) + 1_000) % 1_000);
}

export function deriveTokenTicker(usage: UsageSnapshot | null): string | null {
	if (!usage) return null;
	const total = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
	if (total <= 0) return null;
	return `${formatTokenCount(total)} tokens`;
}

export function formatTokenCount(count: number): string {
	if (count >= 1_000) {
		const value = count / 1_000;
		return `${value.toFixed(value < 10 ? 1 : 0)}k`;
	}
	return `${count}`;
}
