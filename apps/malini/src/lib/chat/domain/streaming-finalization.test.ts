import { describe, expect, it } from 'vitest';
import type { AgentEvent, EventEnvelope } from './events';
import type { SessionId } from './session';
import type {
	FinalizedStreamingThought,
	FinalizedThoughtRecorder,
	StreamingBlockRegistry,
} from './streaming-block';
import { processStreamingEnvelopes } from './streaming-finalization';

const SESSION: SessionId = 'session-1';

function envelope(event: AgentEvent, seq = 1): EventEnvelope {
	return { sessionId: SESSION, runId: 'run-1', seq, event };
}

function fakeRegistry(
	finalized: Record<string, { text: string; durationMs: number }> = {},
): StreamingBlockRegistry & {
	finalizedBlocks: string[];
	finalizedToolInputs: string[];
	clearedRuns: string[];
} {
	const finalizedBlocks: string[] = [];
	const finalizedToolInputs: string[] = [];
	const clearedRuns: string[] = [];
	return {
		finalizedBlocks,
		finalizedToolInputs,
		clearedRuns,
		finalizeBlock: (sessionId, runId, contentId) => {
			finalizedBlocks.push(`${sessionId}:${runId}:${contentId}`);
			return finalized[contentId] ?? null;
		},
		finalizeToolInput: (_sessionId, runId, toolCallId) => {
			finalizedToolInputs.push(`${runId}:${toolCallId}`);
			return null;
		},
		clearRun: (sessionId, runId) => {
			clearedRuns.push(`${sessionId}:${runId}`);
		},
	};
}

function fakeProjector(): FinalizedThoughtRecorder & {
	thoughts: FinalizedStreamingThought[];
} {
	const thoughts: FinalizedStreamingThought[] = [];
	return {
		thoughts,
		recordFinalizedThought(thought) {
			thoughts.push(thought);
			return true;
		},
	};
}

describe('retiring a live block when its persisted copy lands', () => {
	it('finalizes an assistant block by the content id the provider gave it', () => {
		const registry = fakeRegistry();
		processStreamingEnvelopes(
			[envelope({ type: 'assistant.message', runId: 'run-1', text: 'done', contentId: 'c1' })],
			fakeProjector(),
			registry,
		);
		expect(registry.finalizedBlocks).toEqual([`${SESSION}:run-1:c1`]);
	});

	it('leaves an assistant block alone when the envelope carries no content id', () => {
		const registry = fakeRegistry();
		processStreamingEnvelopes(
			[envelope({ type: 'assistant.message', runId: 'run-1', text: 'done' })],
			fakeProjector(),
			registry,
		);
		expect(registry.finalizedBlocks).toEqual([]);
	});

	it('finalizes a tool input on any of the three terminal tool events', () => {
		const registry = fakeRegistry();
		processStreamingEnvelopes(
			[
				envelope({ type: 'tool.started', runId: 'run-1', name: 'Bash', toolCallId: 't1' }),
				envelope({ type: 'tool.completed', runId: 'run-1', name: 'Bash', toolCallId: 't2' }),
				envelope({
					type: 'tool.failed',
					runId: 'run-1',
					name: 'Bash',
					toolCallId: 't3',
					error: 'failed',
				}),
			],
			fakeProjector(),
			registry,
		);
		expect(registry.finalizedToolInputs).toEqual(['run-1:t1', 'run-1:t2', 'run-1:t3']);
	});

	it('drops everything the run was still streaming once the run ends', () => {
		const registry = fakeRegistry();
		processStreamingEnvelopes(
			[envelope({ type: 'run.completed', runId: 'run-1', summary: 'done' })],
			fakeProjector(),
			registry,
		);
		expect(registry.clearedRuns).toEqual([`${SESSION}:run-1`]);
	});
});

describe('publishing a finished thought', () => {
	it('prefers the streamed text over the envelope text, and reports the change', () => {
		const projector = fakeProjector();
		const changed = processStreamingEnvelopes(
			[
				envelope(
					{
						type: 'thinking.message',
						runId: 'run-1',
						contentId: 'c1',
						text: 'summary',
					},
					7,
				),
			],
			projector,
			fakeRegistry({ c1: { text: 'the whole thought', durationMs: 4200 } }),
		);
		expect(changed).toBe(true);
		expect(projector.thoughts).toEqual([
			{
				sessionId: SESSION,
				runId: 'run-1',
				contentId: 'c1',
				seq: 7,
				text: 'the whole thought',
				durationSeconds: 4,
			},
		]);
	});

	it('never reports a thought as having taken zero seconds', () => {
		const projector = fakeProjector();
		processStreamingEnvelopes(
			[envelope({ type: 'thinking.message', runId: 'run-1', contentId: 'c1', text: 'x' })],
			projector,
			fakeRegistry({ c1: { text: 'x', durationMs: 120 } }),
		);
		expect(projector.thoughts[0]?.durationSeconds).toBe(1);
	});

	it('falls back to the envelope when nothing was streamed for it', () => {
		const projector = fakeProjector();
		processStreamingEnvelopes(
			[envelope({ type: 'thinking.message', runId: 'run-1', contentId: 'c1', text: 'from disk' })],
			projector,
			fakeRegistry(),
		);
		expect(projector.thoughts[0]).toMatchObject({ text: 'from disk', durationSeconds: null });
	});

	it('reports no change when the batch held no thoughts', () => {
		expect(
			processStreamingEnvelopes(
				[envelope({ type: 'tool.started', runId: 'run-1', name: 'Bash', toolCallId: 't1' })],
				fakeProjector(),
				fakeRegistry(),
			),
		).toBe(false);
	});
});
