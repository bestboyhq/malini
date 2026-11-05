import { describe, expect, it } from 'vitest';
import type { EventEnvelope } from '$lib/chat/domain/events';
import { IncrementalRenderProjector } from './render-projector';
import { IncrementalRunTimelineProjector } from './incremental-run-timeline';
import { windowRunTimeline } from './run-timeline-window';
import { foldEnvelopes, type RenderState, type RunGroup } from './render-state';
import { linearizeRunTimeline, type RunTimelineItem } from './run-timeline';

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

	it('folds every subagent step into its agent row, live and replayed, across a handoff', () => {
		const at = (runId: string, seq: number, event: EventEnvelope['event']): EventEnvelope => ({
			sessionId: 'session-1',
			runId,
			seq,
			event,
		});
		const child = { parentToolCallId: 'agent-1' };
		const envelopes: EventEnvelope[] = [
			at('run-1', 1, { type: 'run.started', runId: 'run-1', sessionId: 'session-1' }),
			at('run-1', 2, { type: 'user.message', runId: 'run-1', text: 'Map the auth flow' }),
			at('run-1', 3, {
				type: 'tool.started',
				runId: 'run-1',
				name: 'Agent',
				toolCallId: 'agent-1',
				input: { description: 'Map auth', prompt: 'Map it.', run_in_background: true },
			}),
			at('run-1', 4, {
				type: 'tool.started',
				runId: 'run-1',
				name: 'Read',
				toolCallId: 'read-1',
				input: { file_path: 'src/auth.ts' },
				...child,
			}),
			at('run-1', 5, { type: 'tool.started', runId: 'run-1', name: 'Glob', toolCallId: 'stray' }),
			at('run-1', 6, {
				type: 'tool.completed',
				runId: 'run-1',
				name: 'Read',
				toolCallId: 'read-1',
				output: 'export {}',
				...child,
			}),
			at('run-1', 7, {
				type: 'tool.started',
				runId: 'run-1',
				name: 'Bash',
				toolCallId: 'bash-1',
				input: { command: 'rg token', description: 'Find token use' },
				...child,
			}),
			at('run-1', 8, { type: 'run.completed', runId: 'run-1', summary: '', handedOff: true }),
			at('run-2', 9, { type: 'run.started', runId: 'run-2', sessionId: 'session-1' }),
			at('run-2', 10, { type: 'user.message', runId: 'run-2', text: 'How is it going?' }),
			at('run-2', 11, {
				type: 'tool.completed',
				runId: 'run-2',
				name: 'Bash',
				toolCallId: 'bash-1',
				output: 'src/auth.ts',
				...child,
			}),
			at('run-2', 12, {
				type: 'command.completed',
				runId: 'run-2',
				command: 'rg token',
				exitCode: 0,
				...child,
			}),
			at('run-2', 13, { type: 'file.changed', runId: 'run-2', path: 'notes.md', ...child }),
			at('run-2', 14, {
				type: 'tool.started',
				runId: 'run-2',
				name: 'SubagentHandback',
				toolCallId: 'handback-1',
				input: { message: '## Auth runs through `src/auth.ts`' },
				...child,
			}),
			at('run-2', 15, {
				type: 'tool.completed',
				runId: 'run-2',
				name: 'Agent',
				toolCallId: 'agent-1',
				output: 'Report delivered.',
			}),
			at('run-2', 16, { type: 'assistant.message', runId: 'run-2', text: 'Still mapping.' }),
		];
		const renderProjector = new IncrementalRenderProjector();
		const timelineProjector = new IncrementalRunTimelineProjector();
		const shape = (items: readonly RunTimelineItem[]): unknown[] =>
			items.map((item) =>
				item.kind === 'subagent'
					? [item.tool.status, item.steps.map((step) => step.tool.name), item.report]
					: item.kind,
			);
		let live: unknown[][] = [];

		for (let length = 1; length <= envelopes.length; length += 1) {
			const prefix = envelopes.slice(0, length);
			const runs = renderProjector.project(prefix).runs;
			const replayed = foldEnvelopes(prefix).runs;
			live = runs.map((run) => {
				const timeline = timelineProjector.project(run, []);
				expect(timeline).toEqual(linearizeRunTimeline(run, []));
				return shape(timeline);
			});
			expect(live).toEqual(replayed.map((run) => shape(linearizeRunTimeline(run, []))));
		}

		expect(live).toEqual([
			['user', ['completed', ['Read', 'Bash'], '## Auth runs through `src/auth.ts`'], 'file'],
			['user', 'assistant'],
		]);
	});
});
