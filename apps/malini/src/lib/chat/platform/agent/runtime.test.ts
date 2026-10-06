import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listEventRowsForSession } from '../events.repository';
import { getInteraction } from '../interactions.repository';
import { get, run } from '$main/db/rows';
import { getRun } from '../runs.repository';
import { getSession } from '../sessions.repository';
import { rememberPermissionRule } from '../permissions.repository';
import { normalizeRememberablePermission } from '../permissions.service';
import { AgentRunLeases, BRIDGE_INTERRUPTED_ERROR } from './lifecycle';
import type { BridgeEvent } from './protocol';
import { BridgeRuntime, pumpStep, SessionCorrelator, type RunFinishedInput } from './runtime';
import {
	createTestContext,
	envelopesOn,
	externalReadPath,
	seedOpenRun,
	seedSession,
	seedWorkstream,
	waitFor,
	writeFakeBridge,
	type FakeBridge,
	type TestContext,
} from './test-support';

let test: TestContext;
let fake: FakeBridge;
const cleanups: Array<() => Promise<void> | void> = [];

beforeEach(() => {
	test = createTestContext();
	fake = writeFakeBridge();
});

afterEach(async () => {
	while (cleanups.length > 0) await cleanups.pop()?.();
	fake.cleanup();
	test.cleanup();
});

function runtimeWith(
	env: Record<string, string> = {},
	hooks: { onRunFinished?: (input: RunFinishedInput) => Promise<void> } = {},
) {
	const runtime = new BridgeRuntime({
		db: test.db,
		events: test.events,
		appDataRoot: test.appDataRoot,
		supervisorConfig: fake.supervisorConfig(env),
		leases: new AgentRunLeases(),
		hooks,
		log: () => {},
	});
	cleanups.push(() => runtime.stop());
	return runtime;
}

describe('SessionCorrelator', () => {
	it('stamps a per-session monotonic seq from one, independent across sessions, none for ephemeral or unknown runs', () => {
		const correlator = new SessionCorrelator();
		expect(correlator.resolve({ type: 'run.started', runId: 'r1', sessionId: 'a' })?.seq).toBe(1);
		expect(
			correlator.resolve({ type: 'assistant.delta', runId: 'r1', contentId: 'c', text: 't' }),
		).toMatchObject({
			sessionId: 'a',
			seq: -1,
			ephemeral: true,
		});
		expect(correlator.resolve({ type: 'assistant.message', runId: 'r1', text: 't' })?.seq).toBe(2);
		expect(correlator.resolve({ type: 'run.started', runId: 'r2', sessionId: 'b' })?.seq).toBe(1);
		expect(correlator.resolve({ type: 'file.changed', runId: 'unknown', path: 'p' })).toBeNull();
		expect(
			correlator.resolve({ type: 'session.state', sessionId: 'a', status: 'idle' }),
		).toMatchObject({
			sessionId: 'a',
			runId: '',
			seq: 3,
		});
		expect(correlator.resolve({ type: 'usage.updated', runId: 'r2', interim: true })?.seq).toBe(-1);
		expect(correlator.resolve({ type: 'usage.updated', runId: 'r2' })?.seq).toBe(2);
	});
});

