import type { EventEnvelope } from '$lib/chat/domain/events';

export const CONTEXT_HANDOFF_CONTENT_ID_PREFIX = 'malini.context-handoff:';

export function isContextHandoffContentId(contentId: string | undefined): boolean {
	return contentId?.startsWith(CONTEXT_HANDOFF_CONTENT_ID_PREFIX) ?? false;
}

export type ContextCategory = {
	name: string;
	tokens: number;
	kind: 'used' | 'buffer' | 'free';
};

export type ContextUsageSnapshot = {
	usedTokens: number;
	maxTokens: number | null;
	categories: ContextCategory[];
};

export type ContextBreakdownRow = ContextCategory & { percent: number };

export type LiveContextOverride = {
	readonly contextTokens: number;
	readonly contextWindowTokens: number | null;
};

export type ContextPressure = 'ok' | 'high' | 'critical';

export const CONTEXT_PRESSURE_HIGH_PERCENT = 70;
export const CONTEXT_PRESSURE_CRITICAL_PERCENT = 90;

export type McpServerSnapshot = {
	name: string;
	displayName: string;
	status: 'connected' | 'pending' | 'failed' | 'needs-auth' | 'disabled';
	usable: boolean;
	error: string | null;
};

export type SessionRuntimeMetadata = {
	context: ContextUsageSnapshot | null;
	mcpServers: McpServerSnapshot[] | null;
};

export type RunTokenUsage = {
	inputTokens: number;
	outputTokens: number;
	costUsd: number | null;
};

export function lastRunUsage(envelopes: readonly EventEnvelope[]): RunTokenUsage | null {
	for (let index = envelopes.length - 1; index >= 0; index -= 1) {
		const event = envelopes[index]?.event;
		if (event?.type !== 'usage.updated' || event.interim === true) continue;
		return {
			inputTokens: event.inputTokens ?? 0,
			outputTokens: event.outputTokens ?? 0,
			costUsd: event.costUsd ?? null,
		};
	}
	return null;
}

export function formatRunUsage(usage: RunTokenUsage, showsCost: boolean): string {
	const tokens = `${usage.inputTokens.toLocaleString()} input · ${usage.outputTokens.toLocaleString()} output`;
	return showsCost && usage.costUsd !== null ? `${tokens} · $${usage.costUsd.toFixed(2)}` : tokens;
}

export const EMPTY_RUNTIME_METADATA: SessionRuntimeMetadata = Object.freeze({
	context: null,
	mcpServers: null,
});

export function foldRuntimeMetadata(
	metadata: SessionRuntimeMetadata,
	envelope: EventEnvelope,
): SessionRuntimeMetadata {
	const event = envelope.event;
	if (event.type === 'assistant.message' && isContextHandoffContentId(event.contentId)) {
		return metadata.context ? { ...metadata, context: null } : metadata;
	}
	if (event.type === 'usage.updated') {
		const usedTokens = event.contextTokens;
		if (usedTokens === undefined || !Number.isFinite(usedTokens) || usedTokens < 0) return metadata;
		return {
			...metadata,
			context: {
				usedTokens,
				maxTokens: positiveTokenCount(event.contextWindowTokens),
				categories:
					anthropicContextCategories(event.providerMetrics) ?? metadata.context?.categories ?? [],
			},
		};
	}
	if (event.type !== 'mcp.status') return metadata;
	return {
		...metadata,
		mcpServers: event.servers.map((server) => {
			const status = normalizeMcpStatus(server.status);
			return {
				name: server.name,
				displayName: mcpServerDisplayName(server.name),
				status,
				usable: status === 'connected',
				error: server.error?.trim() || null,
			};
		}),
	};
}

export function withLiveContext(
	metadata: SessionRuntimeMetadata,
	liveContext: LiveContextOverride | null,
): SessionRuntimeMetadata {
	if (
		!liveContext ||
		!Number.isFinite(liveContext.contextTokens) ||
		liveContext.contextTokens < 0
	) {
		return metadata;
	}
	return {
		...metadata,
		context: {
			usedTokens: liveContext.contextTokens,
			maxTokens: positiveTokenCount(liveContext.contextWindowTokens ?? undefined),
			categories: metadata.context?.categories ?? [],
		},
	};
}

export function deriveSessionRuntimeMetadata(
	envelopes: readonly EventEnvelope[],
	liveContext: LiveContextOverride | null = null,
): SessionRuntimeMetadata {
	let metadata = EMPTY_RUNTIME_METADATA;
	for (const envelope of envelopes) metadata = foldRuntimeMetadata(metadata, envelope);
	return withLiveContext(metadata, liveContext);
}

function positiveTokenCount(value: number | undefined): number | null {
	return value !== undefined && Number.isFinite(value) && value > 0 ? value : null;
}

