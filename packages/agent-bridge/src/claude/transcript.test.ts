import { describe, expect, it } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from '../types.js';
import { recordedMessages, type RecordedScenario } from './fixtures/fake-claude.js';
import { ClaudeTranscript, COMPACTION_TOOL } from './transcript.js';

const SUBAGENT_TOOL_CALL = 'toolu_01FeTa8kst16VYXGjiDS1bL9';
const BACKGROUND_AGENT_TOOL_CALL = 'toolu_012Qe9FFbcvw55RGnwjEQhkH';
const BACKGROUND_COMMAND_TOOL_CALL = 'toolu_01LDqMBnrAzfmPQHcjxrTv6v';
const RECORDED_SCENARIOS: readonly RecordedScenario[] = [
	'readAndBash',
	'write',
	'ask',
	'plan',
	'bashFailure',
	'deny',
	'orphanedTask',
	'backgroundAgent',
	'backgroundCommand',
	'stoppedBackgroundCommand',
	'retriedStream',
	'nonStreamingFallback',
	'compact',
];
const RETRIED_MESSAGE = 'msg_011Cg8VYeFbmT1U91bsswPCg';
const RETRY_MESSAGE = 'msg_011Cg8VYwWSAspzarueMPAGY';
const FALLEN_BACK_TOOL_CALL = 'toolu_01A1Ryo4oMAjZz3yc21mPG7F';
const BACKGROUND_COMMAND = {
	taskId: 'biv864hkk',
	kind: 'command',
	description: 'Sleep 20 seconds then echo bg-done',
	startedAt: expect.any(Number),
};

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

function streamEndings(events: readonly AgentEvent[]): Map<string, string[]> {
	const endings = new Map<string, string[]>();
	const end = (id: string, how: string): void => {
		endings.set(id, [...(endings.get(id) ?? []), how]);
	};
	for (const event of events) {
		if (event.type === 'thinking.delta' || event.type === 'assistant.delta') {
			if (!endings.has(event.contentId)) endings.set(event.contentId, []);
		} else if (event.type === 'tool.input.delta') {
			if (!endings.has(event.toolCallId)) endings.set(event.toolCallId, []);
		} else if (event.type === 'thinking.message' || event.type === 'assistant.message') {
			if (event.contentId && endings.has(event.contentId)) end(event.contentId, 'final');
		} else if (event.type === 'tool.started') {
			if (event.toolCallId && endings.has(event.toolCallId)) end(event.toolCallId, 'final');
		} else if (event.type === 'stream.discarded') {
			for (const id of [...event.contentIds, ...event.toolCallIds]) end(id, 'discarded');
		}
	}
	return endings;
}

function isStreamStop(message: SDKMessage): boolean {
	return message.type === 'stream_event' && message.event.type === 'message_stop';
}

function isRetryNotice(message: SDKMessage): boolean {
	return message.type === 'system' && message.subtype === 'api_retry';
}