describe('pumpStep', () => {
	function seedRun(): void {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		seedSession(test.db, 'sess-1', 'ws-1', 'idle');
		seedOpenRun(test.db, 'run-1', 'sess-1');
	}

	it('persists durable events with the row seq, skips ephemeral ones, and closes the run on a terminal event', () => {
		seedRun();
		const correlator = new SessionCorrelator();
		const log: string[] = [];
		const step = (event: BridgeEvent) =>
			pumpStep(correlator, test.db, event, (line) => log.push(line));

		expect(step({ type: 'run.started', runId: 'run-1', sessionId: 'sess-1' })).toEqual({
			sessionId: 'sess-1',
			runId: 'run-1',
			seq: 1,
			event: { type: 'run.started', runId: 'run-1', sessionId: 'sess-1' },
		});
		expect(getSession(test.db, 'sess-1')?.status).toBe('running');
		expect(step({ type: 'assistant.delta', runId: 'run-1', contentId: 'c', text: 'par' })).toEqual({
			sessionId: 'sess-1',
			runId: 'run-1',
			seq: -1,
			ephemeral: true,
			event: { type: 'assistant.delta', runId: 'run-1', contentId: 'c', text: 'par' },
		});
		expect(
			step({
				type: 'session.state',
				sessionId: 'sess-1',
				status: 'running',
				providerSessionId: 'prov-1',
			})?.seq,
		).toBe(2);
		expect(getSession(test.db, 'sess-1')).toMatchObject({
			providerSessionId: 'prov-1',
			status: 'running',
		});
		expect(step({ type: 'run.completed', runId: 'run-1', summary: 'ok' })?.seq).toBe(3);
		expect(getRun(test.db, 'run-1')).toMatchObject({ summary: 'ok', error: null });
		expect(getRun(test.db, 'run-1')?.completedAt).not.toBeNull();
		expect(getSession(test.db, 'sess-1')?.status).toBe('completed');
		expect(listEventRowsForSession(test.db, 'sess-1', 0).map((row) => row.kind)).toEqual([
			'run.started',
			'session.state',
			'run.completed',
		]);
		expect(step({ type: 'file.changed', runId: 'run-unknown', path: 'x' })).toBeNull();
		expect(log).toEqual([]);
	});

	it('records an interaction request as pending before it becomes visible, and drops a stale one', () => {
		seedRun();
		const correlator = new SessionCorrelator();
		const envelope = pumpStep(
			correlator,
			test.db,
			{
				type: 'question.requested',
				sessionId: 'sess-1',
				runId: 'run-1',
				questionId: 'q-1',
				questions: [
					{
						id: 'q',
						prompt: 'p',
						options: [{ label: 'a' }],
						multiSelect: false,
						allowFreeText: false,
					},
				],
			},
			() => {},
		);
		expect(envelope).toMatchObject({
			seq: 1,
			event: { type: 'question.requested', sessionId: 'sess-1' },
		});
		expect(getInteraction(test.db, 'question', 'sess-1', 'run-1', 'q-1')?.state).toBe('pending');
		expect(getSession(test.db, 'sess-1')?.status).toBe('waiting_for_approval');

		const log: string[] = [];
		expect(
			pumpStep(
				correlator,
				test.db,
				{
					type: 'approval.requested',
					sessionId: 'sess-1',
					runId: 'run-gone',
					approvalId: 'a',
					reason: 'r',
				},
				(line) => log.push(line),
			),
		).toBeNull();
		expect(log[0]).toContain('dropping the request event');
	});
});