const MCP_SERVER_DISPLAY_NAMES: Readonly<Record<string, string>> = {
	'claude.ai linear': 'Linear',
	'codebase-memory-mcp': 'Codebase Memory',
	'computer-use': 'Computer Use',
	github: 'GitHub',
	linear: 'Linear',
	node_repl: 'Node REPL',
	svelte: 'Svelte',
};

export function mcpServerDisplayName(serverId: string): string {
	const trimmed = serverId.trim().replace(/^plugin:[^:]+:/iu, '');
	const known = MCP_SERVER_DISPLAY_NAMES[trimmed.toLowerCase()];
	if (known) return known;
	const normalized = trimmed
		.replace(/^mcp[-_:./]+/iu, '')
		.replace(/[-_:./]+mcp$/iu, '')
		.replace(/[-_:./]+/gu, ' ')
		.trim();
	if (!normalized) return trimmed || 'MCP server';
	return normalized
		.split(/\s+/u)
		.map((token) => {
			const lower = token.toLowerCase();
			if (lower === 'mcp') return 'MCP';
			if (lower === 'repl') return 'REPL';
			if (lower === 'api') return 'API';
			return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
		})
		.join(' ');
}

function normalizeMcpStatus(value: string): McpServerSnapshot['status'] {
	if (
		value === 'connected' ||
		value === 'pending' ||
		value === 'needs-auth' ||
		value === 'disabled'
	) {
		return value;
	}
	return 'failed';
}

export function contextUsagePercent(snapshot: ContextUsageSnapshot): number | null {
	if (!snapshot.maxTokens) return null;
	return Math.min(100, Math.max(0, (snapshot.usedTokens / snapshot.maxTokens) * 100));
}

export function contextRemainingTokens(snapshot: ContextUsageSnapshot): number | null {
	if (!snapshot.maxTokens) return null;
	return Math.max(0, snapshot.maxTokens - snapshot.usedTokens);
}

export function contextPressure(snapshot: ContextUsageSnapshot): ContextPressure {
	return usagePressure(contextUsagePercent(snapshot));
}

export function usagePressure(percent: number | null): ContextPressure {
	if (percent === null) return 'ok';
	if (percent >= CONTEXT_PRESSURE_CRITICAL_PERCENT) return 'critical';
	if (percent >= CONTEXT_PRESSURE_HIGH_PERCENT) return 'high';
	return 'ok';
}

export function contextBreakdown(snapshot: ContextUsageSnapshot): ContextBreakdownRow[] {
	const max = snapshot.maxTokens;
	if (!max || snapshot.categories.length === 0) return [];
	const used = snapshot.categories.filter((category) => category.kind === 'used');
	const buffer = snapshot.categories.filter((category) => category.kind === 'buffer');
	const unreported = snapshot.usedTokens - sumTokens(used);
	const live = used.map((category) =>
		category.name === LIVE_GROWTH_CATEGORY
			? { ...category, tokens: Math.max(0, category.tokens + unreported) }
			: category,
	);
	const free: ContextCategory = {
		name: 'Free space',
		tokens: Math.max(0, max - snapshot.usedTokens - sumTokens(buffer)),
		kind: 'free',
	};
	return [...live.sort((left, right) => right.tokens - left.tokens), ...buffer, free]
		.filter((category) => category.tokens > 0)
		.map((category) => ({ ...category, percent: (category.tokens / max) * 100 }));
}

const LIVE_GROWTH_CATEGORY = 'Messages';

function sumTokens(categories: readonly ContextCategory[]): number {
	return categories.reduce((total, category) => total + category.tokens, 0);
}

export function contextPressureAdvice(snapshot: ContextUsageSnapshot): string | null {
	switch (contextPressure(snapshot)) {
		case 'critical':
			return 'Nearly full. The oldest turns stop being visible to the agent first, so start a new workstream to keep the whole history.';
		case 'high':
			return 'Filling up. Long runs from here will start dropping the earliest turns.';
		case 'ok':
			return null;
	}
}

export function contextUnavailableMessage(): string {
	return 'Context usage appears after the agent reports the first response.';
}

export function contextWindowUnknownMessage(): string {
	return 'No published window size for this model, so there is no percentage to show, only what has been used so far.';
}

export function mcpUnavailableMessage(): string {
	return 'MCP status appears after the agent starts the first response.';
}

function anthropicContextCategories(
	providerMetrics: Record<string, unknown> | undefined,
): ContextCategory[] | null {
	const anthropic = providerMetrics?.['anthropic'];
	if (!isRecord(anthropic) || !Array.isArray(anthropic['contextCategories'])) return null;
	return anthropic['contextCategories'].flatMap((value): ContextCategory[] => {
		if (!isRecord(value)) return [];
		const { name, tokens, kind } = value;
		if (typeof name !== 'string' || typeof tokens !== 'number' || !Number.isFinite(tokens)) {
			return [];
		}
		if (kind !== 'used' && kind !== 'buffer') return [];
		return [{ name, tokens: Math.max(0, tokens), kind }];
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
