import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
	ipcMain: { handle: vi.fn() },
	BrowserWindow: { getAllWindows: () => [] },
}));

import type { InvokeResponse } from '$contract/ipc';
import { DockerOwnership } from '$main/docker/ownership';
import { LABEL_APP } from '$main/docker/labels';
import { removeAll } from '$main/fs/test-support';
import { ScriptedRunner } from '$main/process/test-support';
import type { ShutdownOutcome } from '$contract/system';
import { recordStartedContainers } from '$main/docker/records';
import { createTestContext, seedWorkstream } from '$shared/repositories/platform/test-support';
import { registerApp } from './register';
import { createFakeHost } from './test-support';

const BUNDLE = 'app.malini.desktop.test';
const cleanups: Array<() => void | Promise<void>> = [];
const dirs: string[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	removeAll(dirs);
});

describe('graceful shutdown command', () => {
	it('returns the outcome the renderer reads', async () => {
		const calls: string[] = [];
		const runner = new ScriptedRunner()
			.onCommand('docker', ['ps'], {
				kind: 'exit',
				code: 0,
				stdout: `abc\tws-1-db-1\trunning\t${LABEL_APP}=${BUNDLE}\n`,
			})
			.onCommand('docker', ['stop'], { kind: 'exit', code: 0 })
			.onCommand('docker', ['rm'], { kind: 'exit', code: 0 })
			.onCommand('docker', ['inspect'], { kind: 'exit', code: 1, stderr: 'No such object\n' })
			.onCommand('docker', ['network', 'ls'], { kind: 'exit', code: 0, stdout: '' });
		const test = createTestContext();
		cleanups.push(() => test.cleanup());
		seedWorkstream(test.context.db, 'ws-1', `${test.appDataRoot}/workstreams/ws-1`);
		const ownership = new DockerOwnership({
			db: test.context.db,
			runner,
			appDataRoot: test.appDataRoot,
			bundleIdentifier: BUNDLE,
		});
		const service = registerApp(test.context, {
			getMainWindow: () => null,
			host: createFakeHost(),
			ownership,
			runner,
			cancelAgentRuns: () => {
				calls.push('runs');
				return 1;
			},
			containerCount: () => ownership.ownedContainerCount(),
		});
		const invokeShutdown = async (): Promise<InvokeResponse> =>
			test.context.commands.invoke({ command: 'app.shutdown-gracefully', args: {} });
		recordStartedContainers(test.context.db, [
			{
				containerId: 'abc',
				containerName: 'ws-1-db-1',
				bundleIdentifier: BUNDLE,
				appInstanceId: ownership.appInstanceId,
				workstreamId: 'ws-1',
				composeProject: 'ws-1',
				service: 'db',
				owner: 'workstream',
				cwd: '/tmp',
				startedAt: '2026-07-26T00:00:00.000Z',
				appPid: process.pid,
			},
		]);
		expect(ownership.ownedContainerCount()).toBe(1);

		expect(test.context.commands.names()).toContain('app.shutdown-gracefully');
		expect(service.shutdownImpact()).toEqual({ agentRuns: 0, containers: 1 });
		const outcome: ShutdownOutcome = await service.shutdownGracefully();
		expect(outcome).toMatchObject({
			containersRemoved: ['abc'],
			containersUnfinished: [],
			networksRemoved: [],
			agentRunsClosed: 1,
			timedOut: false,
			alreadyReclaimed: false,
			errors: [],
		});
		expect(Object.keys(outcome).sort()).toEqual([
			'agentRunsClosed',
			'alreadyReclaimed',
			'containersRemoved',
			'containersUnfinished',
			'durationMs',
			'errors',
			'networksRemoved',
			'timedOut',
		]);
		expect(calls).toEqual(['runs']);
		expect(ownership.ownedContainerCount()).toBe(0);
		expect(await invokeShutdown()).toMatchObject({
			ok: true,
			value: { alreadyReclaimed: true },
		});
	});
});
