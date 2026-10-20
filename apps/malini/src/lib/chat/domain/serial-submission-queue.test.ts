import { describe, expect, it } from 'vitest';

import { SerialSubmissionQueue } from './serial-submission-queue';

describe('SerialSubmissionQueue', () => {
	it('snapshots every accepted submission while the first callback is still pending', async () => {
		let releaseFirst!: () => void;
		const firstPending = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const consumed: string[] = [];
		const pending: number[] = [];
		const queue = new SerialSubmissionQueue<string>({
			consume: async (item) => {
				consumed.push(item);
				if (item === 'first') await firstPending;
			},
			onPendingChange: (count) => pending.push(count),
		});

		queue.enqueue('first');
		queue.enqueue('second');
		queue.enqueue('third');

		expect(consumed).toEqual(['first']);
		expect(queue.pending).toBe(3);
		releaseFirst();
		await queue.whenIdle();

		expect(consumed).toEqual(['first', 'second', 'third']);
		expect(pending).toEqual([1, 2, 3, 2, 1, 0]);
	});

	it('recovers a rejected snapshot without blocking later submissions', async () => {
		const consumed: string[] = [];
		const failed: Array<{ item: string; error: unknown }> = [];
		const failure = new Error('provider unavailable');
		const queue = new SerialSubmissionQueue<string>({
			consume: async (item) => {
				consumed.push(item);
				if (item === 'first') throw failure;
			},
			onFailure: (item, error) => failed.push({ item, error }),
		});

		queue.enqueue('first');
		queue.enqueue('second');
		await queue.whenIdle();

		expect(consumed).toEqual(['first', 'second']);
		expect(failed).toEqual([{ item: 'first', error: failure }]);
		expect(queue.pending).toBe(0);
	});

	it('keeps workstream, model, and profile snapshots distinct while controls change', async () => {
		type Turn = Readonly<{
			workstreamId: string;
			model: string;
			profile: Readonly<{ mode: 'plan' | 'agent'; effort: string }>;
		}>;
		let releaseFirst!: () => void;
		const firstPending = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const consumed: Turn[] = [];
		const queue = new SerialSubmissionQueue<Turn>({
			consume: async (turn) => {
				consumed.push(turn);
				if (consumed.length === 1) await firstPending;
			},
		});

		queue.enqueue({
			workstreamId: 'workstream-a',
			model: 'claude-opus-4-8',
			profile: { mode: 'plan', effort: 'high' },
		});
		queue.enqueue({
			workstreamId: 'workstream-b',
			model: 'gpt-5.6-terra',
			profile: { mode: 'agent', effort: 'xhigh' },
		});
		releaseFirst();
		await queue.whenIdle();

		expect(consumed).toEqual([
			{
				workstreamId: 'workstream-a',
				model: 'claude-opus-4-8',
				profile: { mode: 'plan', effort: 'high' },
			},
			{
				workstreamId: 'workstream-b',
				model: 'gpt-5.6-terra',
				profile: { mode: 'agent', effort: 'xhigh' },
			},
		]);
	});
});