function without(
	messages: readonly SDKMessage[],
	...dropped: ((message: SDKMessage) => boolean)[]
): SDKMessage[] {
	return messages.filter((message) => !dropped.some((drop) => drop(message)));
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

	it('announces each thought the moment it starts, before any summary arrives', () => {
		const { events } = replayRecorded('readAndBash');
		const opened = new Map<string, string>();
		for (const delta of ofType(events, 'thinking.delta')) {
			if (!opened.has(delta.contentId)) opened.set(delta.contentId, delta.text);
		}
		expect([...opened.values()]).toEqual(['', '']);
	});

	it('closes a thought that carries no summary, so no live thought outlives it', () => {
		const blanked = recordedMessages('readAndBash').flatMap((message) => {
			if (
				message.type === 'stream_event' &&
				message.event.type === 'content_block_delta' &&
				message.event.delta.type === 'thinking_delta'
			) {
				return [];
			}
			const copy = structuredClone(message);
			if (copy.type === 'assistant') {
				for (const block of copy.message.content) {
					if (block.type === 'thinking') block.thinking = '';
				}
			}
			return [copy];
		});
		const { events } = replay(blanked);
		const announced = new Set(ofType(events, 'thinking.delta').map(({ contentId }) => contentId));
		const closed = ofType(events, 'thinking.message');
		expect(closed.map(({ text }) => text)).toEqual(['', '']);
		expect(new Set(closed.map(({ contentId }) => contentId))).toEqual(announced);
	});

	it.each(RECORDED_SCENARIOS)('ends every block streamed in %s exactly once', (scenario) => {
		const { events } = replayRecorded(scenario);
		for (const [id, endings] of streamEndings(events)) {
			expect({ id, endings: endings.length }).toEqual({ id, endings: 1 });
		}
	});

	it.each([
		['as recorded', (messages: readonly SDKMessage[]) => [...messages]],
		[
			'without the stream stop',
			(messages: readonly SDKMessage[]) => without(messages, isStreamStop),
		],
		[
			'without the stream stop and the retry notice',
			(messages: readonly SDKMessage[]) => without(messages, isStreamStop, isRetryNotice),
		],
	])('discards a thought cut off by an API retry before the retry streams, %s', (_, edit) => {
		const { events } = replay(edit(recordedMessages('retriedStream')));
		const retriedThought = `${RETRIED_MESSAGE}:0`;

		const discarded = events.findIndex((event) => event.type === 'stream.discarded');
		const retryStarts = events.findIndex(
			(event) => event.type === 'thinking.delta' && event.contentId === `${RETRY_MESSAGE}:0`,
		);
		expect(events[discarded]).toEqual({
			type: 'stream.discarded',
			runId: 'run-1',
			contentIds: [retriedThought],
			toolCallIds: [],
		});
		expect(discarded).toBeLessThan(retryStarts);
		expect(ofType(events, 'thinking.message').map(({ contentId }) => contentId)).toEqual([
			`${RETRY_MESSAGE}:0`,
		]);
	});

	it.each([
		['as recorded', (messages: readonly SDKMessage[]) => [...messages]],
		[
			'without the stream stop',
			(messages: readonly SDKMessage[]) => without(messages, isStreamStop),
		],
	])('discards a tool call cut off by a non-streaming fallback before it runs, %s', (_, edit) => {
		const { events } = replay(edit(recordedMessages('nonStreamingFallback')));

		const discarded = events.findIndex((event) => event.type === 'stream.discarded');
		const fallbackStarts = events.findIndex((event) => event.type === 'tool.started');
		expect(events[discarded]).toEqual({
			type: 'stream.discarded',
			runId: 'run-1',
			contentIds: [],
			toolCallIds: [FALLEN_BACK_TOOL_CALL],
		});
		expect(discarded).toBeLessThan(fallbackStarts);
		expect(ofType(events, 'tool.started').map(({ toolCallId }) => toolCallId)).not.toContain(
			FALLEN_BACK_TOOL_CALL,
		);
	});

	it('discards a block still streaming when the turn ends', () => {
		const messages = without(recordedMessages('retriedStream'), isStreamStop, isRetryNotice);
		const cutOff = messages.findIndex(
			(message) =>
				message.type === 'stream_event' &&
				message.event.type === 'message_start' &&
				message.event.message.id === RETRY_MESSAGE,
		);
		const result = messages.filter((message) => message.type === 'result');
		const { events } = replay([...messages.slice(0, cutOff), ...result]);

		expect(ofType(events, 'stream.discarded')).toEqual([
			{
				type: 'stream.discarded',
				runId: 'run-1',
				contentIds: [`${RETRIED_MESSAGE}:0`],
				toolCallIds: [],
			},
		]);
	});

	it('keeps the text a steered turn streamed in that turn, once, under its own run', () => {
		const messages = recordedMessages('readAndBash');
		const firstText = messages.findIndex(
			(message) =>
				message.type === 'stream_event' &&
				message.event.type === 'content_block_delta' &&
				message.event.delta.type === 'text_delta',
		);
		const events: AgentEvent[] = [];
		const transcript = new ClaudeTranscript('run-1', (event) => events.push(event));
		for (const message of messages.slice(0, firstText + 1)) transcript.accept(message);
		const streamed = ofType(events, 'assistant.delta');

		transcript.interruptTurn();
		transcript.handOff('run-2');
		for (const message of messages.slice(firstText + 1)) transcript.accept(message);

		const contentId = streamed[0]?.contentId;
		expect(
			ofType(events, 'assistant.message').filter((event) => event.contentId === contentId),
		).toEqual([
			{
				type: 'assistant.message',
				runId: 'run-1',
				contentId,
				text: streamed.map(({ text }) => text).join(''),
			},
		]);
		expect(ofType(events, 'assistant.delta')).toEqual(streamed);
	});

	it('finalizes each block under its own streamed id when a block before it never finalizes', () => {
		const messages = recordedMessages('retriedStream');
		const retryThought = messages.findIndex(
			(message) =>
				message.type === 'assistant' &&
				message.message.id === RETRY_MESSAGE &&
				message.message.content[0]?.type === 'thinking',
		);
		const { events } = replay(messages.filter((_, index) => index !== retryThought));

		const [answer] = ofType(events, 'assistant.message');
		const answerDeltas = ofType(events, 'assistant.delta');
		expect(new Set(answerDeltas.map(({ contentId }) => contentId))).toEqual(
			new Set([answer?.contentId]),
		);
		expect(ofType(events, 'stream.discarded').at(-1)).toEqual({
			type: 'stream.discarded',
			runId: 'run-1',
			contentIds: [`${RETRY_MESSAGE}:0`],
			toolCallIds: [],
		});
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

	it('settles each tool call once when Claude Code repeats its result', () => {
		const messages = recordedMessages('readAndBash');
		const results = messages.filter(
			(message) => message.type === 'user' && JSON.stringify(message).includes('tool_result'),
		);
		const { events } = replay([...messages, ...results, ...results]);

		expect(results).not.toEqual([]);
		expect(ofType(events, 'tool.completed').map(({ name }) => name)).toEqual(['Read', 'Bash']);
		expect(ofType(events, 'command.completed')).toHaveLength(1);
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

	it('shows a compaction as a Compact step from its status to its boundary', () => {
		const { events, transcript } = replayRecorded('compact');

		expect(events).toEqual([
			{
				type: 'tool.started',
				runId: 'run-1',
				name: COMPACTION_TOOL,
				toolCallId: 'compaction-572a55aa-8cff-4541-a4bf-f1e18a18e75c',
			},
			{
				type: 'tool.completed',
				runId: 'run-1',
				name: COMPACTION_TOOL,
				toolCallId: 'compaction-572a55aa-8cff-4541-a4bf-f1e18a18e75c',
				output: { trigger: 'manual' },
			},
		]);
		expect(transcript.cursor).toBe('0aedad28-9b88-4781-8d8a-03679bdc83c5');
	});

	it('forgets the context it measured before a compaction', () => {
		const { transcript } = replay([
			...recordedMessages('readAndBash'),
			...recordedMessages('compact'),
		]);

		expect(transcript.usage).toBeNull();
	});

	it('fails the Compact step when Claude Code cannot compact', () => {
		const messages = recordedMessages('compact').flatMap((message) =>
			message.type === 'system' && message.subtype === 'status' && message.status === null
				? [{ ...message, compact_result: 'failed' as const, compact_error: 'Not enough messages' }]
				: message.type === 'system' && message.subtype === 'compact_boundary'
					? []
					: [message],
		);
		const { events } = replay(messages);

		expect(events.map(({ type }) => type)).toEqual(['tool.started', 'tool.failed']);
		expect(ofType(events, 'tool.failed')[0]?.error).toBe('Not enough messages');
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

		transcript.endBackgroundWork();
		transcript.endBackgroundWork();

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

	it('lists a background command while it runs, marks the wait, and clears it once it ends', () => {
		const { events } = replayRecorded('backgroundCommand');

		expect(ofType(events, 'background.updated')).toEqual([
			{ type: 'background.updated', runId: 'run-1', waiting: false, tasks: [BACKGROUND_COMMAND] },
			{
				type: 'background.updated',
				runId: 'run-1',
				waiting: false,
				tasks: [{ ...BACKGROUND_COMMAND, toolCallId: BACKGROUND_COMMAND_TOOL_CALL }],
			},
			{
				type: 'background.updated',
				runId: 'run-1',
				waiting: true,
				tasks: [{ ...BACKGROUND_COMMAND, toolCallId: BACKGROUND_COMMAND_TOOL_CALL }],
			},
			{ type: 'background.updated', runId: 'run-1', waiting: false, tasks: [] },
		]);
	});

	it('carries the turn summary and its resume point on the first wait after a successful result, and only there', () => {
		const messages = recordedMessages('backgroundCommand');
		const firstIdle = messages.findIndex(
			(message) =>
				message.type === 'system' &&
				message.subtype === 'session_state_changed' &&
				message.state === 'idle',
		);
		const events: AgentEvent[] = [];
		const transcript = new ClaudeTranscript('run-1', (event) => events.push(event));
		for (const message of messages.slice(0, firstIdle)) {
			transcript.accept(message);
			if (message.type === 'result') transcript.recordTurnResult(message);
		}
		const running = messages[0];
		const idle = messages[firstIdle];
		if (!running || !idle) throw new Error('backgroundCommand has no session states');

		transcript.accept(idle);
		transcript.recordBackgroundOutput('biv864hkk', 'still sleeping');
		transcript.accept(running);
		transcript.accept(idle);

		expect(transcript.cursor).toEqual(expect.any(String));
		expect(
			ofType(events, 'background.updated')
				.filter(({ waiting }) => waiting)
				.map(({ summary, providerCursor, interim }) => ({ summary, providerCursor, interim })),
		).toEqual([
			{ summary: 'launched', providerCursor: transcript.cursor, interim: undefined },
			{ summary: undefined, providerCursor: undefined, interim: true },
			{ summary: undefined, providerCursor: undefined, interim: undefined },
		]);
	});

	it('finds where a background command writes its output and shows its latest line', () => {
		const messages = recordedMessages('backgroundCommand');
		const firstResult = messages.findIndex((message) => message.type === 'result');
		const { events, transcript } = replay(messages.slice(0, firstResult + 1));

		expect(transcript.backgroundOutputFiles).toEqual(
			new Map([
				[
					'biv864hkk',
					'/tmp/claude/work-repo/99ceef72-2791-4374-856a-f9008b097a84/tasks/biv864hkk.output',
				],
			]),
		);
		transcript.recordBackgroundOutput('biv864hkk', 'bg-done');
		transcript.recordBackgroundOutput('biv864hkk', 'bg-done');

		expect(ofType(events, 'background.updated').at(-1)).toEqual({
			type: 'background.updated',
			runId: 'run-1',
			waiting: false,
			tasks: [
				{ ...BACKGROUND_COMMAND, toolCallId: BACKGROUND_COMMAND_TOOL_CALL, detail: 'bg-done' },
			],
			interim: true,
		});
		expect(ofType(events, 'background.updated')).toHaveLength(3);
	});

	it('clears the background tasks when the run ends while they still run', () => {
		const messages = recordedMessages('backgroundCommand');
		const firstResult = messages.findIndex((message) => message.type === 'result');
		const { events, transcript } = replay(messages.slice(0, firstResult + 1));

		transcript.endBackgroundWork();

		expect(transcript.hasBackgroundTasks).toBe(false);
		expect(ofType(events, 'background.updated').at(-1)).toEqual({
			type: 'background.updated',
			runId: 'run-1',
			waiting: false,
			tasks: [],
		});
	});
});
