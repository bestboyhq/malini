import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EphemeralEnvelope } from '$lib/chat/domain/ephemeral-envelope';
import { LIVE_TOOL_INPUT_CAPTURE_CHARS, streamingStore } from './streaming.store.svelte';

function ephemeral(
	sessionId: string,
	runId: string,
	event: EphemeralEnvelope['event'],
): EphemeralEnvelope {
	return { sessionId, runId, seq: -1, ephemeral: true, event };
}

describe('streamingStore', () => {
	beforeEach(() => {
		streamingStore.reset();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('applyEphemeral', () => {
		it('grows an assistant block by appending successive delta chunks', () => {
			streamingStore.applyEphemeral(
				ephemeral('s1', 'r1', {
					type: 'assistant.delta',
					runId: 'r1',
					contentId: 'b1',
					text: 'Hel',
				}),
			);
			expect(streamingStore.blocksFor('s1')).toEqual([
				expect.objectContaining({
					contentId: 'b1',
					kind: 'assistant',
					text: 'Hel',
					latestChunkLength: 3,
					revision: 1,
				}),
			]);

			streamingStore.applyEphemeral(
				ephemeral('s1', 'r1', {
					type: 'assistant.delta',
					runId: 'r1',
					contentId: 'b1',
					text: 'lo ',
				}),
			);
			expect(streamingStore.blocksFor('s1')[0]?.text).toBe('Hello ');
			expect(streamingStore.blocksFor('s1')[0]).toMatchObject({
				latestChunkLength: 3,
				revision: 2,
			});

			streamingStore.applyEphemeral(
				ephemeral('s1', 'r1', {
					type: 'assistant.delta',
					runId: 'r1',
					contentId: 'b1',
					text: 'world',
				}),
			);
			expect(streamingStore.blocksFor('s1')[0]?.text).toBe('Hello world');
			expect(streamingStore.blocksFor('s1')[0]).toMatchObject({
				latestChunkLength: 5,
				revision: 3,
			});
			expect(streamingStore.blocksFor('s1')).toHaveLength(1);
		});

		it('grows a thinking block independently of an assistant block in the same run', () => {
			streamingStore.applyEphemeral(
				ephemeral('s1', 'r1', {
					type: 'thinking.delta',
					runId: 'r1',
					contentId: 'think-1',
					text: 'Considering',
				}),
			);
			streamingStore.applyEphemeral(
				ephemeral('s1', 'r1', {
					type: 'assistant.delta',
					runId: 'r1',
					contentId: 'b1',
					text: 'Hi',
				}),
			);
			streamingStore.applyEphemeral(
				ephemeral('s1', 'r1', {
					type: 'thinking.delta',
					runId: 'r1',
					contentId: 'think-1',
					text: ' options...',
				}),
			);

			const blocks = streamingStore.blocksForRun('s1', 'r1');
			expect(blocks).toHaveLength(2);
			const thinking = blocks.find((block) => block.contentId === 'think-1');
			const assistant = blocks.find((block) => block.contentId === 'b1');
			expect(thinking).toMatchObject({ kind: 'thinking', text: 'Considering options...' });
			expect(assistant).toMatchObject({ kind: 'assistant', text: 'Hi' });
		});

		it('appends tool.input.delta chunks onto the partial JSON for a toolCallId', () => {
			streamingStore.applyEphemeral(
				ephemeral('s1', 'r1', {
					type: 'tool.input.delta',
					runId: 'r1',
					toolCallId: 'tool-1',
					name: 'Read',
					inputJsonDelta: '{"path":',
				}),
			);
			streamingStore.applyEphemeral(
				ephemeral('s1', 'r1', {
					type: 'tool.input.delta',
					runId: 'r1',
					toolCallId: 'tool-1',
					name: 'Read',
					inputJsonDelta: '"src/index.ts"}',
				}),
			);

			expect(streamingStore.toolInputJsonFor('s1', 'r1', 'tool-1')).toBe('{"path":"src/index.ts"}');
			expect(streamingStore.toolInputsForRun('s1', 'r1')).toEqual([
				{ toolCallId: 'tool-1', name: 'Read', json: '{"path":"src/index.ts"}' },
			]);
		});

		it('scopes live state per session — the same contentId in another session never mixes text', () => {
			streamingStore.applyEphemeral(
				ephemeral('s1', 'r1', { type: 'assistant.delta', runId: 'r1', contentId: 'b1', text: 'A' }),
			);
			streamingStore.applyEphemeral(
				ephemeral('s2', 'r9', { type: 'assistant.delta', runId: 'r9', contentId: 'b1', text: 'B' }),
			);

			expect(streamingStore.blocksFor('s1')[0]?.text).toBe('A');
			expect(streamingStore.blocksFor('s2')[0]?.text).toBe('B');
		});

		it('ignores ephemeral event types it does not track (e.g. interim usage.updated)', () => {
			streamingStore.applyEphemeral(
				ephemeral('s1', 'r1', {
					type: 'usage.updated',
					runId: 'r1',
					interim: true,
					outputTokens: 12,
				}),
			);
			expect(streamingStore.blocksFor('s1')).toHaveLength(0);
		});

		it('reduces an edit-heavy render window to one bounded reactive commit', () => {
			const chunks = Array.from({ length: 10_000 }, () =>
				ephemeral('s1', 'r1', {
					type: 'tool.input.delta',
					runId: 'r1',
					toolCallId: 'large-edit',
					name: 'Edit',
					inputJsonDelta: 'x'.repeat(128),
				}),
			);

			streamingStore.applyEphemeralBatch(chunks);

			const preview = streamingStore.toolInputJsonFor('s1', 'r1', 'large-edit');
			expect(preview).toHaveLength(LIVE_TOOL_INPUT_CAPTURE_CHARS);
			expect(streamingStore.ingestionStats()).toEqual({
				trackedEnvelopes: 10_000,
				reactiveCommits: 1,
				toolInputCharsDropped: 10_000 * 128 - LIVE_TOOL_INPUT_CAPTURE_CHARS,
			});

			streamingStore.applyEphemeralBatch(chunks.slice(0, 500));
			expect(streamingStore.ingestionStats().reactiveCommits).toBe(1);
			expect(streamingStore.toolInputJsonFor('s1', 'r1', 'large-edit')).toBe(preview);
		});

		it('joins same-block text chunks before publishing one frame snapshot', () => {
			streamingStore.applyEphemeralBatch([
				ephemeral('s1', 'r1', {
					type: 'assistant.delta',
					runId: 'r1',
					contentId: 'answer',
					text: 'one ',
				}),
				ephemeral('s1', 'r1', {
					type: 'assistant.delta',
					runId: 'r1',
					contentId: 'answer',
					text: 'two ',
				}),
				ephemeral('s1', 'r1', {
					type: 'assistant.delta',
					runId: 'r1',
					contentId: 'answer',
					text: 'three',
				}),
			]);

			expect(streamingStore.blocksFor('s1')[0]).toMatchObject({
				text: 'one two three',
				latestChunkLength: 13,
				revision: 3,
			});
			expect(streamingStore.ingestionStats().reactiveCommits).toBe(1);
		});
	});

	describe('finalizeBlock', () => {
		it('supersedes the live block without losing any accumulated text, and drops it from the store', () => {
			vi.useFakeTimers();
			vi.setSystemTime(1_000);
			streamingStore.applyEphemeral(
				ephemeral('s1', 'r1', {
					type: 'assistant.delta',
					runId: 'r1',
					contentId: 'b1',
					text: 'Hel',
				}),
			);
			vi.setSystemTime(1_400);
			streamingStore.applyEphemeral(
				ephemeral('s1', 'r1', {
					type: 'assistant.delta',
					runId: 'r1',
					contentId: 'b1',
					text: 'lo',
				}),
			);
			vi.setSystemTime(2_500);

			const finalized = streamingStore.finalizeBlock('s1', 'r1', 'b1');

			expect(finalized).toEqual({
				contentId: 'b1',
				runId: 'r1',
				kind: 'assistant',
				text: 'Hello',
				durationMs: 1_500,
			});
			expect(streamingStore.blocksFor('s1')).toHaveLength(0);
		});

		it('returns null and is a no-op for a contentId with no live state', () => {
			expect(streamingStore.finalizeBlock('s1', 'r1', 'missing')).toBeNull();
			expect(streamingStore.blocksFor('s1')).toHaveLength(0);
		});

		it('finalizing one block leaves a sibling block in the same run untouched', () => {
			streamingStore.applyEphemeral(
				ephemeral('s1', 'r1', { type: 'assistant.delta', runId: 'r1', contentId: 'b1', text: 'A' }),
			);
			streamingStore.applyEphemeral(
				ephemeral('s1', 'r1', {
					type: 'thinking.delta',
					runId: 'r1',
					contentId: 'think-1',
					text: 'B',
				}),
			);

			streamingStore.finalizeBlock('s1', 'r1', 'b1');

			const remaining = streamingStore.blocksFor('s1');
			expect(remaining).toHaveLength(1);
			expect(remaining[0]?.contentId).toBe('think-1');
		});

		it('is scoped by runId - finalizing contentId "0:0" for run r2 leaves run r1\'s live block "0:0" untouched (regression: bridge normalizer resets its per-run block counter, so two runs in one session routinely reuse the same contentId)', () => {
			streamingStore.applyEphemeral(
				ephemeral('s1', 'r1', {
					type: 'assistant.delta',
					runId: 'r1',
					contentId: '0:0',
					text: 'run one',
				}),
			);
			streamingStore.applyEphemeral(
				ephemeral('s1', 'r2', {
					type: 'assistant.delta',
					runId: 'r2',
					contentId: '0:0',
					text: 'run two',
				}),
			);

			expect(streamingStore.blocksForRun('s1', 'r1')).toEqual([
				expect.objectContaining({ contentId: '0:0', runId: 'r1', text: 'run one' }),
			]);
			expect(streamingStore.blocksForRun('s1', 'r2')).toEqual([
				expect.objectContaining({ contentId: '0:0', runId: 'r2', text: 'run two' }),
			]);

			const finalizedR2 = streamingStore.finalizeBlock('s1', 'r2', '0:0');
			expect(finalizedR2?.text).toBe('run two');

			expect(streamingStore.blocksForRun('s1', 'r1')).toEqual([
				expect.objectContaining({ contentId: '0:0', runId: 'r1', text: 'run one' }),
			]);
			expect(streamingStore.blocksForRun('s1', 'r2')).toHaveLength(0);
		});
	});

	describe('finalizeToolInput', () => {
		it('returns the accumulated partial JSON and drops it from the store', () => {
			streamingStore.applyEphemeral(
				ephemeral('s1', 'r1', {
					type: 'tool.input.delta',
					runId: 'r1',
					toolCallId: 'tool-1',
					name: 'Read',
					inputJsonDelta: '{"a":1}',
				}),
			);

			expect(streamingStore.finalizeToolInput('s1', 'r1', 'tool-1')).toBe('{"a":1}');
			expect(streamingStore.toolInputJsonFor('s1', 'r1', 'tool-1')).toBeNull();
		});

		it('returns null for a toolCallId with no live partial input', () => {
			expect(streamingStore.finalizeToolInput('s1', 'r1', 'missing')).toBeNull();
		});

		it('keeps reused toolCallIds isolated by run and ignores a late prior-run final', () => {
			streamingStore.applyEphemeral(
				ephemeral('s1', 'r1', {
					type: 'tool.input.delta',
					runId: 'r1',
					toolCallId: 'tool-1',
					name: 'Read',
					inputJsonDelta: '{"old":',
				}),
			);
			streamingStore.applyEphemeral(
				ephemeral('s1', 'r2', {
					type: 'tool.input.delta',
					runId: 'r2',
					toolCallId: 'tool-1',
					name: 'Edit',
					inputJsonDelta: '{"new":true}',
				}),
			);

			expect(streamingStore.toolInputJsonFor('s1', 'r1', 'tool-1')).toBe('{"old":');
			expect(streamingStore.toolInputJsonFor('s1', 'r2', 'tool-1')).toBe('{"new":true}');

			expect(streamingStore.finalizeToolInput('s1', 'r1', 'tool-1')).toBe('{"old":');
			expect(streamingStore.toolInputJsonFor('s1', 'r2', 'tool-1')).toBe('{"new":true}');
		});
	});

	describe('clearRun', () => {
		it('drops every live block and tool input for a session when no runId is given', () => {
			streamingStore.applyEphemeral(
				ephemeral('s1', 'r1', { type: 'assistant.delta', runId: 'r1', contentId: 'b1', text: 'A' }),
			);
			streamingStore.applyEphemeral(
				ephemeral('s1', 'r1', {
					type: 'tool.input.delta',
					runId: 'r1',
					toolCallId: 'tool-1',
					name: 'Read',
					inputJsonDelta: '{}',
				}),
			);

			streamingStore.clearRun('s1');

			expect(streamingStore.blocksFor('s1')).toHaveLength(0);
			expect(streamingStore.toolInputJsonFor('s1', 'r1', 'tool-1')).toBeNull();
		});

		it("scoped to a runId, only drops that run's stragglers — a different run in the same session survives", () => {
			streamingStore.applyEphemeral(
				ephemeral('s1', 'r1', {
					type: 'assistant.delta',
					runId: 'r1',
					contentId: 'b1',
					text: 'old run',
				}),
			);
			streamingStore.applyEphemeral(
				ephemeral('s1', 'r2', {
					type: 'assistant.delta',
					runId: 'r2',
					contentId: 'b2',
					text: 'new run',
				}),
			);

			streamingStore.clearRun('s1', 'r1');

			const remaining = streamingStore.blocksFor('s1');
			expect(remaining).toHaveLength(1);
			expect(remaining[0]?.contentId).toBe('b2');
		});

		it('a late ephemeral delta for an already-cleared run starts a fresh block, carrying none of the pre-clear text', () => {
			streamingStore.applyEphemeral(
				ephemeral('s1', 'r1', {
					type: 'assistant.delta',
					runId: 'r1',
					contentId: 'b1',
					text: 'stale content that should not survive',
				}),
			);

			streamingStore.clearRun('s1', 'r1');
			expect(streamingStore.blocksFor('s1')).toHaveLength(0);

			streamingStore.applyEphemeral(
				ephemeral('s1', 'r1', {
					type: 'assistant.delta',
					runId: 'r1',
					contentId: 'b1',
					text: 'late',
				}),
			);

			expect(streamingStore.blocksFor('s1')).toEqual([
				expect.objectContaining({ contentId: 'b1', text: 'late' }),
			]);
		});
	});

	describe('reset', () => {
		it('clears state across every session', () => {
			streamingStore.applyEphemeral(
				ephemeral('s1', 'r1', { type: 'assistant.delta', runId: 'r1', contentId: 'b1', text: 'A' }),
			);
			streamingStore.applyEphemeral(
				ephemeral('s2', 'r2', { type: 'assistant.delta', runId: 'r2', contentId: 'b2', text: 'B' }),
			);

			streamingStore.reset();

			expect(streamingStore.blocksFor('s1')).toHaveLength(0);
			expect(streamingStore.blocksFor('s2')).toHaveLength(0);
		});
	});

	describe('live context usage', () => {
		function usage(
			sessionId: string,
			runId: string,
			contextTokens: number,
			contextWindowTokens?: number,
		): EphemeralEnvelope {
			return ephemeral(sessionId, runId, {
				type: 'usage.updated',
				runId,
				contextTokens,
				...(contextWindowTokens !== undefined ? { contextWindowTokens } : {}),
				interim: true,
			});
		}

		it('tracks the newest occupancy reported mid-run', () => {
			streamingStore.applyEphemeral(usage('s1', 'r1', 20_000, 200_000));
			expect(streamingStore.liveContextUsageFor('s1')).toEqual({
				runId: 'r1',
				contextTokens: 20_000,
				contextWindowTokens: 200_000,
			});

			streamingStore.applyEphemeral(usage('s1', 'r1', 55_000, 200_000));
			expect(streamingStore.liveContextUsageFor('s1')?.contextTokens).toBe(55_000);
		});

		it('keeps only the last reading when a batch carries several', () => {
			streamingStore.applyEphemeralBatch([
				usage('s1', 'r1', 20_000, 200_000),
				usage('s1', 'r1', 41_000, 200_000),
			]);

			expect(streamingStore.liveContextUsageFor('s1')?.contextTokens).toBe(41_000);
		});

		it('separates sessions', () => {
			streamingStore.applyEphemeralBatch([
				usage('s1', 'r1', 20_000, 200_000),
				usage('s2', 'r2', 90_000, 1_000_000),
			]);

			expect(streamingStore.liveContextUsageFor('s1')?.contextTokens).toBe(20_000);
			expect(streamingStore.liveContextUsageFor('s2')?.contextTokens).toBe(90_000);
		});

		it('reports no window rather than a zero one when the model has none published', () => {
			streamingStore.applyEphemeral(usage('s1', 'r1', 20_000));
			expect(streamingStore.liveContextUsageFor('s1')?.contextWindowTokens).toBeNull();
		});

		it('ignores a reading with no occupancy in it', () => {
			streamingStore.applyEphemeral(
				ephemeral('s1', 'r1', {
					type: 'usage.updated',
					runId: 'r1',
					outputTokens: 12,
					interim: true,
				}),
			);

			expect(streamingStore.liveContextUsageFor('s1')).toBeNull();
		});

		it('hands the meter back to the transcript when the run ends', () => {
			streamingStore.applyEphemeral(usage('s1', 'r1', 55_000, 200_000));
			streamingStore.clearRun('s1', 'r1');

			expect(streamingStore.liveContextUsageFor('s1')).toBeNull();
		});

		it('leaves another run’s reading alone when one run ends', () => {
			streamingStore.applyEphemeral(usage('s1', 'r2', 55_000, 200_000));
			streamingStore.clearRun('s1', 'r1');

			expect(streamingStore.liveContextUsageFor('s1')?.runId).toBe('r2');
		});

		it('clears with reset', () => {
			streamingStore.applyEphemeral(usage('s1', 'r1', 55_000, 200_000));
			streamingStore.reset();

			expect(streamingStore.liveContextUsageFor('s1')).toBeNull();
		});
	});
});
