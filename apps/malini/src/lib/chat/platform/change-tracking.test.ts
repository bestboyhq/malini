import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
	ipcMain: { handle: vi.fn() },
	BrowserWindow: { getAllWindows: () => [] },
}));

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { realGit } from '$main/git/fixtures.test-support';
import { isRecord, scalar } from '$main/db/rows';
import { createCheckoutResolver } from '$shared/repositories/repositories.platform';
import { getRunChange } from './changes.repository';
import { listEventRowsForSession } from './events.repository';
import { AgentRunLeases, reapOrphansOnStartup } from './agent/lifecycle';
import { startAgentService, type AgentService } from './agent/service';
import {
	createTestContext,
	seedWorkstream,
	waitFor,
	writeFakeBridge,
	type FakeBridge,
	type TestContext,
} from './agent/test-support';
import { installCheckpoints } from './checkpoints/commands';
import { getRun } from './runs.repository';

let test: TestContext;
let fake: FakeBridge;
let service: AgentService;

beforeEach(() => {
	test = createTestContext();
	fake = writeFakeBridge();
});

afterEach(async () => {
	await service?.stop();
	fake.cleanup();
	test.cleanup();
});

async function gitWorkstream(workstreamId: string): Promise<string> {
	const checkout = seedWorkstream(test.db, test.appDataRoot, workstreamId);
	await realGit(checkout, ['init', '-q']);
	await realGit(checkout, ['config', 'user.name', 'Change Tracking']);
	await realGit(checkout, ['config', 'user.email', 'tracking@example.com']);
	writeFileSync(join(checkout, 'readme.txt'), 'base\n');
	await realGit(checkout, ['add', '.']);
	await realGit(checkout, ['commit', '-q', '-m', 'base']);
	return checkout;
}

async function boot(env: Record<string, string> = {}): Promise<void> {
	const leases = new AgentRunLeases();
	const checkpoints = installCheckpoints(test.context, {
		resolver: createCheckoutResolver({ db: test.db, appDataRoot: test.appDataRoot }),
		leases,
	});
	service = await startAgentService(test.context, {
		processFactory: fake.supervisorConfig().processFactory,
		bridgeScriptPath: fake.scriptPath,
		spawnEnvironment: () => ({ PATH: process.env['PATH'] ?? '/usr/bin:/bin', ...env }),
		leases,
		hooks: {
			captureCheckpoint: (input) => checkpoints.captureRunStart(input),
			onRunFinished: async ({ runId }) => {
				await checkpoints.captureRunFinish(runId);
			},
		},
		log: () => {},
	});
}

async function invoke(command: string, args: unknown): Promise<unknown> {
	const response = await test.context.commands.invoke({ command, args });
	if (!response.ok) throw new Error(response.error);
	return response.value;
}

async function startChat(workstreamId: string): Promise<string> {
	const sessionId = await invoke('chat.start-session', { workstreamId });
	if (typeof sessionId !== 'string') throw new Error('chat.start-session returned no id');
	return sessionId;
}

async function sessionChanges(
	workstreamId: string,
	sessionId: string,
): Promise<Record<string, unknown>> {
	const changes = await invoke('chat.session-changes', { workstreamId, sessionId });
	if (!isRecord(changes)) throw new Error('chat.session-changes returned no object');
	return changes;
}

describe('chat change tracking', () => {
	it('a new chat lists its first run even when the run ends before the bridge acknowledges it', async () => {
		await gitWorkstream('ws-1');
		await boot({ FAKE_BRIDGE_ACK_DELAY_MS: '150' });
		const sessionId = await startChat('ws-1');
		const runId = await invoke('chat.send-prompt', {
			sessionId,
			prompt: 'EDIT:agent.txt',
			clientRequestId: 'req-first',
		});
		expect(runId).toBe('run-req-first');
		await waitFor(() => getRun(test.db, 'run-req-first')?.completedAt !== null);
		await service.runtime.settlePump();
		await waitFor(() => getRunChange(test.db, 'run-req-first') !== null, 2_000, 'end snapshot');

		const changes = await sessionChanges('ws-1', sessionId);
		expect(changes['files']).toEqual([
			{
				path: 'agent.txt',
				additions: 1,
				deletions: 0,
				isBinary: false,
				runIds: ['run-req-first'],
			},
		]);
		expect(changes).not.toHaveProperty('captureState');
	});

	it('a prompt whose starting point cannot be saved is refused and nothing runs', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-plain');
		await boot();
		const sessionId = await startChat('ws-plain');

		await expect(
			invoke('chat.send-prompt', { sessionId, prompt: 'EDIT:agent.txt' }),
		).rejects.toThrow(/^The prompt was not sent because the workstream state before it/u);
		expect(scalar(test.db, 'SELECT COUNT(*) FROM agent_runs')).toBe(0);
		expect(
			listEventRowsForSession(test.db, sessionId, 0).filter((row) => row.kind === 'user.message'),
		).toEqual([]);
	});

	it('a run the app lost mid-way is tracked once the chat is opened again', async () => {
		await gitWorkstream('ws-1');
		await boot();
		const sessionId = await startChat('ws-1');
		await invoke('chat.send-prompt', {
			sessionId,
			prompt: 'EDIT:lost.txt HANG',
			clientRequestId: 'req-lost',
		});
		await waitFor(() => listEventRowsForSession(test.db, sessionId, 0).length > 2);
		expect(reapOrphansOnStartup(test.db)).toBe(1);

		const changes = await sessionChanges('ws-1', sessionId);
		expect(changes['files']).toEqual([
			{ path: 'lost.txt', additions: 1, deletions: 0, isBinary: false, runIds: ['run-req-lost'] },
		]);
		expect(changes).not.toHaveProperty('captureState');
	});

	it('a prompt the bridge never takes leaves a tracked, empty run', async () => {
		await gitWorkstream('ws-1');
		await boot({ FAKE_BRIDGE_REJECT_PROMPT: 'NO_SESSION: no active session' });
		const sessionId = await startChat('ws-1');
		await expect(
			invoke('chat.send-prompt', { sessionId, prompt: 'hello', clientRequestId: 'req-x' }),
		).rejects.toThrow('bridge unavailable');

		expect(getRunChange(test.db, 'run-req-x')?.files).toEqual([]);
		const changes = await sessionChanges('ws-1', sessionId);
		expect(changes['files']).toEqual([]);
		expect(changes).not.toHaveProperty('captureState');
	});
});
