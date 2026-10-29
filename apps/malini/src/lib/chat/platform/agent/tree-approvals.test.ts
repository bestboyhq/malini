import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get, run, scalar } from '$main/db/rows';
import {
	finalizeInteractionResponse,
	getInteraction,
	prepareInteractionResponse,
	recordPendingInteraction,
} from '../interactions.repository';
import { rememberPermissionRule } from '../permissions.repository';
import { maliniActionFingerprint, maliniActionPermission } from '../permissions.service';
import { getRun } from '../runs.repository';
import { seedInteractionContext } from '../test-support';
import { AgentRunLeases } from './lifecycle';
import { BridgeRuntime } from './runtime';
import {
	createTestContext,
	envelopesOn,
	seedOpenRun,
	seedSession,
	seedWorkstream,
	waitFor,
	writeFakeBridge,
	type FakeBridge,
	type TestContext,
} from './test-support';

const NOW = '2026-10-28T09:00:00.000Z';

let test: TestContext;
let fake: FakeBridge;
let runtime: BridgeRuntime | null;

beforeEach(() => {
	test = createTestContext();
	fake = writeFakeBridge();
	runtime = null;
	seedWorkstream(test.db, test.appDataRoot, 'lead');
	seedWorkstream(test.db, test.appDataRoot, 'api');
	seedWorkstream(test.db, test.appDataRoot, 'other');
	run(test.db, `UPDATE workstreams SET name = 'Home', scope = 'home' WHERE id = 'lead'`);
	run(
		test.db,
		`UPDATE workstreams SET name = 'Api analytics', started_by = 'lead' WHERE id = 'api'`,
	);
	run(test.db, `UPDATE workstreams SET name = 'Other work' WHERE id = 'other'`);
	seedSession(test.db, 'lead-chat', 'lead');
	run(
		test.db,
		`INSERT INTO job_definitions
		 (id, name, instructions, model, effort, runs_in, skills, created_at, updated_at)
		 VALUES ('notes', 'Release notes', 'Write them.', 'opus', 'high', 'workstream', '[]', ?, ?)`,
		NOW,
		NOW,
	);
});

afterEach(async () => {
	await runtime?.stop();
	fake.cleanup();
	test.cleanup();
});

async function call(tool: string, input: object): Promise<void> {
	runtime = new BridgeRuntime({
		db: test.db,
		events: test.events,
		appDataRoot: test.appDataRoot,
		supervisorConfig: fake.supervisorConfig(),
		leases: new AgentRunLeases(),
		log: () => {},
	});
	await runtime.start();
	const supervisor = await runtime.ensureSessionReady('lead-chat');
	seedOpenRun(test.db, 'run-1', 'lead-chat');
	await supervisor.sendCommand({
		cmd: 'send_prompt',
		id: 'p',
		sessionId: 'lead-chat',
		runId: 'run-1',
		prompt: `MALINI_APPROVAL:${tool}:${JSON.stringify(input)}`,
	});
}

async function answered(): Promise<void> {
	await waitFor(() => getRun(test.db, 'run-1')?.completedAt !== null, 10_000, 'the run to go on');
	await runtime?.settlePump();
}

function approval() {
	return getInteraction(test.db, 'approval', 'lead-chat', 'run-1', 'approval-1');
}

function asked(): boolean {
	return envelopesOn(test.events).some(
		(envelope) => envelope.event['type'] === 'approval.requested',
	);
}

