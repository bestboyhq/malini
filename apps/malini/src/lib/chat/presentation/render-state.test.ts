import { describe, expect, it } from 'vitest';
import type { AgentEvent, EventEnvelope } from '$lib/chat/domain/events';
import { serializeAgentPromptWithIssueReferences } from '$lib/chat/domain/issue-reference';
import { runIdForPromptRequest } from '$contract/chat-identity';
import { newPromptRequestId } from '$lib/chat/domain/prompt-identity';
import {
	coalesceAdjacentThoughts,
	CONTEXT_HANDOFF_CONTENT_ID_PREFIX,
	firstPromptKey,
	foldEnvelopes,
	formatToolDuration,
	isContextHandoffContentId,
	sanitizeRunErrorText,
	splitRunErrorText,
	toolDurationMs,
	type RenderState,
	type RunGroup,
} from './render-state';

function firstRun(state: RenderState): RunGroup {
	const run = state.runs[0];
	if (!run) throw new Error('expected a run');
	return run;
}

function env<T extends AgentEvent>(
	sessionId: string,
	runId: string,
	seq: number,
	event: T,
): EventEnvelope {
	return { sessionId, runId, seq, event };
}

const SID = 'sess-1';

describe('foldEnvelopes', () => {
	it('suppresses empty and adjacent duplicate thought snapshots without merging distinct steps', () => {
		const first = { contentId: 'thought-1', text: 'Inspect the provider response.' };
		const second = { contentId: 'thought-2', text: 'Choose the safe recovery path.' };

		expect(
			coalesceAdjacentThoughts([
				first,
				{ contentId: 'empty', text: '  \n  ' },
				{ contentId: 'thought-1-snapshot', text: 'Inspect the provider response.\r\n' },
				second,
				{ contentId: 'thought-2-snapshot', text: '  Choose the safe recovery path.  ' },
			]),
		).toEqual([first, second]);
	});

	it('separates a concise provider failure from lossless raw diagnostics', () => {
		const raw =
			'Provider rejected composer-2.5. Choose another model or refresh models.\n\nDiagnostics:\nCannot use this model: composer-2.5\n{"type":"result","is_error":true}';
		expect(splitRunErrorText(raw)).toEqual({
			primary: 'Provider rejected composer-2.5. Choose another model or refresh models.',
			diagnostics: 'Cannot use this model: composer-2.5\n{"type":"result","is_error":true}',
		});
		expect(splitRunErrorText('plain failure')).toEqual({
			primary: 'plain failure',
			diagnostics: null,
		});
	});

	it('extracts an actionable message from provider-agnostic JSON API errors', () => {
		const raw = JSON.stringify({
			type: 'error',
			error: {
				name: 'APIError',
				data: {
					message: 'Insufficient balance',
					billingUrl: 'https://provider.example/settings/billing',
				},
			},
		});

		expect(splitRunErrorText(raw)).toEqual({
			primary: 'Insufficient balance',
			diagnostics: raw,
		});
		expect(splitRunErrorText('{"error":{"name":"APIError","data":')).toEqual({
			primary: '{"error":{"name":"APIError","data":',
			diagnostics: null,
		});
	});

	it('redacts provider identifiers and bearer credentials before rendering or copying', () => {
		const raw = [
			'organization=org-native-proof',
			'apiKey=<ak-native:proof/opaque>',
			'fallback=ak-fallback-proof',
			'openai=sk-openai-proof',
			'Authorization: Bearer opaque-native-proof',
			'"authorization":"Bearer another-native-proof"',
			'"Authorization":["Bearer array-native-proof"]',
		].join('\n');
		const sanitized = sanitizeRunErrorText(raw);

		expect(sanitized).toBe(
			[
				'organization=[redacted]',
				'apiKey=[redacted]',
				'fallback=[redacted]',
				'openai=[redacted]',
				'Authorization: Bearer [redacted]',
				'"authorization":"Bearer [redacted]"',
				'"Authorization":["Bearer [redacted]"]',
			].join('\n'),
		);
		expect(splitRunErrorText(raw)).toEqual({ primary: sanitized, diagnostics: null });
	});

	it.each([
		[
			'quota',
			'Moonshot API error for kimi-k3: quota_exceeded for org-native-proof using <ak-native-proof>',
			'Moonshot API balance or token quota is insufficient. Top up and try again.',
		],
		[
			'rate limit',
			'Moonshot kimi-k3 request failed: rate_limit_exceeded; Authorization: Bearer opaque-native-proof',
			'Moonshot API rate limit reached. Wait briefly and try again.',
		],
		[
			'overloaded',
			'Moonshot kimi-k3 is temporarily unavailable (status 503) for org-native-proof',
			'Moonshot API is temporarily overloaded. Try again shortly.',
		],
	])('shows stable Moonshot %s copy with only sanitized diagnostics', (_kind, raw, primary) => {
		const display = splitRunErrorText(raw);

		expect(display.primary).toBe(primary);
		expect(display.diagnostics).toContain('[redacted]');
		expect(`${display.primary}\n${display.diagnostics}`).not.toMatch(
			/(?:org-native-proof|ak-native-proof|opaque-native-proof)/u,
		);
	});

	it.each([
		[
			'quota',
			'DeepSeek API error for deepseek-v4-pro: Insufficient Balance for org-native-proof using sk-native-proof',
			'DeepSeek API balance or token quota is insufficient. Top up and try again.',
		],
		[
			'rate limit',
			'deepseek-flash request failed: rate_limit_exceeded; Authorization: Bearer opaque-native-proof',
			'DeepSeek API rate limit reached. Wait briefly and try again.',
		],
		[
			'overloaded',
			'api.deepseek.com is temporarily unavailable (status 503) for org-native-proof',
			'DeepSeek API is temporarily overloaded. Try again shortly.',
		],
	])('shows stable DeepSeek %s copy with only sanitized diagnostics', (_kind, raw, primary) => {
		const display = splitRunErrorText(raw);

		expect(display.primary).toBe(primary);
		expect(display.diagnostics).toContain('[redacted]');
		expect(`${display.primary}\n${display.diagnostics}`).not.toMatch(
			/(?:org-native-proof|sk-native-proof|opaque-native-proof)/u,
		);
	});

	it.each([
		'Moonshot API balance or token quota is insufficient. Top up and try again.',
		'Moonshot API rate limit reached. Wait briefly and try again.',
		'Moonshot API is temporarily overloaded. Try again shortly.',
		'DeepSeek API balance or token quota is insufficient. Top up and try again.',
		'DeepSeek API rate limit reached. Wait briefly and try again.',
		'DeepSeek API is temporarily overloaded. Try again shortly.',
	])('does not duplicate an already canonical bridge error as diagnostics', (error) => {
		expect(splitRunErrorText(error)).toEqual({ primary: error, diagnostics: null });
	});

	it('stabilizes a legacy Moonshot insufficient-balance row and scrubs both sections', () => {
		const raw =
			'Moonshot request failed for org-native-proof using <ak-native-proof>.\n\nDiagnostics:\n' +
			'{"message":"The account was suspended due to insufficient balance. Please recharge.","authorization":"Bearer opaque-native-proof"}';

		expect(splitRunErrorText(raw)).toEqual({
			primary: 'Moonshot API balance or token quota is insufficient. Top up and try again.',
			diagnostics:
				'{"message":"The account was suspended due to insufficient balance. Please recharge.","authorization":"Bearer [redacted]"}',
		});
	});

	it('returns an empty render state for an empty envelope list', () => {
		const state = foldEnvelopes([]);
		expect(state).toEqual({ runs: [], terminal: null });
	});

	it('materializes a run header on run.started even with no body items yet', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, { type: 'run.started', runId: 'run-1', sessionId: SID }),
		]);
		expect(state.runs).toHaveLength(1);
		expect(state.runs[0]).toMatchObject({ runId: 'run-1', items: [], terminal: null });
	});

	it('folds an assistant message into the owning run', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, { type: 'run.started', runId: 'run-1', sessionId: SID }),
			env(SID, 'run-1', 2, { type: 'assistant.message', runId: 'run-1', text: 'hello there' }),
		]);
		expect(firstRun(state).items).toEqual([
			{ kind: 'assistant', key: `${SID}-run-1-2`, seq: 2, text: 'hello there' },
		]);
	});

	it('folds a context-handoff announcement into a relay row instead of an assistant message', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, { type: 'run.started', runId: 'run-1', sessionId: SID }),
			env(SID, 'run-1', 2, {
				type: 'assistant.message',
				runId: 'run-1',
				contentId: `${CONTEXT_HANDOFF_CONTENT_ID_PREFIX}1`,
				text: 'Context is full. Handing the work to a fresh run.',
			}),
			env(SID, 'run-1', 3, {
				type: 'assistant.message',
				runId: 'run-1',
				contentId: 'block-9',
				text: 'Picking it back up.',
			}),
		]);

		expect(firstRun(state).items).toEqual([
			{ kind: 'handoff', key: `${SID}-run-1-2`, seq: 2 },
			{
				kind: 'assistant',
				key: `${SID}-run-1-3`,
				seq: 3,
				text: 'Picking it back up.',
				contentId: 'block-9',
			},
		]);
	});

	it('recognizes a handoff stored under the old content id prefix', () => {
		expect(CONTEXT_HANDOFF_CONTENT_ID_PREFIX).toBe('malini.context-handoff:');
		expect(isContextHandoffContentId('malini.context-handoff:1')).toBe(true);
		expect(isContextHandoffContentId('core.context-handoff:1')).toBe(true);
		expect(isContextHandoffContentId('block-9')).toBe(false);
		expect(isContextHandoffContentId(undefined)).toBe(false);
	});

	it('folds a user.message event into a user item', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, {
				type: 'user.message',
				runId: 'run-1',
				text: serializeAgentPromptWithIssueReferences('do the thing', [
					{
						provider: 'linear',
						identifier: 'SMK-123',
						url: 'https://linear.app/acme/issue/SMK-123',
					},
				]),
				checkpointId: 'checkpoint-before-run-1',
				contextFiles: ['src/routes/+page.svelte'],
				attachments: [
					{
						id: 'att-00000000000000000000000000000001',
						displayName: 'brief.pdf',
						relativePath:
							'.malini/agent-attachments/att-00000000000000000000000000000001/brief.pdf',
						mediaType: 'application/pdf',
						size: 42,
						sha256: 'b'.repeat(64),
					},
				],
			}),
		]);
		expect(firstRun(state).items).toEqual([
			{
				kind: 'user',
				key: 'user-run-1',
				seq: 1,
				text: 'do the thing',
				checkpointId: 'checkpoint-before-run-1',
				contextFiles: ['src/routes/+page.svelte'],
				attachments: [
					{
						id: 'att-00000000000000000000000000000001',
						displayName: 'brief.pdf',
						relativePath:
							'.malini/agent-attachments/att-00000000000000000000000000000001/brief.pdf',
						mediaType: 'application/pdf',
						size: 42,
						sha256: 'b'.repeat(64),
					},
				],
				issueReferences: [
					{
						provider: 'linear',
						identifier: 'SMK-123',
						url: 'https://linear.app/acme/issue/SMK-123',
					},
				],
			},
		]);
	});

	it('folds a plan.updated event into a plan item', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, { type: 'plan.updated', runId: 'run-1', text: 'step 1, step 2' }),
		]);
		expect(firstRun(state).items).toEqual([
			{ kind: 'plan', key: `${SID}-run-1-1`, seq: 1, text: 'step 1, step 2' },
		]);
	});

	it('pairs tool.started and tool.completed by NAME (known wart, preserved as-is)', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, {
				type: 'tool.started',
				runId: 'run-1',
				name: 'Read',
				input: { path: '/a.ts' },
				ts: 1,
			}),
			env(SID, 'run-1', 2, {
				type: 'tool.completed',
				runId: 'run-1',
				name: 'Read',
				output: { content: 'file contents' },
				ts: 2,
			}),
		]);
		expect(firstRun(state).items).toHaveLength(1);
		const item = firstRun(state).items[0];
		expect(item?.kind).toBe('tool');
		if (item?.kind !== 'tool') throw new Error('expected tool item');
		expect(item.tool).toEqual({
			name: 'Read',
			startedAt: 1,
			completedAt: 2,
			input: { path: '/a.ts' },
			output: { content: 'file contents' },
			status: 'completed',
		});
		expect(item.key).toBe('tool-run-1-Read-1');
		expect(item.seq).toBe(1);
	});

	it('demonstrates the name-pairing wart: two concurrent same-name tools clobber each other', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, {
				type: 'tool.started',
				runId: 'run-1',
				name: 'Bash',
				input: 'a',
				ts: 1,
			}),
			env(SID, 'run-1', 2, {
				type: 'tool.started',
				runId: 'run-1',
				name: 'Bash',
				input: 'b',
				ts: 2,
			}),
			env(SID, 'run-1', 3, {
				type: 'tool.completed',
				runId: 'run-1',
				name: 'Bash',
				output: 'out',
				ts: 3,
			}),
		]);
		expect(firstRun(state).items).toHaveLength(1);
		const item = firstRun(state).items[0];
		if (item?.kind !== 'tool') throw new Error('expected tool item');
		expect(item.tool.startedAt).toBe(2);
		expect(item.tool.input).toBe('b');
	});

	it('pairs concurrent same-name tools by toolCallId when the bridge provides one', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, {
				type: 'tool.started',
				runId: 'run-1',
				name: 'Bash',
				toolCallId: 'tool-a',
				input: 'echo a',
				ts: 1,
			}),
			env(SID, 'run-1', 2, {
				type: 'tool.started',
				runId: 'run-1',
				name: 'Bash',
				toolCallId: 'tool-b',
				input: 'echo b',
				ts: 2,
			}),
			env(SID, 'run-1', 3, {
				type: 'tool.completed',
				runId: 'run-1',
				name: 'Bash',
				toolCallId: 'tool-a',
				output: 'a',
				ts: 3,
			}),
			env(SID, 'run-1', 4, {
				type: 'tool.completed',
				runId: 'run-1',
				name: 'Bash',
				toolCallId: 'tool-b',
				output: 'b',
				ts: 4,
			}),
		]);

		expect(firstRun(state).items).toHaveLength(2);
		const tools = firstRun(state).items.filter((item) => item.kind === 'tool');
		expect(tools).toHaveLength(2);
		const [first, second] = tools;
		if (first?.kind !== 'tool' || second?.kind !== 'tool') throw new Error('expected tool items');
		expect(first.tool).toMatchObject({
			name: 'Bash',
			toolCallId: 'tool-a',
			startedAt: 1,
			completedAt: 3,
			input: 'echo a',
			output: 'a',
			status: 'completed',
		});
		expect(second.tool).toMatchObject({
			name: 'Bash',
			toolCallId: 'tool-b',
			startedAt: 2,
			completedAt: 4,
			input: 'echo b',
			output: 'b',
			status: 'completed',
		});
	});

	it('drops open tools for a run when a terminal event arrives', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, { type: 'run.started', runId: 'run-1', sessionId: SID }),
			env(SID, 'run-1', 2, {
				type: 'tool.started',
				runId: 'run-1',
				name: 'Bash',
				toolCallId: 'tool-running',
				input: 'sleep 10',
			}),
			env(SID, 'run-1', 3, { type: 'run.failed', runId: 'run-1', error: 'cancelled' }),
			env(SID, 'run-2', 4, { type: 'run.started', runId: 'run-2', sessionId: SID }),
		]);

		const tools = state.runs.flatMap((run) => run.items.filter((item) => item.kind === 'tool'));
		expect(tools).toHaveLength(0);
		expect(state.runs.find((run) => run.runId === 'run-1')?.terminal).toBe('cancelled');
	});

	it('renders a bare tool.completed with no prior started as a completed-only tool item', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, {
				type: 'tool.completed',
				runId: 'run-1',
				name: 'Grep',
				output: 'x',
				ts: 1,
			}),
		]);
		expect(firstRun(state).items).toEqual([
			{
				kind: 'tool',
				key: 'tool-run-1-Grep-1',
				seq: 1,
				tool: {
					name: 'Grep',
					startedAt: null,
					completedAt: 1,
					input: undefined,
					output: 'x',
					status: 'completed',
				},
			},
		]);
	});

	it('resolves an open tool into a failed state on tool.failed instead of leaving it running forever', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, {
				type: 'tool.started',
				runId: 'run-1',
				name: 'Bash',
				input: { command: 'rm -rf /' },
				ts: 1,
			}),
			env(SID, 'run-1', 2, {
				type: 'tool.failed',
				runId: 'run-1',
				name: 'Bash',
				error: 'permission denied',
				ts: 2,
			}),
		]);
		expect(firstRun(state).items).toHaveLength(1);
		const item = firstRun(state).items[0];
		expect(item?.kind).toBe('tool');
		if (item?.kind !== 'tool') throw new Error('expected tool item');
		expect(item.tool).toEqual({
			name: 'Bash',
			startedAt: 1,
			completedAt: 2,
			input: { command: 'rm -rf /' },
			output: undefined,
			status: 'failed',
			error: 'permission denied',
		});
		expect(item.key).toBe('tool-run-1-Bash-1');
		expect(item.seq).toBe(1);
	});

	it('renders a bare tool.failed with no prior started as a failed-only tool item', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, {
				type: 'tool.failed',
				runId: 'run-1',
				name: 'Grep',
				error: 'timed out',
				ts: 1,
			}),
		]);
		expect(firstRun(state).items).toEqual([
			{
				kind: 'tool',
				key: 'tool-run-1-Grep-1',
				seq: 1,
				tool: {
					name: 'Grep',
					startedAt: null,
					completedAt: 1,
					input: undefined,
					output: undefined,
					status: 'failed',
					error: 'timed out',
				},
			},
		]);
	});

	it('ignores ephemeral delta events and thinking.message as defensive no-ops (a later unit renders them)', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, { type: 'run.started', runId: 'run-1', sessionId: SID }),
			env(SID, 'run-1', 2, {
				type: 'assistant.delta',
				runId: 'run-1',
				contentId: 'b1',
				text: 'hel',
			}),
			env(SID, 'run-1', 3, {
				type: 'thinking.delta',
				runId: 'run-1',
				contentId: 'b2',
				text: 'hmm',
			}),
			env(SID, 'run-1', 4, {
				type: 'tool.input.delta',
				runId: 'run-1',
				toolCallId: 't1',
				name: 'Read',
				inputJsonDelta: '{"a":',
			}),
			env(SID, 'run-1', 5, {
				type: 'thinking.message',
				runId: 'run-1',
				contentId: 'b2',
				text: 'hmm, done',
			}),
		]);
		expect(firstRun(state).items).toEqual([]);
	});

	it('leaves a still-running tool (started, never completed) attached to the last run as a fallback item', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, { type: 'run.started', runId: 'run-1', sessionId: SID }),
			env(SID, 'run-1', 2, {
				type: 'tool.started',
				runId: 'run-1',
				name: 'Write',
				input: 'x',
				ts: 2,
			}),
		]);
		expect(state.runs).toHaveLength(1);
		const items = firstRun(state).items;
		expect(items).toHaveLength(1);
		const item = items[0];
		expect(item?.kind).toBe('tool');
		if (item?.kind !== 'tool') throw new Error('expected tool item');
		expect(item.tool).toMatchObject({ name: 'Write', status: 'running', completedAt: null });
		expect(item.key).toBe('tool-run-1-Write-2');
		expect(item.seq).toBe(2);
	});

	it('preserves a deterministic 30s tool duration independently of adjacent sequence numbers', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 5, {
				type: 'tool.started',
				runId: 'run-1',
				name: 'Bash',
				toolCallId: 'tool-1',
				input: { command: 'sleep 30' },
				ts: 10_000,
			}),
			env(SID, 'run-1', 6, {
				type: 'tool.completed',
				runId: 'run-1',
				name: 'Bash',
				toolCallId: 'tool-1',
				output: '',
				ts: 40_000,
			}),
		]);
		const item = firstRun(state).items[0];
		if (item?.kind !== 'tool') throw new Error('expected tool item');
		expect(item.tool.startedAt).toBe(10_000);
		expect(item.tool.completedAt).toBe(40_000);
		expect(toolDurationMs(item.tool)).toBe(30_000);
		expect(formatToolDuration(toolDurationMs(item.tool), 'completed')).toBe('30.0s');
	});

	it('does not fabricate duration from sequence numbers for legacy events without timestamps', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 5, { type: 'tool.started', runId: 'run-1', name: 'Edit' }),
			env(SID, 'run-1', 100, { type: 'tool.completed', runId: 'run-1', name: 'Edit' }),
		]);
		const item = firstRun(state).items[0];
		if (item?.kind !== 'tool') throw new Error('expected tool item');
		expect(item.tool.startedAt).toBeNull();
		expect(item.tool.completedAt).toBeNull();
		expect(toolDurationMs(item.tool)).toBeNull();
	});

	it('keeps the same tool row key from running through completion', () => {
		const started = env(SID, 'run-1', 2, {
			type: 'tool.started' as const,
			runId: 'run-1',
			name: 'Edit',
			toolCallId: 'edit-1',
			input: { path: '/repo/a.ts' },
		});
		const running = foldEnvelopes([started]);
		const completed = foldEnvelopes([
			started,
			env(SID, 'run-1', 3, {
				type: 'tool.completed',
				runId: 'run-1',
				name: 'Edit',
				toolCallId: 'edit-1',
				output: { ok: true },
			}),
		]);

		expect(firstRun(running).items[0]?.key).toBe('tool-run-1-edit-1');
		expect(firstRun(completed).items[0]?.key).toBe(firstRun(running).items[0]?.key);
	});

	it('gives a submitted prompt the same row key its persisted self will get', () => {
		const requestId = newPromptRequestId();
		const runId = runIdForPromptRequest(requestId);
		expect(runId).not.toBeNull();
		const drawnOnSubmit = firstPromptKey(runId!);

		const persisted = foldEnvelopes([
			env(SID, runId!, 1, {
				type: 'user.message',
				runId: runId!,
				text: 'do the thing',
				clientRequestId: requestId,
			}),
		]);

		expect(firstRun(persisted).runId).toBe(runId);
		expect(firstRun(persisted).items[0]?.key).toBe(drawnOnSubmit);
	});

	it('keeps the sequence in the key of a call the provider gave no id', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 7, {
				type: 'tool.started' as const,
				runId: 'run-1',
				name: 'Grep',
				input: { pattern: 'a' },
			}),
		]);

		expect(firstRun(state).items[0]?.key).toBe('tool-run-1-Grep-7');
	});

	it('renders a command immediately and keeps its row stable as output and completion arrive', () => {
		const started = env(SID, 'run-1', 1, {
			type: 'command.started' as const,
			runId: 'run-1',
			command: 'pnpm test',
		});
		const running = foldEnvelopes([
			started,
			env(SID, 'run-1', 2, {
				type: 'command.output',
				runId: 'run-1',
				stream: 'stdout',
				text: 'running',
			}),
		]);
		const completed = foldEnvelopes([
			started,
			env(SID, 'run-1', 2, {
				type: 'command.output',
				runId: 'run-1',
				stream: 'stdout',
				text: 'running',
			}),
			env(SID, 'run-1', 3, {
				type: 'command.completed',
				runId: 'run-1',
				command: 'pnpm test',
				exitCode: 0,
			}),
		]);

		expect(firstRun(running).items[0]).toMatchObject({
			kind: 'command',
			key: 'command-run-1-1',
			seq: 1,
			command: 'pnpm test',
			exitCode: null,
			output: 'running',
		});
		expect(firstRun(completed).items[0]).toMatchObject({
			key: firstRun(running).items[0]?.key,
			exitCode: 0,
		});
	});

	it('accumulates command.started/output/completed into a single command item with concatenated stdout/stderr', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, { type: 'command.started', runId: 'run-1', command: 'npm test' }),
			env(SID, 'run-1', 2, {
				type: 'command.output',
				runId: 'run-1',
				stream: 'stdout',
				text: 'running...\n',
			}),
			env(SID, 'run-1', 3, {
				type: 'command.output',
				runId: 'run-1',
				stream: 'stderr',
				text: 'warning: deprecated',
			}),
			env(SID, 'run-1', 4, {
				type: 'command.completed',
				runId: 'run-1',
				command: 'npm test',
				exitCode: 0,
			}),
		]);
		expect(firstRun(state).items).toEqual([
			{
				kind: 'command',
				key: 'command-run-1-1',
				seq: 1,
				command: 'npm test',
				exitCode: 0,
				output: 'running...\nwarning: deprecated\n[stderr]\n',
			},
		]);
	});

	it('synthesizes a command.output with no prior command.started as "<unknown>"', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, {
				type: 'command.output',
				runId: 'run-1',
				stream: 'stdout',
				text: 'orphan output',
			}),
			env(SID, 'run-1', 2, {
				type: 'command.completed',
				runId: 'run-1',
				command: 'echo hi',
				exitCode: 0,
			}),
		]);
		expect(firstRun(state).items).toEqual([
			{
				kind: 'command',
				key: 'command-run-1-1',
				seq: 1,
				command: 'echo hi',
				exitCode: 0,
				output: 'orphan output',
			},
		]);
	});

	it('folds file.changed events, keying on path to disambiguate multiple files', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, { type: 'file.changed', runId: 'run-1', path: '/repo/a.ts' }),
			env(SID, 'run-1', 2, { type: 'file.changed', runId: 'run-1', path: '/repo/b.ts' }),
		]);
		expect(firstRun(state).items).toEqual([
			{ kind: 'file', key: `${SID}-run-1-1-/repo/a.ts`, seq: 1, path: '/repo/a.ts' },
			{ kind: 'file', key: `${SID}-run-1-2-/repo/b.ts`, seq: 2, path: '/repo/b.ts' },
		]);
	});

	it('folds replay-shaped approval requests with normalized metadata and de-duplicates the request id', () => {
		const approval = {
			type: 'approval.requested' as const,
			runId: 'run-1',
			approvalId: 'appr-1',
			reason: 'needs external read access',
			toolName: 'Read',
			input: { file_path: '../reference/file.ts' },
			permission: {
				capability: 'read' as const,
				resources: [
					{
						kind: 'path' as const,
						value: '../reference/file.ts',
						canonicalValue: '/repo/reference/file.ts',
						boundary: 'external' as const,
					},
				],
			},
		};
		const state = foldEnvelopes([env(SID, 'run-1', 1, approval), env(SID, 'run-1', 2, approval)]);
		expect(firstRun(state).items).toEqual([
			{
				kind: 'approval',
				key: `approval:${SID}:run-1:appr-1`,
				seq: 1,
				sessionId: SID,
				runId: 'run-1',
				approvalId: 'appr-1',
				reason: 'needs external read access',
				toolName: 'Read',
				input: { file_path: '../reference/file.ts' },
				permission: approval.permission,
			},
		]);
	});

	it('folds structured question requests using outer envelope identity', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, {
				type: 'question.requested',
				runId: 'run-1',
				questionId: 'question-1',
				toolName: 'AskUserQuestion',
				toolCallId: 'tool-1',
				questions: [
					{
						id: 'question-1:0',
						prompt: 'Which runner?',
						options: [{ label: 'Vitest', description: 'Fast unit tests' }],
						multiSelect: false,
						allowFreeText: true,
					},
				],
			}),
		]);
		expect(firstRun(state).items).toEqual([
			{
				kind: 'question',
				key: `question:${SID}:run-1:question-1`,
				seq: 1,
				sessionId: SID,
				runId: 'run-1',
				questionId: 'question-1',
				toolName: 'AskUserQuestion',
				toolCallId: 'tool-1',
				questions: [
					{
						id: 'question-1:0',
						prompt: 'Which runner?',
						options: [{ label: 'Vitest', description: 'Fast unit tests' }],
						multiSelect: false,
						allowFreeText: true,
					},
				],
			},
		]);
	});

	it('tracks usage.updated as an inline item, defaulting missing fields to null', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, { type: 'usage.updated', runId: 'run-1', inputTokens: 100 }),
			env(SID, 'run-1', 2, {
				type: 'usage.updated',
				runId: 'run-1',
				inputTokens: 120,
				outputTokens: 40,
				costUsd: 0.05,
			}),
		]);
		expect(firstRun(state).items).toEqual([
			{
				kind: 'usage',
				key: `${SID}-run-1-1`,
				seq: 1,
				inputTokens: 100,
				outputTokens: null,
				costUsd: null,
			},
			{
				kind: 'usage',
				key: `${SID}-run-1-2`,
				seq: 2,
				inputTokens: 120,
				outputTokens: 40,
				costUsd: 0.05,
			},
		]);
	});

	it('marks a run.completed run as terminal "completed" and stores the summary text', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, { type: 'run.started', runId: 'run-1', sessionId: SID }),
			env(SID, 'run-1', 2, { type: 'run.completed', runId: 'run-1', summary: 'Did the thing.' }),
		]);
		expect(state.terminal).toBe('completed');
		expect(firstRun(state).terminal).toBe('completed');
		expect(firstRun(state).terminalText).toBe('Did the thing.');
		expect(firstRun(state).items).toEqual([
			{
				kind: 'terminal',
				key: `${SID}-run-1-2`,
				seq: 2,
				terminal: 'completed',
				text: 'Did the thing.',
			},
		]);
	});

	it('marks a run.failed run as terminal "failed" and stores the error text', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, { type: 'run.started', runId: 'run-1', sessionId: SID }),
			env(SID, 'run-1', 2, { type: 'run.failed', runId: 'run-1', error: 'boom' }),
		]);
		expect(state.terminal).toBe('failed');
		expect(firstRun(state).terminal).toBe('failed');
		expect(firstRun(state).terminalText).toBe('boom');
	});

	it('marks a run.failed run with error "cancelled" as run-level terminal "cancelled" (state.terminal stays "failed")', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, { type: 'run.started', runId: 'run-1', sessionId: SID }),
			env(SID, 'run-1', 2, { type: 'run.failed', runId: 'run-1', error: 'cancelled' }),
		]);
		expect(state.terminal).toBe('failed');
		expect(firstRun(state).terminal).toBe('cancelled');
		expect(firstRun(state).terminalText).toBe('cancelled');
	});

	it('terminal idempotence: run.completed then run.cancelled keeps exactly one chip with the first terminal text', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, { type: 'run.started', runId: 'run-1', sessionId: SID }),
			env(SID, 'run-1', 2, { type: 'run.completed', runId: 'run-1', summary: 'Did the thing.' }),
			env(SID, 'run-1', 3, { type: 'run.failed', runId: 'run-1', error: 'cancelled' }),
		]);
		const terminalItems = firstRun(state).items.filter((item) => item.kind === 'terminal');
		expect(terminalItems).toHaveLength(1);
		expect(firstRun(state).terminal).toBe('completed');
		expect(firstRun(state).terminalText).toBe('Did the thing.');
	});

	it('terminal idempotence: duplicate run.completed events for the same run collapse to one chip', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, { type: 'run.started', runId: 'run-1', sessionId: SID }),
			env(SID, 'run-1', 2, { type: 'run.completed', runId: 'run-1', summary: 'Did the thing.' }),
			env(SID, 'run-1', 3, {
				type: 'run.completed',
				runId: 'run-1',
				summary: 'Did the thing (replayed).',
			}),
		]);
		const terminalItems = firstRun(state).items.filter((item) => item.kind === 'terminal');
		expect(terminalItems).toHaveLength(1);
		expect(firstRun(state).terminalText).toBe('Did the thing.');
	});

	it('terminal idempotence: duplicate run.failed events for the same run collapse to one chip', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, { type: 'run.started', runId: 'run-1', sessionId: SID }),
			env(SID, 'run-1', 2, { type: 'run.failed', runId: 'run-1', error: 'boom' }),
			env(SID, 'run-1', 3, { type: 'run.failed', runId: 'run-1', error: 'boom again' }),
		]);
		const terminalItems = firstRun(state).items.filter((item) => item.kind === 'terminal');
		expect(terminalItems).toHaveLength(1);
		expect(firstRun(state).terminal).toBe('failed');
		expect(firstRun(state).terminalText).toBe('boom');
	});

	it('folds an unknown event into the most recent run in DEV (raw payload preserved)', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, { type: 'run.started', runId: 'run-1', sessionId: SID }),
			env(SID, 'run-1', 2, { type: 'unknown', raw: { weird: true } }),
		]);
		expect(firstRun(state).items).toEqual([
			{ kind: 'unknown', key: `${SID}-run-1-2`, seq: 2, raw: { weird: true } },
		]);
	});

	it('attaches an unknown event to a synthetic "unknown" run when no run exists yet', () => {
		const state = foldEnvelopes([env(SID, 'run-1', 1, { type: 'unknown', raw: 'oops' })]);
		expect(state.runs).toHaveLength(1);
		expect(firstRun(state).runId).toBe('unknown');
		expect(firstRun(state).items).toEqual([
			{ kind: 'unknown', key: `${SID}-run-1-1`, seq: 1, raw: 'oops' },
		]);
	});

	it('groups envelopes into separate RunGroups in first-seen order across multiple runIds', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, { type: 'run.started', runId: 'run-1', sessionId: SID }),
			env(SID, 'run-1', 2, { type: 'assistant.message', runId: 'run-1', text: 'first' }),
			env(SID, 'run-1', 3, { type: 'run.completed', runId: 'run-1', summary: 'done 1' }),
			env(SID, 'run-2', 4, { type: 'run.started', runId: 'run-2', sessionId: SID }),
			env(SID, 'run-2', 5, { type: 'assistant.message', runId: 'run-2', text: 'second' }),
		]);
		expect(state.runs.map((r) => r.runId)).toEqual(['run-1', 'run-2']);
		expect(firstRun(state).terminal).toBe('completed');
		expect(state.runs[1]?.terminal).toBe(null);
	});

	it('drops bodyless, non-terminal run groups except the last (optimistic run.started phantom)', () => {
		const state = foldEnvelopes([
			env(SID, 'optimistic-run', 1, {
				type: 'run.started',
				runId: 'optimistic-run',
				sessionId: SID,
			}),
			env(SID, 'real-run', 2, { type: 'run.started', runId: 'real-run', sessionId: SID }),
			env(SID, 'real-run', 3, { type: 'assistant.message', runId: 'real-run', text: 'hi' }),
		]);
		expect(state.runs.map((r) => r.runId)).toEqual(['real-run']);
	});

	it('keeps the last run even if it is bodyless and non-terminal (in-flight run just started)', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, { type: 'run.started', runId: 'run-1', sessionId: SID }),
		]);
		expect(state.runs.map((r) => r.runId)).toEqual(['run-1']);
		expect(firstRun(state).items).toEqual([]);
	});

	it('produces stable envelope-derived keys of the form sessionId-runId-seq', () => {
		const state = foldEnvelopes([
			env('sess-x', 'run-y', 42, { type: 'assistant.message', runId: 'run-y', text: 'hi' }),
		]);
		expect(firstRun(state).items[0]?.key).toBe('sess-x-run-y-42');
	});

	function shellRun(exitCode: number, terminal: AgentEvent): EventEnvelope[] {
		return [
			env(SID, 'run-1', 1, {
				type: 'tool.started',
				runId: 'run-1',
				name: 'bash',
				toolCallId: 'bash-1',
				input: { command: 'grep -rn nothing src' },
			}),
			env(SID, 'run-1', 2, {
				type: 'command.started',
				runId: 'run-1',
				command: 'grep -rn nothing src',
			}),
			env(SID, 'run-1', 3, {
				type: 'command.completed',
				runId: 'run-1',
				command: 'grep -rn nothing src',
				exitCode,
			}),
			env(SID, 'run-1', 4, terminal),
		];
	}

	it("keeps the agent's own label on the command row it belongs to", () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, {
				type: 'command.started',
				runId: 'run-1',
				command: "grep -rn 'BashRunResult' agent-bridge/src",
				description: 'Check BashRunResult import',
			}),
			env(SID, 'run-1', 2, {
				type: 'command.completed',
				runId: 'run-1',
				command: "grep -rn 'BashRunResult' agent-bridge/src",
				description: 'Check BashRunResult import',
				exitCode: 1,
			}),
		]);
		expect(firstRun(state).items[0]).toMatchObject({
			kind: 'command',
			description: 'Check BashRunResult import',
		});
	});

	it('leaves a command row without a label when the call supplied none', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, { type: 'command.started', runId: 'run-1', command: 'pnpm test' }),
			env(SID, 'run-1', 2, {
				type: 'command.completed',
				runId: 'run-1',
				command: 'pnpm test',
				exitCode: 0,
			}),
		]);
		const item = firstRun(state).items[0];
		expect(item && 'description' in item).toBe(false);
	});

	it('leaves a command that merely exited non-zero unmarked', () => {
		const state = foldEnvelopes(
			shellRun(1, {
				type: 'tool.completed',
				runId: 'run-1',
				name: 'bash',
				toolCallId: 'bash-1',
				output: { exitCode: 1 },
			}),
		);
		const command = firstRun(state).items.find((item) => item.kind === 'command');
		expect(command).toMatchObject({ kind: 'command', exitCode: 1 });
		expect(command && 'error' in command).toBe(false);
	});

	it('marks a command with the failure reported by the tool call that ran it', () => {
		const state = foldEnvelopes(
			shellRun(124, {
				type: 'tool.failed',
				runId: 'run-1',
				name: 'bash',
				toolCallId: 'bash-1',
				error: 'command timed out',
			}),
		);
		expect(firstRun(state).items.find((item) => item.kind === 'command')).toMatchObject({
			kind: 'command',
			exitCode: 124,
			error: 'command timed out',
		});
	});

	it('never lets one failed tool call mark a command another call ran', () => {
		const state = foldEnvelopes([
			env(SID, 'run-1', 1, {
				type: 'tool.started',
				runId: 'run-1',
				name: 'bash',
				toolCallId: 'bash-1',
				input: { command: 'pnpm test' },
			}),
			env(SID, 'run-1', 2, { type: 'command.started', runId: 'run-1', command: 'pnpm test' }),
			env(SID, 'run-1', 3, {
				type: 'command.completed',
				runId: 'run-1',
				command: 'pnpm test',
				exitCode: 1,
			}),
			env(SID, 'run-1', 4, {
				type: 'tool.completed',
				runId: 'run-1',
				name: 'bash',
				toolCallId: 'bash-1',
				output: { exitCode: 1 },
			}),
			env(SID, 'run-1', 5, {
				type: 'tool.started',
				runId: 'run-1',
				name: 'bash',
				toolCallId: 'bash-2',
				input: { command: 'pnpm test' },
			}),
			env(SID, 'run-1', 6, { type: 'command.started', runId: 'run-1', command: 'pnpm test' }),
			env(SID, 'run-1', 7, {
				type: 'command.completed',
				runId: 'run-1',
				command: 'pnpm test',
				exitCode: 143,
			}),
			env(SID, 'run-1', 8, {
				type: 'tool.failed',
				runId: 'run-1',
				name: 'bash',
				toolCallId: 'bash-2',
				error: 'command stopped by SIGTERM',
			}),
		]);
		const commands = firstRun(state).items.filter((item) => item.kind === 'command');
		expect(commands).toHaveLength(2);
		expect(commands[0] && 'error' in commands[0]).toBe(false);
		expect(commands[1]).toMatchObject({ error: 'command stopped by SIGTERM' });
	});
});
