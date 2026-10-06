import { describe, expect, it } from 'vitest';
import type { AgentEvent, EventEnvelope } from '$lib/chat/domain/events';
import { IncrementalRenderProjector } from './render-projector';
import {
	CONTEXT_HANDOFF_CONTENT_ID_PREFIX,
	foldEnvelopes,
	type RenderItem,
	type RenderState,
	type RunGroup,
} from './render-state';

function firstRun(state: RenderState): RunGroup {
	const run = state.runs[0];
	if (!run) throw new Error('expected a run');
	return run;
}

function envelope(seq: number, event: AgentEvent): EventEnvelope {
	return { sessionId: 'session-1', runId: 'run-1', seq, event };
}

describe('IncrementalRenderProjector', () => {
	it('matches the canonical fold through a multi-stage tool run', () => {
		const envelopes = [
			envelope(1, { type: 'user.message', runId: 'run-1', text: 'Inspect and edit' }),
			envelope(2, {
				type: 'tool.started',
				runId: 'run-1',
				name: 'Read',
				toolCallId: 'read-1',
				input: { path: 'src/app.ts' },
			}),
			envelope(3, {
				type: 'tool.completed',
				runId: 'run-1',
				name: 'Read',
				toolCallId: 'read-1',
				output: 'before',
			}),
			envelope(4, { type: 'assistant.message', runId: 'run-1', text: 'Found it.' }),
			envelope(5, {
				type: 'tool.started',
				runId: 'run-1',
				name: 'Edit',
				toolCallId: 'edit-1',
				input: { path: 'src/app.ts' },
			}),
			envelope(6, {
				type: 'tool.completed',
				runId: 'run-1',
				name: 'Edit',
				toolCallId: 'edit-1',
				output: 'ok',
			}),
			envelope(7, { type: 'run.completed', runId: 'run-1', summary: 'Done' }),
		];
		const projector = new IncrementalRenderProjector();

		for (let length = 0; length <= envelopes.length; length += 1) {
			expect(projector.project(envelopes.slice(0, length))).toEqual(
				foldEnvelopes(envelopes.slice(0, length)),
			);
		}
	});

	it('processes each normal live append once instead of refolding the transcript', () => {
		const projector = new IncrementalRenderProjector();
		const envelopes: EventEnvelope[] = [];
		for (let seq = 1; seq <= 5_000; seq += 1) {
			envelopes.push(
				envelope(seq, { type: 'assistant.message', runId: 'run-1', text: `chunk ${seq}` }),
			);
			projector.project(envelopes);
		}

		expect(projector.stats()).toEqual({ processedEnvelopeCount: 5_000, rebuildCount: 0 });
		expect(firstRun(projector.project(envelopes)).items).toHaveLength(5_000);
	});

	it('projects a context handoff as a relay row on the live path, exactly as the fold does', () => {
		const envelopes = [
			envelope(1, { type: 'user.message', runId: 'run-1', text: 'Refactor the projector' }),
			envelope(2, { type: 'assistant.message', runId: 'run-1', text: 'Reading it now.' }),
			envelope(3, {
				type: 'assistant.message',
				runId: 'run-1',
				contentId: `${CONTEXT_HANDOFF_CONTENT_ID_PREFIX}1`,
				text: 'Context is full. Handing the work to a fresh run.',
			}),
			envelope(4, {
				type: 'assistant.message',
				runId: 'run-1',
				contentId: 'block-9',
				text: 'Picking it back up.',
			}),
		];
		const projector = new IncrementalRenderProjector();

		for (let length = 0; length <= envelopes.length; length += 1) {
			expect(projector.project(envelopes.slice(0, length))).toEqual(
				foldEnvelopes(envelopes.slice(0, length)),
			);
		}

		const items = firstRun(projector.project(envelopes)).items;
		expect(items.map(({ kind }) => kind)).toEqual(['user', 'assistant', 'handoff', 'assistant']);
		expect(
			items
				.filter((item): item is Extract<RenderItem, { kind: 'assistant' }> => {
					return item.kind === 'assistant';
				})
				.map((item) => item.text),
		).toEqual(['Reading it now.', 'Picking it back up.']);
		expect(projector.stats().rebuildCount).toBe(0);
	});

	it('matches the canonical replay projection for de-duplicated interactions without inner session ids', () => {
		const approval = envelope(1, {
			type: 'approval.requested',
			runId: 'run-1',
			approvalId: 'approval-1',
			reason: 'Read outside',
		});
		const replay = { ...approval, seq: 2 };
		const question = envelope(3, {
			type: 'question.requested',
			runId: 'run-1',
			questionId: 'question-1',
			questions: [
				{
					id: 'question-1:0',
					prompt: 'Continue?',
					options: [{ label: 'Yes' }],
					multiSelect: false,
					allowFreeText: false,
				},
			],
		});
		const envelopes = [approval, replay, question];
		const projector = new IncrementalRenderProjector();

		expect(projector.project(envelopes)).toEqual(foldEnvelopes(envelopes));
		expect(firstRun(projector.project(envelopes)).items.map(({ kind }) => kind)).toEqual([
			'approval',
			'question',
		]);
	});

	it('publishes terminal metadata after a synchronous live failure burst', () => {
		const projector = new IncrementalRenderProjector();
		const envelopes = [envelope(1, { type: 'user.message', runId: 'run-1', text: 'Try it' })];
		const openRun = firstRun(projector.project(envelopes));

		envelopes.push(
			envelope(2, { type: 'run.started', runId: 'run-1', sessionId: 'session-1' }),
			envelope(3, { type: 'run.failed', runId: 'run-1', error: 'Provider unavailable' }),
		);
		const failedRun = firstRun(projector.project(envelopes));

		expect(failedRun).not.toBe(openRun);
		expect(failedRun.items).not.toBe(openRun.items);
		expect(openRun.terminal).toBeNull();
		expect(openRun.items).toHaveLength(1);
		expect(failedRun.terminal).toBe('failed');
		expect(failedRun.terminalText).toBe('Provider unavailable');
		expect(failedRun.items.at(-1)).toMatchObject({
			kind: 'terminal',
			terminal: 'failed',
			text: 'Provider unavailable',
		});
		expect(projector.stats()).toEqual({ processedEnvelopeCount: 3, rebuildCount: 0 });
	});

	it('rebuilds when replay inserts an older canonical event', () => {
		const projector = new IncrementalRenderProjector();
		const later = envelope(30, {
			type: 'assistant.message',
			runId: 'run-1',
			text: 'later',
		});
		const earlier = envelope(20, {
			type: 'assistant.message',
			runId: 'run-1',
			text: 'earlier',
		});

		projector.project([later]);
		const rebuilt = projector.project([earlier, later]);
		expect(firstRun(rebuilt).items.map((item) => item.seq)).toEqual([20, 30]);
		expect(projector.stats()).toEqual({ processedEnvelopeCount: 3, rebuildCount: 1 });
	});

	it('rebuilds for a same-length earlier replacement or reorder with an unchanged tail', () => {
		const projector = new IncrementalRenderProjector();
		const first = envelope(1, {
			type: 'assistant.message',
			runId: 'run-1',
			text: 'first',
		});
		const second = envelope(2, {
			type: 'assistant.message',
			runId: 'run-1',
			text: 'second',
		});
		const tail = envelope(3, {
			type: 'assistant.message',
			runId: 'run-1',
			text: 'tail',
		});
		projector.project([first, second, tail]);

		const replacement = envelope(1, {
			type: 'assistant.message',
			runId: 'run-1',
			text: 'replacement',
		});
		const replaced = projector.project([replacement, second, tail]);
		expect(firstRun(replaced).items.map((item) => item.kind === 'assistant' && item.text)).toEqual([
			'replacement',
			'second',
			'tail',
		]);

		const reordered = projector.project([second, replacement, tail]);
		expect(firstRun(reordered).items.map((item) => item.seq)).toEqual([2, 1, 3]);
		expect(projector.stats()).toEqual({ processedEnvelopeCount: 9, rebuildCount: 2 });
	});

	it('marks a command failed only when its own tool call reported an error, exactly as the fold does', () => {
		const envelopes = [
			envelope(1, {
				type: 'tool.started',
				runId: 'run-1',
				name: 'bash',
				toolCallId: 'bash-1',
				input: { command: 'grep -rn nothing src' },
			}),
			envelope(2, { type: 'command.started', runId: 'run-1', command: 'grep -rn nothing src' }),
			envelope(3, {
				type: 'command.completed',
				runId: 'run-1',
				command: 'grep -rn nothing src',
				exitCode: 1,
			}),
			envelope(4, {
				type: 'tool.completed',
				runId: 'run-1',
				name: 'bash',
				toolCallId: 'bash-1',
				output: { exitCode: 1 },
			}),
			envelope(5, {
				type: 'tool.started',
				runId: 'run-1',
				name: 'bash',
				toolCallId: 'bash-2',
				input: { command: 'pnpm build' },
			}),
			envelope(6, { type: 'command.started', runId: 'run-1', command: 'pnpm build' }),
			envelope(7, {
				type: 'command.completed',
				runId: 'run-1',
				command: 'pnpm build',
				exitCode: 124,
			}),
			envelope(8, {
				type: 'tool.failed',
				runId: 'run-1',
				name: 'bash',
				toolCallId: 'bash-2',
				error: 'command timed out',
			}),
		];
		const projector = new IncrementalRenderProjector();

		function commandRows(state: RenderState): Extract<RenderItem, { kind: 'command' }>[] {
			return (state.runs[0]?.items ?? [])
				.filter((item): item is Extract<RenderItem, { kind: 'command' }> => item.kind === 'command')
				.sort((left, right) => left.seq - right.seq);
		}

		for (let length = 0; length <= envelopes.length; length += 1) {
			const prefix = envelopes.slice(0, length);
			expect(commandRows(projector.project(prefix))).toEqual(commandRows(foldEnvelopes(prefix)));
		}

		expect(commandRows(projector.project(envelopes)).map((item) => item.error ?? null)).toEqual([
			null,
			'command timed out',
		]);
	});
});
