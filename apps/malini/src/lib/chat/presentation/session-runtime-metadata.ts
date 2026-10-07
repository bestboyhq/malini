import type { EventEnvelope } from '$lib/chat/domain/events';
import { isContextHandoffContentId } from './render-state';

export type ContextUsageSnapshot = {
	usedTokens: number;
	maxTokens: number | null;
	rateLimits: { label: string; utilization: number | null; resetsAt: string | null }[];
};

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

export function deriveSessionRuntimeMetadata(
	envelopes: readonly EventEnvelope[],
	liveContext: LiveContextOverride | null = null,
): SessionRuntimeMetadata {
	let context: ContextUsageSnapshot | null = null;
	let mcpServers: McpServerSnapshot[] | null = null;
	const newestHandoffIndex = newestContextHandoffIndex(envelopes);

	for (const [index, envelope] of envelopes.entries()) {
		const event = envelope.event;
		if (event.type === 'usage.updated') {
			if (index < newestHandoffIndex) continue;
			const usedTokens = event.contextTokens;
			if (usedTokens !== undefined && Number.isFinite(usedTokens) && usedTokens >= 0) {
				context = {
					usedTokens,
					maxTokens: positiveTokenCount(event.contextWindowTokens),
					rateLimits: normalizeRateLimits(anthropicRateLimits(event.providerMetrics)),
				};
			}
		} else if (event.type === 'mcp.status') {
			mcpServers = event.servers.map((server) => {
				const status = normalizeMcpStatus(server.status);
				return {
					name: server.name,
					displayName: mcpServerDisplayName(server.name),
					status,
					usable: status === 'connected',
					error: server.error?.trim() || null,
				};
			});
		}
	}

	if (liveContext && Number.isFinite(liveContext.contextTokens) && liveContext.contextTokens >= 0) {
		context = {
			usedTokens: liveContext.contextTokens,
			maxTokens: positiveTokenCount(liveContext.contextWindowTokens ?? undefined),
			rateLimits: context?.rateLimits ?? [],
		};
	}

	return { context, mcpServers };
}

function newestContextHandoffIndex(envelopes: readonly EventEnvelope[]): number {
	for (let index = envelopes.length - 1; index >= 0; index -= 1) {
		const event = envelopes[index]?.event;
		if (event?.type === 'assistant.message' && isContextHandoffContentId(event.contentId)) {
			return index;
		}
	}
	return -1;
}

function positiveTokenCount(value: number | undefined): number | null {
	return value !== undefined && Number.isFinite(value) && value > 0 ? value : null;
}

const MCP_SERVER_DISPLAY_NAMES: Readonly<Record<string, string>> = {
	'claude.ai linear': 'Linear',
	'codebase-memory-mcp': 'Codebase Memory',
	codex_apps: 'Codex Apps',
	'computer-use': 'Computer Use',
	conductor: 'Conductor',
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
	const percent = contextUsagePercent(snapshot);
	if (percent === null) return 'ok';
	if (percent >= CONTEXT_PRESSURE_CRITICAL_PERCENT) return 'critical';
	if (percent >= CONTEXT_PRESSURE_HIGH_PERCENT) return 'high';
	return 'ok';
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

function normalizeRateLimits(
	limits: { label: string; utilization: number | null; resetsAt: string | null }[] | undefined,
): { label: string; utilization: number | null; resetsAt: string | null }[] {
	return (limits ?? []).map((limit) => ({
		label: limit.label,
		utilization:
			limit.utilization === null || !Number.isFinite(limit.utilization)
				? null
				: Math.min(100, Math.max(0, limit.utilization)),
		resetsAt: limit.resetsAt,
	}));
}

function anthropicRateLimits(
	providerMetrics: Record<string, unknown> | undefined,
): { label: string; utilization: number | null; resetsAt: string | null }[] | undefined {
	const anthropic = providerMetrics?.anthropic;
	if (!isRecord(anthropic)) return undefined;
	const rateLimits = anthropic.rateLimits;
	if (!Array.isArray(rateLimits)) return undefined;
	return rateLimits.filter(
		(value): value is { label: string; utilization: number | null; resetsAt: string | null } => {
			if (!isRecord(value)) return false;
			return (
				typeof value.label === 'string' &&
				(value.utilization === null || typeof value.utilization === 'number') &&
				(value.resetsAt === null || typeof value.resetsAt === 'string')
			);
		},
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
