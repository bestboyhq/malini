import { describe, expect, it } from 'vitest';
import type { EventEnvelope } from '$lib/chat/domain/events';
import { IncrementalRenderProjector } from './render-projector';
import { IncrementalRunTimelineProjector } from './incremental-run-timeline';
import { windowRunTimeline } from './run-timeline-window';
import type { RenderState, RunGroup } from './render-state';

function firstRun(state: RenderState): RunGroup {
	const run = state.runs[0];
	if (!run) throw new Error('expected a run');
	return run;
}

function assistant(seq: number): EventEnvelope {
	return {
		sessionId: 'session-1',
		runId: 'run-1',
		seq,
		event: { type: 'assistant.message', runId: 'run-1', text: `live ${seq}` },
	};
}

function envelope(seq: number, event: EventEnvelope['event']): EventEnvelope {
	return { sessionId: 'session-1', runId: 'run-1', seq, event };
}

function replayEdit(toolName: string, toolPath: string, changedPath: string): string[][] {
	const renderProjector = new IncrementalRenderProjector();
	const timelineProjector = new IncrementalRunTimelineProjector();
	const envelopes: EventEnvelope[] = [];
	const frames: string[][] = [];

	for (const next of [
		envelope(1, { type: 'run.started', runId: 'run-1', sessionId: 'session-1' }),
		envelope(2, {
			type: 'tool.started',
			runId: 'run-1',
			name: toolName,
			toolCallId: 'call-1',
			input: { file_path: toolPath },
		}),
		envelope(3, { type: 'file.changed', runId: 'run-1', path: changedPath }),
		envelope(4, {
			type: 'tool.completed',
			runId: 'run-1',
			name: toolName,
			toolCallId: 'call-1',
			output: 'ok',
		}),
	]) {
		envelopes.push(next);
		const run = firstRun(renderProjector.project(envelopes));
		frames.push(run ? timelineProjector.project(run, []).map((item) => item.kind) : []);
	}
	return frames;
}

describe('IncrementalRunTimelineProjector', () => {
	it('projects and windows 5k one-by-one live rows without rebuilding the run', () => {
		const renderProjector = new IncrementalRenderProjector();
		const timelineProjector = new IncrementalRunTimelineProjector();
		const envelopes: EventEnvelope[] = [];
		let mountedCount = 0;

		for (let seq = 1; seq <= 5_000; seq += 1) {
			envelopes.push(assistant(seq));
			const run = firstRun(renderProjector.project(envelopes));
			const timeline = timelineProjector.project(run, []);
			mountedCount = windowRunTimeline(timeline, 200).items.length;
		}

		expect(mountedCount).toBe(200);
		expect(timelineProjector.stats()).toEqual({
			processedChanges: 4_999,
			rebuildCount: 1,
		});
	});

	it('rebuilds once when canonical replay inserts a lower sequence', () => {
		const renderProjector = new IncrementalRenderProjector();
		const timelineProjector = new IncrementalRunTimelineProjector();
		const later = assistant(30);
		const earlier = assistant(20);

		let run = firstRun(renderProjector.project([later]));
		timelineProjector.project(run, []);
		run = firstRun(renderProjector.project([earlier, later]));
		const timeline = timelineProjector.project(run, []);

		expect(timeline.map((item) => item.seq)).toEqual([20, 30]);
		expect(timelineProjector.stats().rebuildCount).toBe(2);
	});

	it.each([
		['Edit', 'src/app.ts', 'src/app.ts'],
		['MultiEdit', 'src/app.ts', 'src/app.ts'],
		['NotebookEdit', 'analysis.ipynb', 'analysis.ipynb'],
		['apply_patch', 'src/app.ts', 'src/app.ts'],
		['str_replace_editor', 'src/app.ts', 'src/app.ts'],
		['Edit', '/tmp/checkout/src/app.ts', 'src/app.ts'],
		['Edit', './src/app.ts', 'src/app.ts'],
	])('never shows then removes a %s change row for %s', (toolName, toolPath, changedPath) => {
		const frames = replayEdit(toolName, toolPath, changedPath);

		expect(frames.at(-1)).toEqual(['tool']);
		for (const frame of frames) {
			expect(frame).not.toContain('file');
		}
	});

	it('keeps an unrelated change row visible in every frame', () => {
		const frames = replayEdit('Edit', 'src/app.ts', 'src/other.ts');

		expect(frames.at(-1)).toEqual(['tool', 'file']);
		const firstWithFile = frames.findIndex((frame) => frame.includes('file'));
		expect(firstWithFile).toBeGreaterThan(-1);
		for (const frame of frames.slice(firstWithFile)) {
			expect(frame).toContain('file');
		}
	});
});
