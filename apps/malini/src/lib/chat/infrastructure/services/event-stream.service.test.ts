import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, EventEnvelope } from '$lib/chat/domain/events';
import { CHAT_AGENT_EVENT_CHANNEL } from '$contract/events';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { streamingStore } from '$lib/chat/infrastructure/stores/streaming.store.svelte';

let platform: FakePlatform = createFakePlatform();

async function installPlatform(): Promise<void> {
	platform = createFakePlatform();
	const { setPlatformForTest } = await import('$shared/port/platform');
	setPlatformForTest(platform);
}

function emitAgentEvent(payload: unknown): void {
	platform.emit(CHAT_AGENT_EVENT_CHANNEL, payload);
}

async function importHook() {
	const mod = await import('./event-stream.service');
	return mod;
}

function env(sessionId: string, runId: string, seq: number, event: AgentEvent): EventEnvelope {
	return { sessionId, runId, seq, event };
}

describe('createEventStream', () => {
	beforeEach(async () => {
		sessionsAggregate.reset();
		streamingStore.reset();
		await installPlatform();
	});

	afterEach(async () => {
		const { setPlatformForTest } = await import('$shared/port/platform');
		setPlatformForTest(null);
		vi.resetModules();
	});

	it('replay-then-live: live envelope with same seq as replayed envelope is dropped (dedupe)', async () => {
		const { createEventStream } = await importHook();
		const received: number[] = [];

		const stream = createEventStream((e) => {
			received.push(e.seq);
		}, {});
		await stream.start();

		const replayed = await stream.pushReplay([
			env('s1', 'r1', 1, { type: 'run.started', runId: 'r1', sessionId: 's1' }),
			env('s1', 'r1', 2, { type: 'assistant.message', runId: 'r1', text: 'hi' }),
		]);
		expect(replayed).toBe(2);
		expect(received).toEqual([1, 2]);

		const liveEarlierPayload = env('s1', 'r1', 1, {
			type: 'assistant.message',
			runId: 'r1',
			text: 'dup',
		});
		emitAgentEvent(liveEarlierPayload);

		expect(stream.stats().replayed).toBe(2);
		expect(stream.stats().live).toBe(0);
		expect(stream.stats().dropped).toBeGreaterThanOrEqual(1);
		expect(received).toEqual([1, 2]);

		await stream.dispose();
	});

	it('out-of-order replay delivery still produces canonical in-order apply', async () => {
		const { createEventStream } = await importHook();
		const seenSeqs: number[] = [];
		const stream = createEventStream((e) => {
			seenSeqs.push(e.seq);
		}, {});
		await stream.start();

		await stream.pushReplay([
			env('s2', 'r1', 3, { type: 'tool.completed', runId: 'r1', name: 'Bash' }),
			env('s2', 'r1', 1, { type: 'run.started', runId: 'r1', sessionId: 's2' }),
			env('s2', 'r1', 2, { type: 'assistant.message', runId: 'r1', text: 'mid' }),
		]);

		expect(seenSeqs).toEqual([1, 2, 3]);
		await stream.dispose();
	});

	it('duplicate seqs within live channel are dropped silently', async () => {
		const { createEventStream } = await importHook();
		const seen: number[] = [];
		const stream = createEventStream((e) => {
			seen.push(e.seq);
		}, {});
		await stream.start();

		emitAgentEvent(env('sx', 'r1', 1, { type: 'run.started', runId: 'r1', sessionId: 'sx' }));
		emitAgentEvent(env('sx', 'r1', 2, { type: 'assistant.message', runId: 'r1', text: 'a' }));

		expect(seen).toEqual([1, 2]);
		const beforeDup = stream.stats().live;

		emitAgentEvent(env('sx', 'r1', 2, { type: 'assistant.message', runId: 'r1', text: 'dup-a' }));
		emitAgentEvent(env('sx', 'r1', 1, { type: 'run.started', runId: 'r1', sessionId: 'sx' }));

		expect(seen).toEqual([1, 2]);
		expect(stream.stats().live).toBe(beforeDup);
		expect(stream.stats().dropped).toBeGreaterThanOrEqual(2);

		await stream.dispose();
	});

	it('valid events from live channel increment lastSeenSeq and apply listener', async () => {
		const { createEventStream } = await importHook();
		const received: number[] = [];
		const stream = createEventStream((e) => {
			received.push(e.seq);
		}, {});
		await stream.start();

		emitAgentEvent(env('s3', 'r1', 1, { type: 'run.started', runId: 'r1', sessionId: 's3' }));
		emitAgentEvent(env('s3', 'r1', 2, { type: 'run.completed', runId: 'r1', summary: 'ok' }));

		expect(received).toEqual([1, 2]);
		expect(stream.lastSeenSeq('s3')).toBe(2);
		expect(stream.stats().live).toBe(2);

		await stream.dispose();
	});

	it('coalesces durable live projection per render window and flushes the full tail at a lifecycle boundary', async () => {
		vi.useFakeTimers();
		try {
			const { createEventStream } = await importHook();
			const listener = vi.fn();
			const batches: EventEnvelope[][] = [];
			const stream = createEventStream(listener, {
				liveBatchWindowMs: 16,
				onLiveBatch: (batch) => batches.push([...batch]),
			});
			await stream.start();

			emitAgentEvent(
				env('live-batch', 'r1', 1, {
					type: 'assistant.message',
					runId: 'r1',
					text: 'first',
				}),
			);
			emitAgentEvent(
				env('live-batch', 'r1', 2, {
					type: 'assistant.message',
					runId: 'r1',
					text: 'second',
				}),
			);
			expect(stream.stats().live).toBe(2);
			expect(stream.lastSeenSeq('live-batch')).toBe(2);
			expect(listener).not.toHaveBeenCalled();
			expect(batches).toEqual([]);

			await vi.advanceTimersByTimeAsync(16);
			expect(batches.map((batch) => batch.map(({ seq }) => seq))).toEqual([[1, 2]]);

			emitAgentEvent(
				env('live-batch', 'r1', 3, {
					type: 'assistant.message',
					runId: 'r1',
					text: 'third',
				}),
			);
			emitAgentEvent(
				env('live-batch', 'r1', 4, {
					type: 'run.completed',
					runId: 'r1',
					summary: 'done',
				}),
			);
			expect(batches.map((batch) => batch.map(({ seq }) => seq))).toEqual([
				[1, 2],
				[3, 4],
			]);
			expect(stream.stats().live).toBe(4);

			await stream.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it('dispose() unsubscribes the platform listener so further emits are not delivered', async () => {
		const { createEventStream } = await importHook();
		const received: number[] = [];
		const stream = createEventStream((e) => {
			received.push(e.seq);
		}, {});
		await stream.start();

		emitAgentEvent(env('s4', 'r1', 1, { type: 'run.started', runId: 'r1', sessionId: 's4' }));
		expect(received).toEqual([1]);

		await stream.dispose();

		expect(platform.listenerCount(CHAT_AGENT_EVENT_CHANNEL)).toBe(0);

		emitAgentEvent(
			env('s4', 'r1', 2, { type: 'assistant.message', runId: 'r1', text: 'after-dispose' }),
		);
		expect(received).toEqual([1]);
		expect(stream.stats().live).toBe(1);
	});

	it('keeps start degraded after listener installation fails and reconnects on retry', async () => {
		const { createEventStream } = await importHook();
		let attempts = 0;
		let installed: ((event: EventEnvelope | null) => void) | null = null;
		const states: Array<{ phase: string; error?: string }> = [];
		const stream = createEventStream(() => {}, {
			listen: (handler) => {
				attempts += 1;
				if (attempts === 1) throw new Error('native listener unavailable');
				installed = handler;
				return () => {
					installed = null;
				};
			},
			onListenerState: (state) => states.push(state),
		});

		await expect(stream.start()).rejects.toThrow('native listener unavailable');
		expect(stream.isStarted()).toBe(false);
		expect(installed).toBeNull();
		expect(states).toEqual([
			{ phase: 'connecting' },
			{ phase: 'failed', error: 'native listener unavailable' },
		]);

		await stream.start();
		expect(stream.isStarted()).toBe(true);
		expect(installed).not.toBeNull();
		expect(attempts).toBe(2);
		expect(states.at(-1)).toEqual({ phase: 'ready' });
		await stream.dispose();
	});

	it("dispose() clears the per-session contiguous-frontier/dedupe bookkeeping so it does not grow unbounded across a stream's lifetime", async () => {
		const { createEventStream } = await importHook();
		const received: number[] = [];
		const stream = createEventStream((e) => {
			received.push(e.seq);
		}, {});
		await stream.start();

		emitAgentEvent(
			env('s-prune', 'r1', 1, { type: 'run.started', runId: 'r1', sessionId: 's-prune' }),
		);
		emitAgentEvent(env('s-prune', 'r1', 2, { type: 'assistant.message', runId: 'r1', text: 'a' }));
		expect(stream.lastSeenSeq('s-prune')).toBe(2);

		await stream.dispose();

		expect(stream.lastSeenSeq('s-prune')).toBe(0);

		await stream.start();
		emitAgentEvent(
			env('s-prune', 'r1', 1, { type: 'run.started', runId: 'r1', sessionId: 's-prune' }),
		);
		expect(received).toEqual([1, 2, 1]);
		expect(stream.lastSeenSeq('s-prune')).toBe(1);

		await stream.dispose();
	});

	it('malformed envelopes (missing seq, non-string sessionId) are silently dropped', async () => {
		const { createEventStream } = await importHook();
		const received: number[] = [];
		const stream = createEventStream((e) => {
			received.push(e.seq);
		}, {});
		await stream.start();

		emitAgentEvent({
			sessionId: 'ok',
			runId: 'r1',
			seq: 1,
			event: { type: 'run.started', sessionId: 'ok', runId: 'r1' },
		});
		emitAgentEvent({ sessionId: 42, runId: 'r1', seq: 2, event: { type: 'unknown', raw: {} } });
		emitAgentEvent(null);
		emitAgentEvent(undefined);

		expect(received).toEqual([1]);
		expect(stream.stats().dropped).toBeGreaterThanOrEqual(3);

		await stream.dispose();
	});

	it('per-session lastSeenSeq is tracked independently and applies across both replay and live', async () => {
		const { createEventStream } = await importHook();
		const seenA: number[] = [];
		const seenB: number[] = [];
		const stream = createEventStream((e) => {
			if (e.sessionId === 'a') seenA.push(e.seq);
			if (e.sessionId === 'b') seenB.push(e.seq);
		}, {});
		await stream.start();

		await stream.pushReplay([
			env('a', 'r1', 1, { type: 'run.started', runId: 'r1', sessionId: 'a' }),
			env('b', 'r2', 1, { type: 'run.started', runId: 'r2', sessionId: 'b' }),
		]);

		emitAgentEvent(env('a', 'r1', 1, { type: 'assistant.message', runId: 'r1', text: 'dup-a' }));
		emitAgentEvent(env('b', 'r2', 2, { type: 'assistant.message', runId: 'r2', text: 'b-2' }));
		emitAgentEvent(env('a', 'r1', 2, { type: 'assistant.message', runId: 'r1', text: 'a-2' }));

		expect(seenA).toEqual([1, 2]);
		expect(seenB).toEqual([1, 2]);
		expect(stream.lastSeenSeq('a')).toBe(2);
		expect(stream.lastSeenSeq('b')).toBe(2);

		await stream.dispose();
	});

	it('replay + live dedupe → eventsBySession[sessionId].length === 1 (A14 criterion)', async () => {
		const { createEventStream } = await importHook();
		sessionsAggregate.reset();
		const sessionId = 'criterion-dedupe';
		const stream = createEventStream((e) => sessionsAggregate.applyEvent(e), {});
		await stream.start();

		await stream.pushReplay([
			env(sessionId, 'r1', 1, { type: 'run.started', runId: 'r1', sessionId }),
		]);
		emitAgentEvent(
			env(sessionId, 'r1', 1, { type: 'assistant.message', runId: 'r1', text: 'live-dup' }),
		);

		expect(sessionsAggregate.listEventsFor(sessionId)).toHaveLength(1);
		expect(stream.stats().live).toBe(0);
		expect(stream.stats().dropped).toBeGreaterThanOrEqual(1);

		await stream.dispose();
	});

	describe('hydrate', () => {
		function deferred<T>(): {
			promise: Promise<T>;
			resolve: (value: T) => void;
		} {
			let resolve!: (value: T) => void;
			const promise = new Promise<T>((res) => {
				resolve = res;
			});
			return { promise, resolve };
		}

		it('is a no-op when no replay option was provided', async () => {
			const { createEventStream } = await importHook();
			const received: number[] = [];
			const stream = createEventStream((e) => received.push(e.seq), {});
			await stream.start();

			await stream.hydrate('never-replayed');

			expect(received).toEqual([]);
			expect(stream.stats().replayed).toBe(0);
		});

		it('buffers a live event that arrives mid-hydration, then applies it after replay with no loss and no duplicates', async () => {
			const { createEventStream } = await importHook();
			const received: EventEnvelope[] = [];
			const gate = deferred<readonly EventEnvelope[]>();
			const replayCalls: Array<{ sessionId: string; afterSeq: number }> = [];

			const stream = createEventStream((e) => received.push(e), {
				replay: async (sessionId, afterSeq) => {
					replayCalls.push({ sessionId, afterSeq });
					return gate.promise;
				},
			});
			await stream.start();

			const hydratePromise = stream.hydrate('hydrate-race');

			emitAgentEvent(
				env('hydrate-race', 'r1', 2, { type: 'assistant.message', runId: 'r1', text: 'live-2' }),
			);
			expect(received).toEqual([]);

			gate.resolve([
				env('hydrate-race', 'r1', 1, {
					type: 'run.started',
					runId: 'r1',
					sessionId: 'hydrate-race',
				}),
			]);
			await hydratePromise;

			expect(received.map((e) => e.seq)).toEqual([1, 2]);
			expect(stream.stats().replayed).toBe(1);
			expect(stream.stats().live).toBe(1);
			expect(stream.lastSeenSeq('hydrate-race')).toBe(2);

			emitAgentEvent(
				env('hydrate-race', 'r1', 2, { type: 'assistant.message', runId: 'r1', text: 'dup' }),
			);
			expect(received.map((e) => e.seq)).toEqual([1, 2]);
			expect(stream.stats().dropped).toBeGreaterThanOrEqual(1);

			await stream.dispose();
		});

		it('retains the buffered live tail across replay failure and flushes it losslessly on retry', async () => {
			const { createEventStream } = await importHook();
			const received: EventEnvelope[] = [];
			let rejectFirst!: (error: Error) => void;
			const firstReplay = new Promise<readonly EventEnvelope[]>((_resolve, reject) => {
				rejectFirst = reject;
			});
			let attempts = 0;
			const stream = createEventStream((e) => received.push(e), {
				replay: async () => {
					attempts += 1;
					if (attempts === 1) return await firstReplay;
					return [
						env('failed-replay', 'r1', 1, {
							type: 'run.started',
							runId: 'r1',
							sessionId: 'failed-replay',
						}),
					];
				},
			});
			await stream.start();

			const hydratePromise = stream.hydrate('failed-replay');
			emitAgentEvent(
				env('failed-replay', 'r1', 2, {
					type: 'assistant.message',
					runId: 'r1',
					text: 'must wait for replay',
				}),
			);
			expect(received).toEqual([]);

			rejectFirst(new Error('sqlite unavailable'));
			await expect(hydratePromise).rejects.toThrow('sqlite unavailable');

			expect(received).toEqual([]);
			expect(stream.stats().live).toBe(0);
			expect(stream.lastSeenSeq('failed-replay')).toBe(0);
			emitAgentEvent(
				env('failed-replay', 'r1', 3, {
					type: 'assistant.message',
					runId: 'r1',
					text: 'also buffered after failure',
				}),
			);

			await stream.hydrate('failed-replay');
			expect(received.map((event) => event.seq)).toEqual([1, 2, 3]);
			expect(attempts).toBe(2);
			expect(stream.stats()).toMatchObject({ replayed: 1, live: 2 });

			await stream.dispose();
		});

		it('accepts non-contiguous global seqs while the aggregate preserves canonical order', async () => {
			const { createEventStream } = await importHook();
			const stream = createEventStream((e) => {
				sessionsAggregate.applyEvent(e);
			}, {});
			await stream.start();

			await stream.pushReplay([
				env('global-a', 'r1', 1, { type: 'run.started', runId: 'r1', sessionId: 'global-a' }),
				env('global-b', 'r2', 42, { type: 'run.started', runId: 'r2', sessionId: 'global-b' }),
				env('global-b', 'r2', 47, { type: 'assistant.message', runId: 'r2', text: 'after gap' }),
			]);

			expect(stream.lastSeenSeq('global-b')).toBe(47);

			emitAgentEvent(
				env('global-b', 'r2', 44, {
					type: 'assistant.message',
					runId: 'r2',
					text: 'late but legitimate',
				}),
			);
			expect(sessionsAggregate.listEventsFor('global-b').map((event) => event.type)).toEqual([
				'run.started',
				'assistant.message',
				'assistant.message',
			]);
			expect(
				sessionsAggregate
					.listEventsFor('global-b')
					.filter((event) => event.type === 'assistant.message')
					.map((event) => event.text),
			).toEqual(['late but legitimate', 'after gap']);
			expect(stream.lastSeenSeq('global-b')).toBe(47);

			await stream.dispose();
		});

		it('per-session isolation: hydrating session A does not delay or drop live events for session B', async () => {
			const { createEventStream } = await importHook();
			const receivedA: number[] = [];
			const receivedB: number[] = [];
			const gate = deferred<readonly EventEnvelope[]>();

			const stream = createEventStream(
				(e) => {
					if (e.sessionId === 'iso-a') receivedA.push(e.seq);
					if (e.sessionId === 'iso-b') receivedB.push(e.seq);
				},
				{ replay: async () => gate.promise },
			);
			await stream.start();

			const hydratePromise = stream.hydrate('iso-a');

			emitAgentEvent(
				env('iso-b', 'r2', 1, { type: 'run.started', runId: 'r2', sessionId: 'iso-b' }),
			);
			expect(receivedB).toEqual([1]);

			emitAgentEvent(
				env('iso-a', 'r1', 5, { type: 'assistant.message', runId: 'r1', text: 'buffered' }),
			);
			expect(receivedA).toEqual([]);

			gate.resolve([
				env('iso-a', 'r1', 4, { type: 'run.started', runId: 'r1', sessionId: 'iso-a' }),
			]);
			await hydratePromise;

			expect(receivedA).toEqual([4, 5]);
			expect(receivedB).toEqual([1]);

			await stream.dispose();
		});

		it('hydrates from 0 the first time, then uses the highest known global seq on later replays', async () => {
			const { createEventStream } = await importHook();
			const replayCalls: Array<{ sessionId: string; afterSeq: number }> = [];
			const stream = createEventStream(() => {}, {
				replay: async (sessionId, afterSeq) => {
					replayCalls.push({ sessionId, afterSeq });
					return [];
				},
			});
			await stream.start();

			emitAgentEvent(
				env('gap-only', 'r1', 1, { type: 'run.started', runId: 'r1', sessionId: 'gap-only' }),
			);
			emitAgentEvent(
				env('gap-only', 'r1', 2, { type: 'assistant.message', runId: 'r1', text: 'a' }),
			);
			expect(stream.lastSeenSeq('gap-only')).toBe(2);

			await stream.hydrate('gap-only');
			await stream.hydrate('gap-only');

			expect(replayCalls).toEqual([
				{ sessionId: 'gap-only', afterSeq: 0 },
				{ sessionId: 'gap-only', afterSeq: 2 },
			]);

			await stream.dispose();
		});

		it('a fresh session with no prior events hydrates with afterSeq 0', async () => {
			const { createEventStream } = await importHook();
			const replayCalls: Array<{ sessionId: string; afterSeq: number }> = [];
			const stream = createEventStream(() => {}, {
				replay: async (sessionId, afterSeq) => {
					replayCalls.push({ sessionId, afterSeq });
					return [];
				},
			});
			await stream.start();

			await stream.hydrate('brand-new-session');

			expect(replayCalls).toEqual([{ sessionId: 'brand-new-session', afterSeq: 0 }]);

			await stream.dispose();
		});

		it('concurrent hydrate calls for the same session share one in-flight replay fetch', async () => {
			const { createEventStream } = await importHook();
			const replayCalls: Array<{ sessionId: string; afterSeq: number }> = [];
			const gate = deferred<readonly EventEnvelope[]>();
			const stream = createEventStream(() => {}, {
				replay: async (sessionId, afterSeq) => {
					replayCalls.push({ sessionId, afterSeq });
					return gate.promise;
				},
			});
			await stream.start();

			const first = stream.hydrate('concurrent');
			const second = stream.hydrate('concurrent');

			gate.resolve([]);
			await Promise.all([first, second]);

			expect(replayCalls).toHaveLength(1);

			await stream.dispose();
		});

		it('applies a long replay through one atomic batch and reports truthful progress', async () => {
			const { createEventStream } = await importHook();
			const listener = vi.fn();
			const batches: EventEnvelope[][] = [];
			const progress: Array<{ phase: string; eventCount: number }> = [];
			const history = Array.from({ length: 5_000 }, (_, index) =>
				env('long-history', `run-${Math.floor(index / 5)}`, index + 1, {
					type: 'assistant.message',
					runId: `run-${Math.floor(index / 5)}`,
					text: `event ${index + 1}`,
				}),
			).reverse();

			const stream = createEventStream(listener, {
				replay: async () => history,
				onReplayBatch: (batch) => {
					batches.push([...batch]);
				},
				onHydrationProgress: (event) => progress.push(event),
			});
			await stream.start();
			await stream.hydrate('long-history');

			expect(listener).not.toHaveBeenCalled();
			expect(batches).toHaveLength(1);
			expect(batches[0]).toHaveLength(5_000);
			expect(batches[0]?.[0]?.seq).toBe(1);
			expect(batches[0]?.[4_999]?.seq).toBe(5_000);
			expect(progress.map(({ phase, eventCount }) => `${phase}:${eventCount}`)).toEqual([
				'fetching:0',
				'applying:5000',
				'complete:5000',
			]);
			expect(stream.stats().replayed).toBe(5_000);
			await stream.dispose();
		});

		it('reports only newly accepted events when replay overlaps delivered history', async () => {
			const { createEventStream } = await importHook();
			const progress: Array<{ phase: string; eventCount: number }> = [];
			const applied: EventEnvelope[] = [];
			const first = env('overlap-history', 'run-1', 1, {
				type: 'run.started',
				runId: 'run-1',
				sessionId: 'overlap-history',
			});
			const second = env('overlap-history', 'run-1', 2, {
				type: 'assistant.message',
				runId: 'run-1',
				text: 'new tail',
			});
			const stream = createEventStream(() => {}, {
				replay: async () => [first, second],
				onReplayBatch: (batch) => {
					applied.push(...batch);
				},
				onHydrationProgress: (event) => progress.push(event),
			});
			await stream.start();
			await stream.pushReplay([first]);
			applied.length = 0;

			await stream.hydrate('overlap-history');

			expect(applied.map(({ seq }) => seq)).toEqual([2]);
			expect(progress.map(({ phase, eventCount }) => `${phase}:${eventCount}`)).toEqual([
				'fetching:0',
				'applying:1',
				'complete:1',
			]);
			await stream.dispose();
		});

		it('times out a stalled replay, keeps buffered live history gated, and reports recovery truth', async () => {
			vi.useFakeTimers();
			try {
				const { createEventStream, EventReplayTimeoutError } = await importHook();
				const received: EventEnvelope[] = [];
				const progress: Array<{ phase: string; error?: string }> = [];
				let replayAttempts = 0;
				const stream = createEventStream((event) => received.push(event), {
					replay: async () => {
						replayAttempts += 1;
						if (replayAttempts === 1) {
							return await new Promise<readonly EventEnvelope[]>(() => {});
						}
						return [
							env('stalled-history', 'run-1', 1, {
								type: 'run.started',
								runId: 'run-1',
								sessionId: 'stalled-history',
							}),
						];
					},
					replayTimeoutMs: 25,
					onHydrationProgress: (event) => progress.push(event),
				});
				await stream.start();
				const hydration = stream.hydrate('stalled-history');
				const rejectedHydration = expect(hydration).rejects.toBeInstanceOf(EventReplayTimeoutError);
				emitAgentEvent(
					env('stalled-history', 'run-1', 2, {
						type: 'assistant.message',
						runId: 'run-1',
						text: 'must stay buffered',
					}),
				);
				await vi.advanceTimersByTimeAsync(25);

				await rejectedHydration;
				expect(received).toEqual([]);
				expect(progress.map((event) => event.phase)).toEqual(['fetching', 'failed']);
				expect(progress.at(-1)?.error).toContain('did not respond');
				emitAgentEvent(
					env('stalled-history', 'run-1', 3, {
						type: 'assistant.message',
						runId: 'run-1',
						text: 'arrived while recovery was visible',
					}),
				);
				await stream.hydrate('stalled-history');
				expect(received.map((event) => event.seq)).toEqual([1, 2, 3]);
				expect(replayAttempts).toBe(2);
				await stream.dispose();
			} finally {
				vi.useRealTimers();
			}
		});

		it('does not poison replay dedupe when atomic application fails, so retry is lossless', async () => {
			const { createEventStream } = await importHook();
			let applyAttempts = 0;
			const replayCalls: number[] = [];
			const applied: number[][] = [];
			const progress: Array<{ phase: string; eventCount: number }> = [];
			const stream = createEventStream(() => {}, {
				replay: async (_sessionId, afterSeq) => {
					replayCalls.push(afterSeq);
					return [
						env('retry-history', 'run-1', 1, {
							type: 'run.started',
							runId: 'run-1',
							sessionId: 'retry-history',
						}),
					];
				},
				onReplayBatch: (batch) => {
					applyAttempts += 1;
					if (applyAttempts === 1) throw new Error('renderer transaction failed');
					applied.push(batch.map((event) => event.seq));
				},
				onHydrationProgress: (event) => progress.push(event),
			});
			await stream.start();

			await expect(stream.hydrate('retry-history')).rejects.toThrow('renderer transaction failed');
			await stream.hydrate('retry-history');

			expect(replayCalls).toEqual([0, 0]);
			expect(applied).toEqual([[1]]);
			expect(stream.lastSeenSeq('retry-history')).toBe(1);
			expect(progress.map(({ phase, eventCount }) => `${phase}:${eventCount}`)).toEqual([
				'fetching:0',
				'applying:1',
				'failed:0',
				'fetching:0',
				'applying:1',
				'complete:1',
			]);
			await stream.dispose();
		});
	});

	describe('ephemeral envelopes', () => {
		it('routes ephemeral envelopes to onEphemeral, never to the persisted listener', async () => {
			const { createEventStream } = await importHook();
			const received: EventEnvelope[] = [];
			const ephemeralReceived: EventEnvelope[] = [];

			const stream = createEventStream((e) => received.push(e), {
				onEphemeral: (e) => ephemeralReceived.push(e),
			});
			await stream.start();

			emitAgentEvent({
				sessionId: 'ephemeral-1',
				runId: 'r1',
				seq: 1,
				ephemeral: true,
				event: { type: 'assistant.delta', runId: 'r1', contentId: 'b1', text: 'Hel' },
			});

			expect(received).toEqual([]);
			expect(ephemeralReceived).toHaveLength(1);
			expect(ephemeralReceived[0]?.event).toEqual({
				type: 'assistant.delta',
				runId: 'r1',
				contentId: 'b1',
				text: 'Hel',
			});
			expect(stream.stats().ephemeral).toBe(1);
			expect(stream.stats().live).toBe(0);
			expect(stream.stats().dropped).toBe(0);

			await stream.dispose();
		});

		it('publishes a delta burst once on the next render window without waiting for a durable event', async () => {
			const { createEventStream } = await importHook();
			const batches: EventEnvelope[][] = [];
			const stream = createEventStream(() => {}, {
				ephemeralBatchWindowMs: 1,
				onEphemeralBatch: (batch) => batches.push([...batch]),
			});
			await stream.start();

			for (const text of ['one', ' two', ' three']) {
				emitAgentEvent({
					sessionId: 'frame-batch',
					runId: 'r1',
					seq: -1,
					ephemeral: true,
					event: { type: 'assistant.delta', runId: 'r1', contentId: 'b1', text },
				});
			}
			expect(batches).toEqual([]);
			await vi.waitFor(() => expect(batches).toHaveLength(1), { timeout: 100 });
			expect(batches[0]?.map(({ event }) => event.type)).toEqual([
				'assistant.delta',
				'assistant.delta',
				'assistant.delta',
			]);

			await stream.dispose();
		});

		it('never touches lastSeenSeq / dedupe state for the session it streams over', async () => {
			const { createEventStream } = await importHook();
			const received: EventEnvelope[] = [];

			const stream = createEventStream((e) => received.push(e), { onEphemeral: () => {} });
			await stream.start();

			emitAgentEvent({
				sessionId: 'ephemeral-2',
				runId: 'r1',
				seq: 5,
				ephemeral: true,
				event: { type: 'assistant.delta', runId: 'r1', contentId: 'b1', text: 'chunk' },
			});
			expect(stream.lastSeenSeq('ephemeral-2')).toBe(0);

			emitAgentEvent(
				env('ephemeral-2', 'r1', 1, { type: 'run.started', runId: 'r1', sessionId: 'ephemeral-2' }),
			);

			expect(received.map((e) => e.seq)).toEqual([1]);
			expect(stream.lastSeenSeq('ephemeral-2')).toBe(1);

			await stream.dispose();
		});

		it('delivers ephemeral envelopes immediately even while their session is mid-hydration', async () => {
			const { createEventStream } = await importHook();
			const received: EventEnvelope[] = [];
			const ephemeralReceived: EventEnvelope[] = [];
			const gate = deferredForTest<readonly EventEnvelope[]>();

			const stream = createEventStream((e) => received.push(e), {
				replay: async () => gate.promise,
				onEphemeral: (e) => ephemeralReceived.push(e),
			});
			await stream.start();

			const hydratePromise = stream.hydrate('ephemeral-during-hydration');

			emitAgentEvent({
				sessionId: 'ephemeral-during-hydration',
				runId: 'r1',
				seq: 2,
				ephemeral: true,
				event: { type: 'assistant.delta', runId: 'r1', contentId: 'b1', text: 'mid-hydration' },
			});

			expect(ephemeralReceived).toHaveLength(1);

			gate.resolve([]);
			await hydratePromise;

			expect(received).toEqual([]);
			await stream.dispose();
		});

		it('keeps a 10k-chunk Edit stream bounded and advances the durable run to completed', async () => {
			const { createEventStream } = await importHook();
			const batchSizes: number[] = [];
			const durableTypes: string[] = [];
			const sessionId = 'large-edit-session';
			const runId = 'large-edit-run';
			const stream = createEventStream(
				(envelope) => {
					durableTypes.push(envelope.event.type);
					sessionsAggregate.applyEvent(envelope);
				},
				{
					ephemeralBatchWindowMs: 60_000,
					onEphemeralBatch: (batch) => {
						batchSizes.push(batch.length);
						streamingStore.applyEphemeralBatch(batch);
					},
				},
			);
			await stream.start();

			emitAgentEvent(
				env(sessionId, runId, 1, {
					type: 'run.started',
					runId,
					sessionId,
				}),
			);
			for (let index = 0; index < 10_000; index += 1) {
				emitAgentEvent({
					sessionId,
					runId,
					seq: -1,
					ephemeral: true,
					event: {
						type: 'tool.input.delta',
						runId,
						toolCallId: 'edit-1',
						name: 'Edit',
						inputJsonDelta: 'x'.repeat(128),
					},
				});
			}

			emitAgentEvent(
				env(sessionId, runId, 2, {
					type: 'tool.started',
					runId,
					name: 'Edit',
					toolCallId: 'edit-1',
					input: { file_path: 'src/large.ts' },
				}),
			);
			emitAgentEvent(
				env(sessionId, runId, 3, {
					type: 'file.changed',
					runId,
					path: 'src/large.ts',
				}),
			);
			emitAgentEvent(
				env(sessionId, runId, 4, {
					type: 'tool.completed',
					runId,
					name: 'Edit',
					toolCallId: 'edit-1',
				}),
			);
			emitAgentEvent(
				env(sessionId, runId, 5, {
					type: 'run.completed',
					runId,
					summary: 'large edit complete',
				}),
			);

			expect(batchSizes).toEqual([10_000]);
			expect(streamingStore.ingestionStats().reactiveCommits).toBe(1);
			expect(durableTypes).toEqual([
				'run.started',
				'tool.started',
				'file.changed',
				'tool.completed',
				'run.completed',
			]);
			expect(sessionsAggregate.getSession(sessionId)).toMatchObject({
				status: 'completed',
				currentRunId: null,
			});
			expect(sessionsAggregate.getCurrentRun(sessionId)).toBeNull();
			expect(stream.stats()).toMatchObject({ ephemeral: 10_000, live: 5 });

			await stream.dispose();
		});
	});

	describe('out-of-order persisted arrival', () => {
		it('accepts a lower live seq that arrives after a higher one instead of dropping it as stale', async () => {
			const { createEventStream } = await importHook();
			const received: EventEnvelope[] = [];
			const replayCalls: Array<{ sessionId: string; afterSeq: number }> = [];

			const stream = createEventStream((e) => received.push(e), {
				replay: async (sessionId, afterSeq) => {
					replayCalls.push({ sessionId, afterSeq });
					return [
						env('gap-race', 'r1', 1, {
							type: 'run.started',
							runId: 'r1',
							sessionId: 'gap-race',
						}),
						env('gap-race', 'r1', 2, {
							type: 'assistant.message',
							runId: 'r1',
							text: 'second',
						}),
					];
				},
			});
			await stream.start();

			emitAgentEvent(
				env('gap-race', 'r1', 2, { type: 'assistant.message', runId: 'r1', text: 'second' }),
			);
			expect(received.map((e) => e.seq)).toEqual([2]);
			expect(stream.lastSeenSeq('gap-race')).toBe(2);

			emitAgentEvent(
				env('gap-race', 'r1', 1, { type: 'run.started', runId: 'r1', sessionId: 'gap-race' }),
			);

			expect(replayCalls).toEqual([]);
			expect(received.map((e) => e.seq)).toEqual([2, 1]);
			expect(stream.lastSeenSeq('gap-race')).toBe(2);

			await stream.dispose();
		});
	});
});

function deferredForTest<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}