describe('Malini calls inside the chat’s own tree', () => {
	it('archives a workstream the chat started once, without asking, and records it as automatic', async () => {
		await call('workstreams_archive', { workstream: 'Api analytics' });
		await answered();

		expect(getRun(test.db, 'run-1')?.summary).toBe('approved:allow:once');
		expect(asked()).toBe(false);
		expect(approval()).toMatchObject({
			state: 'resolved',
			decision: 'allow',
			scope: 'once',
			source: 'auto',
			response: {
				decision: 'allow',
				scope: 'once',
				tree: true,
				permission: { resources: [{ kind: 'action', value: 'workstreams.archive' }] },
			},
		});
		expect(scalar(test.db, 'SELECT COUNT(*) FROM agent_permission_rules')).toBe(0);
	}, 15_000);

	it('runs a job that ships nothing in a workstream the chat started without asking', async () => {
		await call('jobs_run', { job: 'Release notes', workstream: 'api' });
		await answered();

		expect(getRun(test.db, 'run-1')?.summary).toBe('approved:allow:once');
		expect(asked()).toBe(false);
		expect(approval()).toMatchObject({
			source: 'auto',
			response: {
				tree: true,
				permission: { resources: [{ kind: 'action', value: 'jobs.run:notes' }] },
			},
		});
	}, 15_000);

	it('asks the user about a workstream the chat did not start', async () => {
		await call('workstreams_archive', { workstream: 'Other work' });
		await waitFor(() => approval() !== null, 10_000, 'the approval request');
		await runtime?.settlePump();

		expect(approval()?.state).toBe('pending');
		expect(asked()).toBe(true);
		expect(getRun(test.db, 'run-1')?.completedAt).toBeNull();
		run(test.db, `UPDATE agent_runs SET completed_at = 'x' WHERE id = 'run-1'`);
	}, 15_000);

	it('keeps the scope of a rule the user saved instead of allowing it once', async () => {
		rememberPermissionRule(test.db, {
			id: 'rule-archive',
			scope: 'workstream',
			workstreamId: 'lead',
			sessionId: 'lead-chat',
			permissionFingerprint: maliniActionFingerprint('workstreams.archive'),
			permissionJson: JSON.stringify(maliniActionPermission('workstreams.archive')),
			createdRunId: null,
			createdRequestId: 'seed',
			createdAt: NOW,
		});
		await call('workstreams_archive', { workstream: 'api' });
		await answered();

		expect(getRun(test.db, 'run-1')?.summary).toBe('approved:allow:workstream');
		expect(approval()).toMatchObject({ scope: 'workstream', source: 'auto' });
		expect(approval()?.response).not.toHaveProperty('tree');
		expect(
			get<{ last_used_at: string | null }>(
				test.db,
				`SELECT last_used_at FROM agent_permission_rules WHERE id = 'rule-archive'`,
			)?.last_used_at,
		).not.toBeNull();
	}, 15_000);
});

describe('finalizeInteractionResponse', () => {
	it('records an automatic allow without a rule only for this once', () => {
		seedInteractionContext(test.db, 'ws-tree', 'session-tree', 'run-tree');
		const permission = maliniActionPermission('workstreams.archive');
		const resolve = (
			requestId: string,
			scope: 'once' | 'session',
			matchedRuleId: string | null,
		) => {
			recordPendingInteraction(test.db, {
				kind: 'approval',
				sessionId: 'session-tree',
				runId: 'run-tree',
				requestId,
				requestPayload: { approvalId: requestId, permission },
				permission,
				permissionFingerprint: maliniActionFingerprint('workstreams.archive'),
				requestedAt: NOW,
			});
			const response = { decision: 'allow', scope, permission, tree: true };
			prepareInteractionResponse(test.db, {
				kind: 'approval',
				sessionId: 'session-tree',
				runId: 'run-tree',
				requestId,
				suppliedPermission: permission,
				intendedResponse: response,
			});
			return () =>
				finalizeInteractionResponse(test.db, {
					kind: 'approval',
					sessionId: 'session-tree',
					runId: 'run-tree',
					requestId,
					intendedResponse: response,
					decision: 'allow',
					scope,
					source: 'auto',
					decidedAt: NOW,
					matchedRuleId,
				});
		};

		expect(resolve('approval-session', 'session', null)).toThrow(
			'invalid interaction resolution shape',
		);
		expect(resolve('approval-ruled-once', 'once', 'rule-missing')).toThrow(
			'invalid interaction resolution shape',
		);
		expect(resolve('approval-once', 'once', null)()).toBeNull();
		expect(
			getInteraction(test.db, 'approval', 'session-tree', 'run-tree', 'approval-once'),
		).toMatchObject({ state: 'resolved', decision: 'allow', scope: 'once', source: 'auto' });
	});
});
