import { describe, expect, it } from 'vitest';
import { createIpc, type OutputSink } from '../cli';
import { fakeClaude, recordedScript } from '../claude/fixtures/fake-claude';
import { registerClaudeProvider } from '../claude/index';
import { defaultProviderRegistry } from '../providers/registry';
import type { ProviderApprovalReply, ProviderQuestionReply } from '../interaction-types';

type WireFrame = {
	type: string;
	id?: string;
	accepted?: boolean;
	error?: string;
	approvalId?: string;
	questionId?: string;
};

function captureIpc() {
	const writes: string[] = [];
	const stdout: OutputSink = {
		write: (chunk: string): boolean => {
			writes.push(chunk);
			return true;
		},
		once: () => undefined,
	};
	return {
		ipc: createIpc({ stdout }),
		frames: (): WireFrame[] =>
			writes
				.join('')
				.split('\n')
				.filter(Boolean)
				.map((line): WireFrame => JSON.parse(line)),
	};
}

function ack(frames: WireFrame[], id: string): WireFrame | undefined {
	return frames.find((frame) => frame.type === 'bridge.command_ack' && frame.id === id);
}

async function waitForFrame(frames: () => WireFrame[], type: string): Promise<WireFrame> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const frame = frames().find((candidate) => candidate.type === type);
		if (frame) return frame;
		await new Promise((resolve) => setImmediate(resolve));
	}
	throw new Error(`no ${type} frame arrived`);
}

