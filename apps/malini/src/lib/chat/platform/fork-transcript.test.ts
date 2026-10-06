import { describe, expect, it } from 'vitest';
import type { AgentEventRow } from './events.repository';
import { forkTranscript, forkTranscriptFileName } from './fork-transcript';

function log(...events: ReadonlyArray<readonly [string, string, Record<string, unknown>]>) {
	return events.map(([runId, kind, payload], index): AgentEventRow => ({
		seq: index + 1,
		runId,
		kind,
		payload,
	}));
}

function turn(runId: string, prompt: string, answer: string) {
	return [
		[runId, 'run.started', {}],
		[runId, 'user.message', { text: prompt }],
		[runId, 'assistant.message', { text: answer }],
		[runId, 'run.completed', { summary: answer }],
	] as const;
}

function lastSeq(rows: readonly AgentEventRow[], runId: string): number {
	return Math.max(...rows.filter((row) => row.runId === runId).map((row) => row.seq));
}

describe('the transcript a forked chat starts from', () => {
	it('writes each prompt verbatim, the prose, one line of tool activity, the result and failures', () => {
		const rows = log(
			['run-1', 'run.started', {}],
			[
				'run-1',
				'user.message',
				{
					text: '  Fix the login flow\n\nIt loops after **refresh**.  ',
					attachments: [
						{ id: 'att-1', displayName: 'trace.log' },
						{ id: 'att-2', displayName: 'shot.png' },
					],
				},
			],
			['run-1', 'thinking.message', { text: 'private reasoning' }],
			['run-1', 'assistant.message', { text: 'Looking at the auth code.' }],
			['run-1', 'tool.started', { name: 'read' }],
			['run-1', 'tool.completed', { name: 'read', output: 'file contents' }],
			['run-1', 'tool.started', { name: 'read' }],
			['run-1', 'tool.started', { name: 'edit' }],
			['run-1', 'tool.started', { name: 'bash' }],
			['run-1', 'tool.failed', { name: 'bash', error: 'exit 1' }],
			['run-1', 'assistant.message', { text: 'The refresh raced the redirect. Fixed.' }],
			['run-1', 'run.completed', { summary: 'The refresh raced the redirect. Fixed.' }],
			['run-2', 'run.started', {}],
			['run-2', 'user.message', { text: 'Now add a test' }],
			['run-2', 'tool.started', { name: 'write' }],
			['run-2', 'run.failed', { error: 'provider overloaded' }],
			['run-3', 'run.started', {}],
			['run-3', 'user.message', { text: 'Try again' }],
			['run-3', 'run.completed', { summary: 'Stopped without finishing: out of budget.' }],
			['run-4', 'run.started', {}],
			['run-4', 'user.message', { text: 'Stop' }],
			['run-4', 'run.failed', { error: 'cancelled' }],
		);

		expect(forkTranscript('Fix login', rows, lastSeq(rows, 'run-4'))).toBe(
			[
				'# Transcript of Fix login',
				'## User',
				'Fix the login flow\n\nIt loops after **refresh**.',
				'[Attached: trace.log, shot.png]',
				'## Assistant',
				'Looking at the auth code.',
				'The refresh raced the redirect. Fixed.',
				'[4 tool calls elided: 2 read, 1 bash, 1 edit]',
				'## User',
				'Now add a test',
				'## Assistant',
				'[1 tool call elided: 1 write]',
				'[Run failed: provider overloaded]',
				'## User',
				'Try again',
				'## Assistant',
				'[Result: Stopped without finishing: out of budget.]',
				'## User',
				'Stop',
				'## Assistant',
				'[Run cancelled]',
			].join('\n\n') + '\n',
		);
	});

	it('ends at the forked run and leaves out runs an undo reverted', () => {
		const rows = log(
			...turn('run-1', 'Keep this', 'kept'),
			...turn('run-2', 'Undo this', 'undone'),
			['run-1', 'checkpoint.restored', { fromSeq: 5, toSeq: 8 }],
			['run-1', 'turn.superseded', { fromSeq: 5, toSeq: 8, restoreSeq: 9 }],
			...turn('run-3', 'Reverted elsewhere', 'obsolete'),
			['run-3', 'run.obsoleted', { restoreSeq: 99 }],
			...turn('run-4', 'Fork here', 'forked'),
			['run-4', 'session.branched', { parentSessionId: 's-1', childSessionId: 's-2' }],
			...turn('run-5', 'After the fork', 'later'),
		);

		const transcript = forkTranscript('Chat', rows, lastSeq(rows, 'run-4') - 1);

		expect(transcript).toContain('Keep this');
		expect(transcript).toContain('Fork here');
		expect(transcript).not.toContain('Undo this');
		expect(transcript).not.toContain('Reverted elsewhere');
		expect(transcript).not.toContain('After the fork');
	});

	it('keeps undone runs when forking from inside them, as they stood before the undo', () => {
		const rows = log(
			...turn('run-1', 'Before', 'before'),
			...turn('run-2', 'Undone work', 'undone'),
			['run-1', 'checkpoint.restored', { fromSeq: 5, toSeq: 8 }],
			['run-1', 'turn.superseded', { fromSeq: 5, toSeq: 8, restoreSeq: 9 }],
			...turn('run-3', 'New talk', 'new'),
		);

		const transcript = forkTranscript('Chat', rows, 8);

		expect(transcript).toContain('Before');
		expect(transcript).toContain('Undone work');
		expect(transcript).not.toContain('New talk');
	});

	it('names what a prompt points at instead of leaking internal ids', () => {
		const rows = log(
			[
				'run-1',
				'user.message',
				{
					text: '[[attachment:att-1]] fails like [[transcript:sess-9]], see [[context:src/auth.ts]] and [[issue:https://github.com/o/r/issues/1]]',
					attachments: [
						{ id: 'att-1', displayName: 'trace.log' },
						{ id: 'att-2', displayName: 'shot.png' },
					],
					transcriptReferences: [{ sessionId: 'sess-9', label: 'Earlier chat' }],
				},
			],
			['run-1', 'run.completed', { summary: 'done' }],
		);

		const transcript = forkTranscript('Chat', rows, 2);

		expect(transcript).toContain(
			'[attachment: trace.log] fails like [transcript: Earlier chat], see [context: src/auth.ts] and [issue: github.com/o/r/issues/1]\n\n[Attached: shot.png]',
		);
		expect(transcript).not.toMatch(/att-1|sess-9|\[\[/u);
	});

	it('refuses a seq the chat never recorded', () => {
		expect(() => forkTranscript('Chat', log(...turn('run-1', 'Hi', 'Hello')), 42)).toThrow(
			/no event at seq `42`/u,
		);
	});

	it('stays under the cap by keeping the first prompt and the latest runs', () => {
		const bulk = 'x'.repeat(1_000);
		const rows = log(
			...Array.from({ length: 40 }, (_, index) =>
				turn(`run-${index + 1}`, `Prompt ${index + 1}`, `${bulk} answer ${index + 1}`),
			).flat(),
		);

		const transcript = forkTranscript('Chat', rows, lastSeq(rows, 'run-40'), 10_000);

		expect(Buffer.byteLength(transcript)).toBeLessThanOrEqual(10_000);
		expect(transcript).toContain('Prompt 1\n');
		expect(transcript).toContain('Prompt 40\n');
		expect(transcript).not.toContain('Prompt 2\n');
		expect(transcript).toMatch(/\n\[\d+ runs elided\]\n/u);
	});

	it('truncates a single run that alone exceeds the cap', () => {
		const rows = log(...turn('run-1', 'é'.repeat(20_000), 'done'));

		const transcript = forkTranscript('Chat', rows, lastSeq(rows, 'run-1'), 4_000);

		expect(Buffer.byteLength(transcript)).toBeLessThanOrEqual(4_000);
		expect(transcript).toContain('[truncated]');
		expect(transcript).not.toContain('�');
	});
});

describe('the file a forked transcript is attached as', () => {
	it('is named after the chat and stays a single safe file name', () => {
		expect(forkTranscriptFileName('Fix the login flow')).toBe(
			'Transcript of Fix the login flow.md',
		);
		expect(forkTranscriptFileName('src/app\\main.ts\u0007 ')).toBe(
			'Transcript of src app main.ts.md',
		);
		expect(forkTranscriptFileName('  ')).toBe('Transcript of Chat.md');
		expect(Buffer.byteLength(forkTranscriptFileName('🙂'.repeat(200)))).toBeLessThanOrEqual(255);
	});
});
