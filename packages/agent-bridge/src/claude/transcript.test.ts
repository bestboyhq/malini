import { describe, expect, it } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from '../types.js';
import { recordedMessages, type RecordedScenario } from './fixtures/fake-claude.js';
import { ClaudeTranscript } from './transcript.js';

const SUBAGENT_TOOL_CALL = 'toolu_01FeTa8kst16VYXGjiDS1bL9';
const BACKGROUND_AGENT_TOOL_CALL = 'toolu_012Qe9FFbcvw55RGnwjEQhkH';

function replay(messages: readonly SDKMessage[]): {
	events: AgentEvent[];
	transcript: ClaudeTranscript;
} {
	const events: AgentEvent[] = [];
	const transcript = new ClaudeTranscript('run-1', (event) => events.push(event));
	for (const message of messages) transcript.accept(message);
	return { events, transcript };
}

function replayRecorded(scenario: RecordedScenario): ReturnType<typeof replay> {
	return replay(recordedMessages(scenario));
}

function ofType<T extends AgentEvent['type']>(
	events: readonly AgentEvent[],
	type: T,
): Extract<AgentEvent, { type: T }>[] {
	return events.filter((event): event is Extract<AgentEvent, { type: T }> => event.type === type);
}

describe('ClaudeTranscript', () => {
	it('streams text and thinking under the content id of the message that finalizes them', () => {
		const { events } = replayRecorded('readAndBash');

		const [answer] = ofType(events, 'assistant.message');
		const deltas = ofType(events, 'assistant.delta');
		expect(answer?.text).toBe('`@malini/agent-bridge`');
		expect(deltas.map(({ text }) => text).join('')).toBe(answer?.text);
		expect(new Set(deltas.map(({ contentId }) => contentId))).toEqual(new Set([answer?.contentId]));

		const thoughts = ofType(events, 'thinking.message');
		const thinkingDeltas = ofType(events, 'thinking.delta');
		expect(thoughts).toHaveLength(2);
		expect(new Set(thinkingDeltas.map(({ contentId }) => contentId))).toEqual(
			new Set(thoughts.map(({ contentId }) => contentId)),
		);
		expect(new Set([...thoughts, answer].map((event) => event?.contentId)).size).toBe(3);
	});

	it('reports parallel tool calls from their streamed input to their results', () => {
		const { events } = replayRecorded('readAndBash');

		expect(ofType(events, 'tool.started')).toEqual([
			expect.objectContaining({
				name: 'Bash',
				toolCallId: 'toolu_01WHm75S8zyxVUdsbFCJdVPk',
				input: { command: 'echo hi', description: 'Echo hi to the terminal' },
			}),
			expect.objectContaining({
				name: 'Read',
				toolCallId: 'toolu_01Ni2boSPeoWF1ha4WD43Brs',
				input: { file_path: '/work/repo/packages/agent-bridge/package.json' },
			}),
		]);
		expect(new Set(ofType(events, 'tool.input.delta').map(({ name }) => name))).toEqual(
			new Set(['Bash', 'Read']),
		);
		expect(ofType(events, 'tool.completed')).toEqual([
			expect.objectContaining({
				name: 'Read',
				output: expect.stringContaining('@malini/agent-bridge'),
			}),
			expect.objectContaining({ name: 'Bash', output: 'hi' }),
		]);
		expect(ofType(events, 'command.completed')).toEqual([
			{ type: 'command.completed', runId: 'run-1', command: 'echo hi', exitCode: 0 },
		]);
		expect(ofType(events, 'tool.failed')).toEqual([]);
	});

	it('reports interim context usage once per model response', () => {
		const { events, transcript } = replayRecorded('readAndBash');

		expect(ofType(events, 'usage.updated')).toEqual([
			{
				type: 'usage.updated',
				runId: 'run-1',
				inputTokens: 23_911,
				outputTokens: 4,
				contextTokens: 23_915,
				interim: true,
			},
			{
				type: 'usage.updated',
				runId: 'run-1',
				inputTokens: 25_469,
				outputTokens: 3,
				contextTokens: 25_472,
				interim: true,
			},
		]);
		expect(transcript.usage).toEqual({
			inputTokens: 25_469,
			outputTokens: 3,
			contextTokens: 25_472,
		});
	});

	it('marks the last main-thread message as the resume cursor', () => {
		const { transcript } = replayRecorded('readAndBash');

		expect(transcript.cursor).toBe('14372fe3-16a6-4ab1-8c70-ee97865c9a65');
	});

	it('reports a file edit after the write succeeds', () => {
		const { events } = replayRecorded('write');

		expect(ofType(events, 'file.changed')).toEqual([
			{ type: 'file.changed', runId: 'run-1', path: '/work/repo/probe.txt' },
		]);
		const types = events.map(({ type }) => type);
		expect(types.indexOf('file.changed')).toBe(
			events.findIndex((event) => event.type === 'tool.completed' && event.name === 'Write') + 1,
		);
		expect(ofType(events, 'command.completed')).toEqual([
			expect.objectContaining({ command: 'ls -la', exitCode: 0 }),
		]);
	});

	it('nests subagent tool calls under the task that spawned them', () => {
		const { events } = replayRecorded('plan');

		const nested = events.filter(
			(event) =>
				(event.type === 'tool.started' || event.type === 'tool.completed') &&
				event.parentToolCallId === SUBAGENT_TOOL_CALL,
		);
		expect(nested.map(({ type }) => type)).toEqual([
			'tool.started',
			'tool.completed',
			'tool.started',
			'tool.completed',
		]);
		expect(ofType(events, 'tool.started').find(({ name }) => name === 'Agent')).toEqual(
			expect.not.objectContaining({ parentToolCallId: expect.anything() }),
		);
		expect(
			ofType(events, 'tool.completed').find(({ toolCallId }) => toolCallId === SUBAGENT_TOOL_CALL),
		).toMatchObject({
			name: 'Agent',
			output: expect.stringContaining('There is no `README.md` present.'),
		});
	});

	it('keeps subagent messages out of the transcript, usage and resume cursor', () => {
		const messages = recordedMessages('plan');
		const subagentResult = messages.findIndex(
			(message) => 'uuid' in message && message.uuid === 'af1f5289-6b5d-4403-ba90-5b593abbfdbe',
		);
		const { events, transcript } = replay(messages.slice(0, subagentResult));

		expect(transcript.cursor).toBe('a81bc3a3-6b29-4f17-b181-d70c24791e25');
		expect(ofType(events, 'assistant.message').map(({ text }) => text)).toEqual([
			"Let me quickly check what's in the current directory.",
		]);
		expect(ofType(events, 'usage.updated').map(({ contextTokens }) => contextTokens)).toEqual([
			23_865,
		]);
	});

	it('closes the plan hand-off as a finished step without the hand-off message', () => {
		const { events, transcript } = replayRecorded('plan');

		expect(ofType(events, 'tool.failed')).toEqual([]);
		expect(ofType(events, 'tool.completed')).toContainEqual(
			expect.objectContaining({
				name: 'ExitPlanMode',
				toolCallId: 'toolu_01MHyxqiE6rJwseBuKLrLLkT',
				output: '',
			}),
		);
		expect(transcript.cursor).toBe('e99ab5c0-5c5a-4abd-b934-de33c86c14fb');
	});

	it('reports a failing shell command as a failed tool and a non-zero exit', () => {
		const { events } = replayRecorded('bashFailure');

		expect(ofType(events, 'tool.failed')).toEqual([
			expect.objectContaining({
				name: 'Bash',
				error: 'Exit code 1\ncat: missing.txt: No such file or directory',
			}),
		]);
		expect(ofType(events, 'tool.completed')).toEqual([]);
		expect(ofType(events, 'command.completed')).toEqual([
			{ type: 'command.completed', runId: 'run-1', command: 'cat missing.txt', exitCode: 1 },
		]);
	});

	it('keeps a background agent running until Claude Code reports its task finished', () => {
		const { events } = replayRecorded('backgroundAgent');

		const agentEvents = events.filter(
			(event) => 'toolCallId' in event && event.toolCallId === BACKGROUND_AGENT_TOOL_CALL,
		);
		expect(agentEvents.map(({ type }) => type)).toEqual(['tool.started', 'tool.completed']);
		expect(agentEvents[1]).toEqual({
			type: 'tool.completed',
			runId: 'run-1',
			name: 'Agent',
			toolCallId: BACKGROUND_AGENT_TOOL_CALL,
			output: 'Command completed. Output:\n\n```\nprobe-done\n```',
		});
		const launched = events.findIndex(
			(event) => event.type === 'assistant.message' && event.text === 'launched',
		);
		const finished = events.findIndex(
			(event) => event.type === 'tool.completed' && event.toolCallId === BACKGROUND_AGENT_TOOL_CALL,
		);
		expect(finished).toBeGreaterThan(launched);
		expect(ofType(events, 'assistant.message').at(-1)?.text).toBe(
			'Agent "Sleep probe" completed successfully. Output: `probe-done`',
		);
	});

	it('stops a background agent still running when the run ends', () => {
		const messages = recordedMessages('backgroundAgent');
		const firstResult = messages.findIndex((message) => message.type === 'result');
		const { events, transcript } = replay(messages.slice(0, firstResult + 1));

		transcript.stopBackgroundAgents();
		transcript.stopBackgroundAgents();

		expect(ofType(events, 'tool.completed')).not.toContainEqual(
			expect.objectContaining({ toolCallId: BACKGROUND_AGENT_TOOL_CALL }),
		);
		expect(ofType(events, 'tool.failed')).toEqual([
			{
				type: 'tool.failed',
				runId: 'run-1',
				name: 'Agent',
				toolCallId: BACKGROUND_AGENT_TOOL_CALL,
				error: 'Background agent stopped when the run ended.',
			},
		]);
	});
});
