export type DeriveRunStatusInput = {
	isRunOpen: boolean;
	runStartedAtMs?: number | null;
	nowMs: number;
};

export type DeriveRunStatusResult = {
	text: string | null;
};

export type UsageSnapshot = {
	inputTokens: number | null;
	outputTokens: number | null;
};

export function deriveRunStatus(input: DeriveRunStatusInput): DeriveRunStatusResult {
	if (!input.isRunOpen) {
		return { text: null };
	}
	return { text: formatRunElapsed(input.nowMs - (input.runStartedAtMs ?? input.nowMs)) };
}

export function formatRunElapsed(ms: number): string {
	const total = Number.isFinite(ms) ? Math.max(0, ms) : 0;
	const minutes = Math.floor(total / 60_000);
	const seconds = (total % 60_000) / 1_000;
	return `${minutes}m, ${seconds.toFixed(1)}s`;
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
