import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import {
	FrameJournal,
	MAX_ENTRIES_PER_MINUTE,
	MAX_SCRIPTS_PER_FRAME,
	rendererFrames,
	type FrameJournalDeps,
	type FrameJournalEntry,
} from './frame-journal';

const SCRIPT = {
	invoker: 'DIV.onclick',
	source: 'index.js:120 selectWorkstream',
	durationMs: 90.2,
	forcedLayoutMs: 12,
};

const FRAME = {
	kind: 'long-frame',
	startedAt: Date.parse('2026-11-04T10:00:00.000Z'),
	durationMs: 120.4,
	focused: true,
	route: '/workstreams/ws-1',
	layoutMs: 30.2,
	blockingMs: 70.4,
	scripts: [SCRIPT],
};

function journal(overrides: Partial<FrameJournalDeps> = {}): {
	journal: FrameJournal;
	written: FrameJournalEntry[];
} {
	const written: FrameJournalEntry[] = [];
	return {
		written,
		journal: new FrameJournal({
			write: (entry) => written.push(entry),
			browserTabs: () => [
				{ processId: 11, title: 'localhost', shown: true },
				{ processId: 12, title: 'docs', shown: false },
			],
			displayHz: () => 120,
			...overrides,
		}),
	};
}

describe('rendererFrames', () => {
	it('keeps well-formed frames, drops malformed ones and redacts what could carry a secret', () => {
		const frames = rendererFrames({
			frames: [
				{ ...FRAME, route: '/workstreams/ws-1?token=abc' },
				{ ...FRAME, durationMs: Number.NaN },
				{ ...FRAME, kind: 'paint' },
				'junk',
				{
					...FRAME,
					scripts: Array.from({ length: 9 }, () => ({
						...SCRIPT,
						invoker: 'fetch sk-ant-api03-abcdefghijklmnopqrstuvwx',
					})),
				},
			],
		});

		expect(frames).toHaveLength(2);
		expect(frames[0]?.route).toBe('/workstreams/ws-1?token=%5Bredacted%5D');
		expect(frames[1]?.scripts).toHaveLength(MAX_SCRIPTS_PER_FRAME);
		expect(frames[1]?.scripts[0]?.invoker).not.toContain('sk-ant-api03');
		expect(() => rendererFrames({ frames: 'many' })).toThrow('`frames` must be an array');
	});
});

describe('FrameJournal', () => {
	it('journals a slow frame with the frames the display missed and the pages open beside it', () => {
		const { journal: frames, written } = journal();

		frames.recordRendererFrames({ frames: [FRAME] });

		expect(written).toEqual([
			{
				schemaVersion: 1,
				occurredAt: '2026-11-04T10:00:00.000Z',
				process: 'renderer',
				kind: 'long-frame',
				durationMs: 120,
				cpuMs: null,
				droppedFrames: 13,
				displayHz: 120,
				focused: true,
				route: '/workstreams/ws-1',
				browser: { open: 2, shown: 1 },
				layoutMs: 30,
				blockingMs: 70,
				scripts: [{ ...SCRIPT, durationMs: 90 }],
				suppressedBefore: 0,
			},
		]);
	});

	it('writes at most its budget a minute and says how many frames it left out', () => {
		let now = 0;
		const { journal: frames, written } = journal({ now: () => now });

		frames.recordRendererFrames({ frames: Array.from({ length: 64 }, () => FRAME) });
		frames.recordRendererFrames({ frames: Array.from({ length: 64 }, () => FRAME) });
		now = 60_000;
		frames.recordRendererFrames({ frames: [FRAME] });

		expect(written).toHaveLength(MAX_ENTRIES_PER_MINUTE + 1);
		expect(written.at(-1)?.suppressedBefore).toBe(128 - MAX_ENTRIES_PER_MINUTE);
	});

	it("journals a stall of the thread it watches with the thread's own work in it", async () => {
		const { journal: frames, written } = journal();

		frames.watchStalls();
		await sleep(40);
		const busyFrom = process.threadCpuUsage();
		while (process.threadCpuUsage(busyFrom).user < 150_000);
		await sleep(40);
		frames.stopWatchingStalls();

		expect(
			written.some(
				(entry) =>
					entry.process === 'main' &&
					entry.kind === 'stall' &&
					entry.durationMs >= 100 &&
					(entry.cpuMs ?? 0) >= 100,
			),
		).toBe(true);
	});
});
