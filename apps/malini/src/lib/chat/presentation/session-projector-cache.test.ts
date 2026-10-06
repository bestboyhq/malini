import { describe, expect, it } from 'vitest';
import type { AgentEvent, EventEnvelope } from '$lib/chat/domain/events';
import type { SessionId } from '$lib/chat/domain/session';
import { SessionProjectorCache } from './session-projector-cache';
import { readChatMessageListSource } from './chat-message-list-source.testkit';
import type { RenderState, RunGroup } from './render-state';

function firstRun(state: RenderState): RunGroup {
	const run = state.runs[0];
	if (!run) throw new Error('expected a run');
	return run;
}

const messageList = readChatMessageListSource(new URL('./', import.meta.url));

function assistant(sessionId: SessionId, seq: number): EventEnvelope {
	return {
		sessionId,
		runId: 'run-1',
		seq,
		event: { type: 'assistant.message', runId: 'run-1', text: `message ${seq}` },
	};
}

function envelope(
	sessionId: SessionId,
	runId: string,
	seq: number,
	event: AgentEvent,
): EventEnvelope {
	return { sessionId, runId, seq, event };
}

describe('SessionProjectorCache', () => {
	it('reuses the complete render and timeline projections after switching away and back', () => {
		const cache = new SessionProjectorCache();
		const sessionA = cache.acquire('session-a');
		const envelope = assistant('session-a', 1);
		let run = firstRun(sessionA.render.project([envelope]));
		sessionA.timeline.project(run, []);

		const sessionB = cache.acquire('session-b');
		const otherRun = firstRun(sessionB.render.project([assistant('session-b', 1)]));
		sessionB.timeline.project(otherRun, []);

		const warmSessionA = cache.acquire('session-a');
		expect(warmSessionA).toBe(sessionA);
		run = firstRun(warmSessionA.render.project([envelope]));
		expect(warmSessionA.timeline.project(run, []).map((item) => item.seq)).toEqual([1]);
		expect(warmSessionA.render.stats()).toEqual({
			processedEnvelopeCount: 1,
			rebuildCount: 0,
		});
		expect(warmSessionA.timeline.stats()).toEqual({ processedChanges: 0, rebuildCount: 1 });
	});

	it('preserves canonical correctness when cached envelopes insert earlier history or shrink', () => {
		const cache = new SessionProjectorCache();
		const pair = cache.acquire('session-a');
		const later = assistant('session-a', 30);
		const earlier = assistant('session-a', 20);

		let run = firstRun(pair.render.project([later]));
		pair.timeline.project(run, []);

		run = firstRun(cache.acquire('session-a').render.project([earlier, later]));
		expect(pair.timeline.project(run, []).map((item) => item.seq)).toEqual([20, 30]);

		run = firstRun(cache.acquire('session-a').render.project([earlier]));
		expect(pair.timeline.project(run, []).map((item) => item.seq)).toEqual([20]);
		expect(pair.render.stats()).toEqual({ processedEnvelopeCount: 4, rebuildCount: 2 });
		expect(pair.timeline.stats().rebuildCount).toBe(3);
	});

	it('evicts least-recently-used sessions and supports explicit invalidation', () => {
		const cache = new SessionProjectorCache(2);
		const first = cache.acquire('session-a');
		const second = cache.acquire('session-b');
		expect(cache.acquire('session-a')).toBe(first);

		cache.acquire('session-c');
		expect(cache.size).toBe(2);
		expect(cache.acquire('session-b')).not.toBe(second);
		expect(cache.size).toBe(2);
		expect(cache.invalidate('session-b')).toBe(true);
		expect(cache.invalidate('session-b')).toBe(false);
		expect(cache.size).toBe(1);
	});

	it('preserves exact membership, finalized thoughts, and incremental effects through A -> B -> A', () => {
		const cache = new SessionProjectorCache();
		const sessionAEnvelopes = [
			envelope('session-a', 'run-a', 1, {
				type: 'run.started',
				runId: 'run-a',
				sessionId: 'session-a',
			}),
			envelope('session-a', 'run-a', 2, {
				type: 'thinking.message',
				runId: 'run-a',
				contentId: 'thought-a',
				text: 'durable thought',
			}),
			envelope('session-a', 'run-a', 3, {
				type: 'assistant.message',
				runId: 'run-a',
				contentId: 'answer-a',
				text: 'durable answer',
			}),
			envelope('session-a', 'run-a', 4, {
				type: 'tool.started',
				runId: 'run-a',
				toolCallId: 'tool-a',
				name: 'Read',
				input: { path: 'README.md' },
			}),
		];
		const thoughtEnvelope = sessionAEnvelopes[1];
		if (!thoughtEnvelope) throw new Error('expected the thought envelope');
		const sessionA = cache.acquire('session-a');
		const firstSnapshot = sessionA.streaming.project(sessionAEnvelopes);

		expect(firstSnapshot.finalizedBlockKeys).toEqual(
			new Set(['session-a:run-a:thought-a', 'session-a:run-a:answer-a']),
		);
		expect(firstSnapshot.startedToolInputKeys).toEqual(new Set(['run-a:tool-a']));
		expect(sessionA.streaming.takePendingEffects()).toEqual(sessionAEnvelopes);
		expect(sessionA.streaming.finalizedThoughtsForRun('run-a')).toEqual([
			expect.objectContaining({ contentId: 'thought-a', text: 'durable thought' }),
		]);

		expect(
			sessionA.streaming.recordFinalizedThought(
				{
					sessionId: 'session-a',
					runId: 'run-a',
					contentId: 'thought-a',
					seq: 2,
					text: 'streamed thought',
					durationSeconds: 3,
				},
				thoughtEnvelope,
			),
		).toBe(true);
		cache.acquire('session-b').streaming.project([assistant('session-b', 1)]);

		const warmSessionA = cache.acquire('session-a');
		const enrichedSnapshot = warmSessionA.streaming.project(sessionAEnvelopes);
		const warmSnapshot = warmSessionA.streaming.project(sessionAEnvelopes);
		expect(warmSessionA).toBe(sessionA);
		expect(warmSnapshot).toBe(enrichedSnapshot);
		expect(warmSessionA.streaming.takePendingEffects()).toEqual([]);
		expect(warmSessionA.streaming.finalizedThoughtsForRun('run-a')).toEqual([
			expect.objectContaining({
				contentId: 'thought-a',
				text: 'streamed thought',
				durationSeconds: 3,
			}),
		]);

		const appended = envelope('session-a', 'run-a', 5, {
			type: 'assistant.message',
			runId: 'run-a',
			contentId: 'answer-b',
			text: 'one live append',
		});
		const nextSnapshot = warmSessionA.streaming.project([...sessionAEnvelopes, appended]);
		expect(nextSnapshot.finalizedBlockKeys.has('session-a:run-a:answer-b')).toBe(true);
		expect(warmSessionA.streaming.takePendingEffects()).toEqual([appended]);
		expect(warmSessionA.streaming.stats()).toMatchObject({
			processedEnvelopeCount: 5,
			projectionEnvelopeVisitCount: 5,
			effectEnvelopeCount: 5,
			membershipRebuildCount: 0,
			pendingEffectCount: 0,
		});
	});

	it('rebuilds same-length membership replacement instead of trusting a matching tail key', () => {
		const streaming = new SessionProjectorCache().acquire('session-a').streaming;
		const first = envelope('session-a', 'run-a', 1, {
			type: 'assistant.message',
			runId: 'run-a',
			contentId: 'answer-a',
			text: 'first',
		});
		streaming.project([first]);
		streaming.takePendingEffects();

		const replacement = envelope('session-a', 'run-a', 1, {
			type: 'assistant.message',
			runId: 'run-a',
			contentId: 'answer-b',
			text: 'replacement',
		});
		const rebuilt = streaming.project([replacement]);
		expect(rebuilt.finalizedBlockKeys).toEqual(new Set(['session-a:run-a:answer-b']));
		expect(streaming.takePendingEffects()).toEqual([]);
		expect(streaming.stats().membershipRebuildCount).toBe(1);
	});

	it('remaps an undrained one-shot effect to an equivalent canonical replay object', () => {
		const streaming = new SessionProjectorCache().acquire('session-a').streaming;
		const original = envelope('session-a', 'run-a', 1, {
			type: 'thinking.message',
			runId: 'run-a',
			contentId: 'thought-a',
			text: 'same durable thought',
		});
		streaming.project([original]);

		const replayed = envelope('session-a', 'run-a', 1, {
			type: 'thinking.message',
			runId: 'run-a',
			contentId: 'thought-a',
			text: 'same durable thought',
		});
		streaming.project([replayed]);
		expect(streaming.takePendingEffects()).toEqual([replayed]);
		expect(streaming.takePendingEffects()).toEqual([]);
	});

	it('rebuilds exact synchronous membership when canonical history shrinks', () => {
		const streaming = new SessionProjectorCache().acquire('session-a').streaming;
		const finalized = envelope('session-a', 'run-a', 1, {
			type: 'assistant.message',
			runId: 'run-a',
			contentId: 'answer-a',
			text: 'answer',
		});

		expect(streaming.project([finalized]).finalizedBlockKeys.has('session-a:run-a:answer-a')).toBe(
			true,
		);
		streaming.takePendingEffects();
		expect(streaming.project([]).finalizedBlockKeys.size).toBe(0);
		expect(streaming.project([finalized]).finalizedBlockKeys.has('session-a:run-a:answer-a')).toBe(
			true,
		);
		expect(streaming.takePendingEffects()).toEqual([]);
		expect(streaming.stats()).toMatchObject({
			processedEnvelopeCount: 1,
			projectionEnvelopeVisitCount: 2,
			membershipRebuildCount: 1,
			effectEnvelopeCount: 1,
		});
	});

	it('preserves rich finalized thoughts across replay rebuilds and drops them only on removal', () => {
		const streaming = new SessionProjectorCache().acquire('session-a').streaming;
		const thought = envelope('session-a', 'run-a', 2, {
			type: 'thinking.message',
			runId: 'run-a',
			contentId: 'thought-a',
			text: 'durable thought',
		});
		streaming.project([thought]);
		streaming.takePendingEffects();
		streaming.recordFinalizedThought(
			{
				sessionId: 'session-a',
				runId: 'run-a',
				contentId: 'thought-a',
				seq: 2,
				text: 'richer streamed thought',
				durationSeconds: 7,
			},
			thought,
		);

		const earlier = envelope('session-a', 'run-a', 1, {
			type: 'assistant.message',
			runId: 'run-a',
			contentId: 'answer-before-thought',
			text: 'earlier replay',
		});
		streaming.project([earlier, thought]);
		expect(streaming.finalizedThoughtsForRun('run-a')).toEqual([
			expect.objectContaining({
				text: 'richer streamed thought',
				durationSeconds: 7,
			}),
		]);

		streaming.project([earlier]);
		expect(streaming.finalizedThoughtsForRun('run-a')).toEqual([]);
	});

	it('keeps a large transcript remount at zero envelope operations and reuses its render snapshot', () => {
		const envelopeCount = 20_000;
		const transcript = Array.from({ length: envelopeCount }, (_, index) =>
			envelope('session-a', 'run-a', index + 1, {
				type: 'assistant.message',
				runId: 'run-a',
				contentId: `answer-${index + 1}`,
				text: `answer ${index + 1}`,
			}),
		);
		const cache = new SessionProjectorCache();
		const sessionA = cache.acquire('session-a');
		const coldRender = sessionA.render.project(transcript);
		const coldStreaming = sessionA.streaming.project(transcript);
		sessionA.streaming.takePendingEffects();
		cache.acquire('session-b').render.project([assistant('session-b', 1)]);

		const warmSessionA = cache.acquire('session-a');
		const warmRender = warmSessionA.render.project(transcript);
		const warmStreaming = warmSessionA.streaming.project(transcript);

		expect(warmRender).toBe(coldRender);
		expect(warmStreaming).toBe(coldStreaming);
		expect(warmSessionA.streaming.takePendingEffects()).toEqual([]);
		expect(warmSessionA.render.stats()).toEqual({
			processedEnvelopeCount: envelopeCount,
			rebuildCount: 0,
		});
		expect(warmSessionA.streaming.stats()).toMatchObject({
			processedEnvelopeCount: envelopeCount,
			projectionEnvelopeVisitCount: envelopeCount,
			effectEnvelopeCount: envelopeCount,
			membershipRebuildCount: 0,
			pendingEffectCount: 0,
		});
		expect(warmSessionA.streaming.stats().unchangedSourceHits).toBeGreaterThanOrEqual(1);
	});

	it('wires the session-reactive pair without resetting the target timeline on a switch', () => {
		expect(messageList).toContain(
			'const sessionProjectors = $derived(sessionProjectorCache.acquire(sessionId));',
		);
		expect(messageList).toContain('sessionProjectors.render.project(envelopes)');
		expect(messageList).toContain('sessionProjectors.timeline.project(');
		expect(messageList).toContain('sessionProjectors.streaming.project(envelopes)');
		expect(messageList).toContain('currentStreamingProjector.takePendingEffects()');
		expect(messageList).not.toContain('persistedStreamingMembershipBySession');
		expect(messageList).not.toContain('streamingCursorBySession');
		expect(messageList).not.toContain('takeUnprocessedEnvelopes(');
		expect(messageList).not.toMatch(/sessionProjectors\.timeline\.reset\(\)/u);
	});
});