describe('BridgeRuntime with the fake bridge', () => {
	it('pumps live events onto the event channel with persisted seqs and closes the run', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		seedSession(test.db, 'sess-1', 'ws-1');
		const runtime = runtimeWith();
		expect(await runtime.start()).toBe(true);
		const supervisor = await runtime.ensureSessionReady('sess-1');
		seedOpenRun(test.db, 'run-1', 'sess-1');
		await supervisor.sendCommand({
			cmd: 'send_prompt',
			id: 'p',
			sessionId: 'sess-1',
			runId: 'run-1',
			prompt: 'hi',
		});
		await waitFor(() => getRun(test.db, 'run-1')?.completedAt !== null);
		await runtime.settlePump();
		const envelopes = envelopesOn(test.events);
		expect(
			envelopes.map((envelope) => [
				envelope.event['type'],
				envelope.seq,
				envelope.ephemeral ?? false,
			]),
		).toEqual([
			['session.state', 1, false],
			['run.started', 2, false],
			['assistant.delta', -1, true],
			['assistant.message', 3, false],
			['usage.updated', -1, true],
			['usage.updated', 4, false],
			['run.completed', 5, false],
			['session.state', 6, false],
		]);
		expect(getSession(test.db, 'sess-1')).toMatchObject({
			providerSessionId: 'prov-sess-1',
			status: 'completed',
		});
		expect(getRun(test.db, 'run-1')?.summary).toBe('done');
	});

	it('replaces a dead child: terminalizes its runs, re-registers its sessions, notifies the hook', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		seedSession(test.db, 'sess-1', 'ws-1');
		const finished: RunFinishedInput[] = [];
		const runtime = runtimeWith({}, { onRunFinished: async (input) => void finished.push(input) });
		await runtime.start();
		const first = await runtime.ensureSessionReady('sess-1');
		seedOpenRun(test.db, 'run-1', 'sess-1');
		await first.sendCommand({
			cmd: 'send_prompt',
			id: 'p',
			sessionId: 'sess-1',
			runId: 'run-1',
			prompt: 'CRASH',
		});
		await waitFor(() => !first.isHealthy());

		const replacement = await runtime.ensureReady();
		expect(replacement).not.toBe(first);
		expect(replacement.isHealthy()).toBe(true);
		expect(getRun(test.db, 'run-1')).toMatchObject({ error: BRIDGE_INTERRUPTED_ERROR });
		expect(getSession(test.db, 'sess-1')?.status).toBe('idle');
		expect(finished).toEqual([
			{ sessionId: 'sess-1', runId: 'run-1', workstreamId: 'ws-1', reason: 'bridge-interrupted' },
		]);
		const terminal = envelopesOn(test.events).find(
			(envelope) => envelope.event['type'] === 'run.failed',
		);
		expect(terminal).toMatchObject({
			sessionId: 'sess-1',
			runId: 'run-1',
			event: { error: BRIDGE_INTERRUPTED_ERROR },
		});
		expect(await runtime.ensureSessionReady('sess-1')).toBe(replacement);
		expect(
			get<{ n: number }>(
				test.db,
				"SELECT COUNT(*) AS n FROM agent_events WHERE event LIKE 'session.state%'",
			)?.n,
		).toBeGreaterThanOrEqual(2);
	}, 15_000);

	it('remembers a registration failure per session and refuses that session until re-activated', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		seedSession(test.db, 'sess-1', 'ws-1');
		const runtime = runtimeWith({ FAKE_BRIDGE_REJECT_START: 'START_SESSION_FAILED: nope' });
		await runtime.start();
		await expect(runtime.ensureSessionReady('sess-1')).rejects.toThrow(
			'START_SESSION_FAILED: nope',
		);
		await expect(runtime.ensureSessionReady('missing')).rejects.toThrow(
			'agent session `missing` not found',
		);
	});

	it('auto-approves a remembered read without emitting the request, and audits it', async () => {
		const checkout = seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		seedSession(test.db, 'sess-1', 'ws-1');
		const approvalPath = externalReadPath();
		const permission = {
			capability: 'read',
			resources: [
				{ kind: 'path', value: approvalPath, canonicalValue: approvalPath, boundary: 'external' },
			],
		};
		const normalized = normalizeRememberablePermission(permission, checkout);
		rememberPermissionRule(test.db, {
			id: 'rule-1',
			scope: 'session',
			workstreamId: 'ws-1',
			sessionId: 'sess-1',
			permissionFingerprint: normalized.fingerprint,
			permissionJson: normalized.canonicalJson,
			createdRunId: null,
			createdRequestId: 'seed',
			createdAt: '2026-01-01T00:00:00Z',
		});
		const runtime = runtimeWith({ FAKE_BRIDGE_APPROVAL_PATH: approvalPath });
		await runtime.start();
		const supervisor = await runtime.ensureSessionReady('sess-1');
		seedOpenRun(test.db, 'run-1', 'sess-1');
		await supervisor.sendCommand({
			cmd: 'send_prompt',
			id: 'p',
			sessionId: 'sess-1',
			runId: 'run-1',
			prompt: 'APPROVAL',
		});
		await waitFor(
			() => getRun(test.db, 'run-1')?.completedAt !== null,
			10_000,
			'auto-approved run to finish',
		);
		await runtime.settlePump();
		expect(getRun(test.db, 'run-1')?.summary).toBe('approved:allow:session');
		expect(
			envelopesOn(test.events).some((envelope) => envelope.event['type'] === 'approval.requested'),
		).toBe(false);
		const record = getInteraction(test.db, 'approval', 'sess-1', 'run-1', 'approval-1');
		expect(record).toMatchObject({
			state: 'resolved',
			decision: 'allow',
			scope: 'session',
			source: 'auto',
		});
		expect(
			get<{ last_used_at: string | null }>(
				test.db,
				"SELECT last_used_at FROM agent_permission_rules WHERE id = 'rule-1'",
			)?.last_used_at,
		).not.toBeNull();
	}, 15_000);

	it('emits an approval request as pending when nothing remembers it', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		seedSession(test.db, 'sess-1', 'ws-1');
		const runtime = runtimeWith();
		await runtime.start();
		const supervisor = await runtime.ensureSessionReady('sess-1');
		seedOpenRun(test.db, 'run-1', 'sess-1');
		await supervisor.sendCommand({
			cmd: 'send_prompt',
			id: 'p',
			sessionId: 'sess-1',
			runId: 'run-1',
			prompt: 'APPROVAL',
		});
		await waitFor(
			() => getInteraction(test.db, 'approval', 'sess-1', 'run-1', 'approval-1') !== null,
		);
		await runtime.settlePump();
		expect(getInteraction(test.db, 'approval', 'sess-1', 'run-1', 'approval-1')?.state).toBe(
			'pending',
		);
		expect(
			envelopesOn(test.events).find((envelope) => envelope.event['type'] === 'approval.requested'),
		).toMatchObject({
			event: { approvalId: 'approval-1', sessionId: 'sess-1', runId: 'run-1' },
		});
		expect(getSession(test.db, 'sess-1')?.status).toBe('waiting_for_approval');
		run(test.db, "UPDATE agent_runs SET completed_at = 'x' WHERE id = 'run-1'");
	});

	it('records a start failure without throwing and retries on ensureReady', async () => {
		const runtime = runtimeWith({ FAKE_BRIDGE_STDERR_EXIT: 'no provider' });
		expect(await runtime.start()).toBe(false);
		expect(() => runtime.current()).toThrow(
			'agent bridge is not running: bridge protocol error: agent bridge exited; stderr: no provider',
		);
		await expect(runtime.ensureReady()).rejects.toThrow(
			'agent bridge restart failed: bridge protocol error: agent bridge exited; stderr: no provider',
		);
	}, 10_000);
});