describe('CLI provider interaction routing', () => {
	it('routes correlated approval replies without synthesizing another request event', async () => {
		let settle!: (reply: ProviderApprovalReply) => void;
		defaultProviderRegistry.setProvider(async (context, emit) => ({
			async sendPrompt(_prompt, runId) {
				emit({ type: 'run.started', runId, sessionId: context.sessionId });
				emit({
					type: 'approval.requested',
					sessionId: context.sessionId,
					runId,
					approvalId: 'approval-live',
					reason: 'Run focused tests',
				});
				const reply = await new Promise<ProviderApprovalReply>((resolve) => {
					settle = resolve;
				});
				emit({ type: 'run.completed', runId, summary: `${reply.decision}/${reply.scope}` });
			},
			async respondToApproval(reply) {
				if (reply.approvalId !== 'approval-live') {
					throw new Error(`INTERACTION_REQUEST_NOT_FOUND: ${reply.approvalId}`);
				}
				settle(reply);
			},
			async cancel() {},
			async close() {},
		}));
		const { ipc, frames } = captureIpc();
		await ipc.run(
			`{"cmd":"start_session","id":"start","sessionId":"session","workstreamId":"workstream"}`,
		);
		await ipc.run(
			'{"cmd":"send_prompt","id":"send","sessionId":"session","runId":"run","prompt":"test"}',
		);

		await ipc.run(
			'{"cmd":"approve","id":"unknown","sessionId":"session","runId":"run","approvalId":"missing","decision":"allow"}',
		);
		expect(ack(frames(), 'unknown')).toMatchObject({
			accepted: false,
			error: expect.stringContaining('INTERACTION_REQUEST_NOT_FOUND'),
		});

		await ipc.run(
			'{"cmd":"approve","id":"allow","sessionId":"session","runId":"run","approvalId":"approval-live","decision":"approve"}',
		);
		expect(ack(frames(), 'allow')).toMatchObject({ accepted: true });
		await ipc.drain();
		expect(frames().filter((frame) => frame.type === 'approval.requested')).toHaveLength(1);
		expect(frames()).toContainEqual(expect.objectContaining({ type: 'run.completed' }));
	});

	it('routes structured question answers with full correlation', async () => {
		let settle!: (reply: ProviderQuestionReply) => void;
		defaultProviderRegistry.setProvider(async (context, emit) => ({
			async sendPrompt(_prompt, runId) {
				emit({ type: 'run.started', runId, sessionId: context.sessionId });
				emit({
					type: 'question.requested',
					sessionId: context.sessionId,
					runId,
					questionId: 'question-live',
					questions: [
						{
							id: 'question-live:0',
							prompt: 'Which runner?',
							options: [{ label: 'Vitest' }],
							multiSelect: false,
							allowFreeText: false,
						},
					],
				});
				await new Promise<ProviderQuestionReply>((resolve) => {
					settle = resolve;
				});
				emit({ type: 'run.completed', runId, summary: 'answered' });
			},
			async respondToQuestion(reply) {
				if (reply.questionId !== 'question-live') {
					throw new Error(`INTERACTION_REQUEST_NOT_FOUND: ${reply.questionId}`);
				}
				settle(reply);
			},
			async cancel() {},
			async close() {},
		}));
		const { ipc, frames } = captureIpc();
		await ipc.run(
			`{"cmd":"start_session","id":"start-q","sessionId":"session-q","workstreamId":"workstream"}`,
		);
		await ipc.run(
			'{"cmd":"send_prompt","id":"send-q","sessionId":"session-q","runId":"run-q","prompt":"test"}',
		);
		await ipc.run(
			'{"cmd":"answer_question","id":"answer-q","sessionId":"session-q","runId":"run-q","questionId":"question-live","answers":[{"questionId":"question-live:0","values":["Vitest"]}]}',
		);
		expect(ack(frames(), 'answer-q')).toMatchObject({ accepted: true });
		await ipc.drain();
		expect(frames()).toContainEqual(expect.objectContaining({ type: 'run.completed' }));
	});

	it('rejects interaction commands when the active handle lacks reply capability', async () => {
		let release!: () => void;
		defaultProviderRegistry.setProvider(async () => ({
			async sendPrompt() {
				await new Promise<void>((resolve) => {
					release = resolve;
				});
			},
			async cancel() {
				release();
			},
			async close() {},
		}));
		const { ipc, frames } = captureIpc();
		await ipc.run(
			`{"cmd":"start_session","id":"start-u","sessionId":"session-u","workstreamId":"workstream"}`,
		);
		await ipc.run(
			'{"cmd":"send_prompt","id":"send-u","sessionId":"session-u","runId":"run-u","prompt":"hold"}',
		);
		await ipc.run(
			'{"cmd":"approve","id":"approve-u","sessionId":"session-u","runId":"run-u","approvalId":"approval-u","decision":"deny"}',
		);
		await ipc.run(
			'{"cmd":"answer_question","id":"answer-u","sessionId":"session-u","runId":"run-u","questionId":"question-u","answers":[{"questionId":"question-u:0","values":["No"]}]}',
		);
		expect(ack(frames(), 'approve-u')).toMatchObject({
			accepted: false,
			error: expect.stringContaining('APPROVAL_UNSUPPORTED'),
		});
		expect(ack(frames(), 'answer-u')).toMatchObject({
			accepted: false,
			error: expect.stringContaining('QUESTION_UNSUPPORTED'),
		});
		await ipc.run('{"cmd":"cancel_run","id":"cancel-u","sessionId":"session-u","runId":"run-u"}');
		await ipc.drain();
	});

	it('routes an approval from the wire through Claude Code and lets the tool run', async () => {
		const claude = fakeClaude([recordedScript('write')]);
		registerClaudeProvider(defaultProviderRegistry, {
			findExecutable: () => '/opt/claude/bin/claude',
			query: claude.query,
		});
		const { ipc, frames } = captureIpc();
		await ipc.run(
			'{"cmd":"start_session","id":"start-c","sessionId":"session-c","workstreamId":"workstream","worktreePath":"/work/repo"}',
		);
		await ipc.run(
			'{"cmd":"send_prompt","id":"send-c","sessionId":"session-c","runId":"run-c","prompt":"Create probe.txt"}',
		);

		const request = await waitForFrame(frames, 'approval.requested');
		await ipc.run(
			`{"cmd":"approve","id":"approve-c","sessionId":"session-c","runId":"run-c","approvalId":"${request.approvalId}","decision":"allow","scope":"session"}`,
		);
		await ipc.drain();

		expect(ack(frames(), 'approve-c')).toMatchObject({ accepted: true });
		expect(claude.runs[0]?.permissionResults).toEqual([
			expect.objectContaining({
				behavior: 'allow',
				updatedPermissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }],
			}),
		]);
		expect(frames()).toContainEqual(
			expect.objectContaining({ type: 'file.changed', path: '/work/repo/probe.txt' }),
		);
		expect(frames().at(-1)).toMatchObject({ type: 'run.completed', runId: 'run-c' });
	});
});
