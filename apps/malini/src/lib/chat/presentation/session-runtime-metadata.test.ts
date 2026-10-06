import { describe, expect, it } from 'vitest';
import type { EventEnvelope } from '$lib/chat/domain/events';
import {
	contextPressure,
	contextPressureAdvice,
	contextRemainingTokens,
	contextUnavailableMessage,
	contextUsagePercent,
	deriveSessionRuntimeMetadata,
	mcpUnavailableMessage,
	mcpServerDisplayName,
} from './session-runtime-metadata';
import { CONTEXT_HANDOFF_CONTENT_ID_PREFIX } from './render-state';

function envelope(seq: number, event: EventEnvelope['event']): EventEnvelope {
	return { sessionId: 'session-1', runId: 'run-1', seq, event };
}

describe('session runtime metadata', () => {
	it('keeps the latest exact context, rate-limit, and MCP snapshots without making chat items', () => {
		const metadata = deriveSessionRuntimeMetadata([
			envelope(1, {
				type: 'usage.updated',
				runId: 'run-1',
				inputTokens: 99_000,
				contextTokens: 97_600,
				contextWindowTokens: 258_400,
				providerMetrics: {
					anthropic: {
						rateLimits: [
							{
								label: '5h limit',
								utilization: 16,
								resetsAt: '2026-07-10T15:46:00.000Z',
							},
						],
					},
				},
			}),
			envelope(2, {
				type: 'mcp.status',
				runId: 'run-1',
				servers: [
					{ name: 'linear', status: 'connected' },
					{ name: 'computer-use', status: 'failed', error: 'handshake failed' },
				],
			}),
		]);

		expect(metadata.context).toEqual({
			usedTokens: 97_600,
			maxTokens: 258_400,
			rateLimits: [{ label: '5h limit', utilization: 16, resetsAt: '2026-07-10T15:46:00.000Z' }],
		});
		expect(contextUsagePercent(metadata.context!)).toBeCloseTo(37.77, 2);
		expect(metadata.mcpServers).toEqual([
			{ name: 'linear', displayName: 'Linear', status: 'connected', usable: true, error: null },
			{
				name: 'computer-use',
				displayName: 'Computer Use',
				status: 'failed',
				usable: false,
				error: 'handshake failed',
			},
		]);
	});

	it('never marks pending, auth-gated, disabled, failed, or unknown MCP states as usable', () => {
		const metadata = deriveSessionRuntimeMetadata([
			envelope(1, {
				type: 'mcp.status',
				runId: 'run-1',
				servers: [
					{ name: 'Linear', status: 'pending' },
					{ name: 'GitHub', status: 'needs-auth' },
					{ name: 'Disabled', status: 'disabled' },
					{ name: 'Broken', status: 'failed' },
					{ name: 'Future status', status: 'warming-up' },
				],
			}),
		]);

		expect(metadata.mcpServers).toEqual([
			{ name: 'Linear', displayName: 'Linear', status: 'pending', usable: false, error: null },
			{ name: 'GitHub', displayName: 'GitHub', status: 'needs-auth', usable: false, error: null },
			{ name: 'Disabled', displayName: 'Disabled', status: 'disabled', usable: false, error: null },
			{ name: 'Broken', displayName: 'Broken', status: 'failed', usable: false, error: null },
			{
				name: 'Future status',
				displayName: 'Future Status',
				status: 'failed',
				usable: false,
				error: null,
			},
		]);
	});

	it('turns raw plugin IDs into friendly labels without losing the original ID', () => {
		expect(mcpServerDisplayName('codebase-memory-mcp')).toBe('Codebase Memory');
		expect(mcpServerDisplayName('codex_apps')).toBe('Codex Apps');
		expect(mcpServerDisplayName('node_repl')).toBe('Node REPL');
		expect(mcpServerDisplayName('custom-weather-mcp')).toBe('Custom Weather');
		expect(mcpServerDisplayName('plugin:svelte:svelte')).toBe('Svelte');
	});

	it('never reads run input totals as context occupancy', () => {
		const metadata = deriveSessionRuntimeMetadata([
			envelope(1, { type: 'usage.updated', runId: 'run-1', inputTokens: 1_200_000 }),
		]);

		expect(metadata.context).toBeNull();
		expect(metadata.mcpServers).toBeNull();
	});

	it('never invents a context maximum when the model has no published window', () => {
		const metadata = deriveSessionRuntimeMetadata([
			envelope(1, { type: 'usage.updated', runId: 'run-1', contextTokens: 1200 }),
		]);

		expect(metadata.context).toEqual({ usedTokens: 1200, maxTokens: null, rateLimits: [] });
		expect(contextUsagePercent(metadata.context!)).toBeNull();
	});

	it('drops a context reading taken before the newest handoff and takes the one after it', () => {
		const stale = envelope(1, {
			type: 'usage.updated',
			runId: 'run-1',
			contextTokens: 190_000,
			contextWindowTokens: 200_000,
		});
		const handoff = envelope(2, {
			type: 'assistant.message',
			runId: 'run-1',
			contentId: `${CONTEXT_HANDOFF_CONTENT_ID_PREFIX}1`,
			text: 'Context handoff 1 of 10: this context is full.',
		});
		const fresh = envelope(3, {
			type: 'usage.updated',
			runId: 'run-1',
			contextTokens: 4_200,
			contextWindowTokens: 200_000,
		});

		expect(deriveSessionRuntimeMetadata([stale, handoff]).context).toBeNull();
		expect(deriveSessionRuntimeMetadata([stale, handoff, fresh]).context).toEqual({
			usedTokens: 4_200,
			maxTokens: 200_000,
			rateLimits: [],
		});
	});

	it('leaves the context reading alone for an ordinary assistant message', () => {
		const metadata = deriveSessionRuntimeMetadata([
			envelope(1, {
				type: 'usage.updated',
				runId: 'run-1',
				contextTokens: 12_000,
				contextWindowTokens: 200_000,
			}),
			envelope(2, {
				type: 'assistant.message',
				runId: 'run-1',
				contentId: 'answer-1',
				text: 'done',
			}),
		]);

		expect(metadata.context?.usedTokens).toBe(12_000);
	});

	it('prefers the live mid-run reading over the last persisted one', () => {
		const metadata = deriveSessionRuntimeMetadata(
			[
				envelope(1, {
					type: 'usage.updated',
					runId: 'run-1',
					contextTokens: 20_000,
					contextWindowTokens: 200_000,
				}),
			],
			{ contextTokens: 140_000, contextWindowTokens: 200_000 },
		);

		expect(metadata.context?.usedTokens).toBe(140_000);
		expect(contextUsagePercent(metadata.context!)).toBe(70);
	});

	it('keeps the persisted rate limits when a live reading takes over the occupancy', () => {
		const metadata = deriveSessionRuntimeMetadata(
			[
				envelope(1, {
					type: 'usage.updated',
					runId: 'run-1',
					contextTokens: 10_000,
					contextWindowTokens: 200_000,
					providerMetrics: {
						anthropic: {
							rateLimits: [{ label: '5h limit', utilization: 16, resetsAt: null }],
						},
					},
				}),
			],
			{ contextTokens: 12_000, contextWindowTokens: 200_000 },
		);

		expect(metadata.context?.rateLimits).toEqual([
			{ label: '5h limit', utilization: 16, resetsAt: null },
		]);
	});

	it('reports what is left and names the action once the window fills', () => {
		const roomy = { usedTokens: 20_000, maxTokens: 200_000, rateLimits: [] };
		expect(contextRemainingTokens(roomy)).toBe(180_000);
		expect(contextPressure(roomy)).toBe('ok');
		expect(contextPressureAdvice(roomy)).toBeNull();

		const filling = { usedTokens: 150_000, maxTokens: 200_000, rateLimits: [] };
		expect(contextPressure(filling)).toBe('high');
		expect(contextPressureAdvice(filling)).toContain('dropping the earliest turns');

		const nearlyFull = { usedTokens: 190_000, maxTokens: 200_000, rateLimits: [] };
		expect(contextPressure(nearlyFull)).toBe('critical');
		expect(contextPressureAdvice(nearlyFull)).toContain('new workstream');
	});

	it('stays calm rather than alarming when the window size is unknown', () => {
		const unknown = { usedTokens: 900_000, maxTokens: null, rateLimits: [] };
		expect(contextPressure(unknown)).toBe('ok');
		expect(contextPressureAdvice(unknown)).toBeNull();
		expect(contextRemainingTokens(unknown)).toBeNull();
	});

	it('describes unavailable runtime metadata in the words of the agent', () => {
		expect(contextUnavailableMessage()).toBe(
			'Context usage appears after the agent reports the first response.',
		);
		expect(mcpUnavailableMessage()).toBe(
			'MCP status appears after the agent starts the first response.',
		);
	});
});
