import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
	ipcMain: { handle: vi.fn() },
	BrowserWindow: { getAllWindows: () => [] },
}));

import { REPOSITORIES_WORKSTREAM_INSTALL_STATUS_CHANNEL } from '$contract/events';
import type { InvokeResponse } from '$contract/ipc';
import { LABEL_APP } from '$main/docker/labels';
import type { DockerOwnershipHandshake, OwnedContainer } from '$main/docker/ownership';
import { removeAll } from '$main/fs/test-support';
import { workstreamPath } from '$main/git/paths';
import { ScriptedRunner, waitFor } from '$main/process/test-support';
import type { RepositoriesPlatform } from '../repositories.platform';
import { registerRepositories } from './register';
import { createTestContext, seedWorkstream, type TestContext } from './test-support';

const BUNDLE = 'app.malini.desktop.test';
const cleanups: Array<() => void | Promise<void>> = [];
const dirs: string[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	removeAll(dirs);
});

interface Booted {
	test: TestContext;
	platform: RepositoriesPlatform;
	runner: ScriptedRunner;
	checkout: string;
	invoke<T>(command: string, args?: unknown): Promise<T>;
	invokeRaw(command: string, args?: unknown): Promise<InvokeResponse>;
}

function boot(runner = new ScriptedRunner()): Booted {
	const test = createTestContext();
	cleanups.push(() => test.cleanup());
	const checkout = workstreamPath(test.appDataRoot, 'ws-1');
	mkdirSync(checkout, { recursive: true });
	seedWorkstream(test.context.db, 'ws-1', checkout);
	const platform = registerRepositories(test.context, {
		runner,
		bundleIdentifier: BUNDLE,
		startupReclaim: false,
	});
	cleanups.push(() => platform.watchers.dispose());
	const invokeRaw = (command: string, args: unknown = {}): Promise<InvokeResponse> =>
		test.context.commands.invoke({ command, args });
	async function invoke<T>(command: string, args?: unknown): Promise<T>;
	async function invoke(command: string, args: unknown = {}): Promise<unknown> {
		const response = await invokeRaw(command, args);
		if (!response.ok) throw new Error(response.error);
		return response.value;
	}
	return { test, platform, runner, checkout, invokeRaw, invoke };
}

describe('the docker identity', () => {
	it('derives the bundle identifier from the dev flag and picks a per-process instance id', () => {
		const test = createTestContext();
		cleanups.push(() => test.cleanup());
		const platform = registerRepositories(test.context, {
			runner: new ScriptedRunner(),
			startupReclaim: false,
		});
		cleanups.push(() => platform.watchers.dispose());
		expect(platform.bundleIdentifier).toBe('app.malini.desktop.dev');
		expect(platform.appInstanceId).toMatch(/^[0-9a-f]{24}$/);
	});

	it('reclaims abandoned containers in the background at boot and never fails boot', async () => {
		const test = createTestContext();
		cleanups.push(() => test.cleanup());
		const runner = new ScriptedRunner().onCommand('docker', ['ps'], {
			kind: 'spawn-failure',
			error: 'spawn docker ENOENT',
		});
		const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		cleanups.push(() => warnings.mockRestore());
		const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		cleanups.push(() => errors.mockRestore());
		const platform = registerRepositories(test.context, { runner, bundleIdentifier: BUNDLE });
		cleanups.push(() => platform.watchers.dispose());
		await waitFor(() => warnings.mock.calls.length === 1);
		expect(String(warnings.mock.calls[0]?.[0])).toContain('startup container reclaim skipped');
		expect(errors).not.toHaveBeenCalled();
	});
});

describe('docker ownership commands', () => {
	it('round-trips claim, record, list, and release', async () => {
		const runner = new ScriptedRunner();
		const { invoke, test, checkout } = boot(runner);
		writeFileSync(join(checkout, 'docker-compose.yml'), 'services: {}\n');
		const handshake = await invoke<DockerOwnershipHandshake>('repositories.claim-docker-service', {
			repository: checkout,
			scope: 'ws-1',
			workstreamId: 'ws-1',
			service: 'db',
			owner: 'workstream',
			composeProject: 'ws-1-db',
		});
		expect(handshake).toMatchObject({
			bundleIdentifier: BUNDLE,
			composeProject: 'ws-1-db',
			composeFiles: [join(checkout, 'docker-compose.yml')],
		});
		expect(handshake.overlay.labels[LABEL_APP]).toBe(BUNDLE);
		expect(handshake.overlay.path.startsWith(test.appDataRoot)).toBe(true);

		await invoke('repositories.record-owned-docker-containers', {
			containers: [
				{
					containerId: 'abc',
					containerName: 'ws-1-db-db-1',
					workstreamId: 'ws-1',
					composeProject: 'ws-1-db',
					service: 'db',
					owner: 'workstream',
					cwd: checkout,
				},
			],
		});
		runner.onCommand('docker', ['ps'], {
			kind: 'exit',
			code: 0,
			stdout: `abc\tws-1-db-db-1\trunning\t${LABEL_APP}=${BUNDLE},com.docker.compose.project=ws-1-db\n`,
		});
		const owned = await invoke<OwnedContainer[]>('repositories.list-owned-docker-containers');
		expect(owned).toHaveLength(1);
		expect(owned[0]).toMatchObject({
			containerId: 'abc',
			containerName: 'ws-1-db-db-1',
			state: 'running',
			bundleIdentifier: BUNDLE,
			workstreamId: 'ws-1',
			composeProject: 'ws-1-db',
			service: 'db',
			owner: 'workstream',
			cwd: checkout,
			appPid: process.pid,
			evidence: 'label-and-record',
			startedByThisInstance: true,
		});
		expect(runner.last('docker').args).toEqual([
			'ps',
			'--all',
			'--no-trunc',
			'--format',
			'{{.ID}}\t{{.Names}}\t{{.State}}\t{{.Labels}}',
		]);

		await invoke('repositories.release-owned-docker-container', { containerId: 'abc' });
		const after = await invoke<OwnedContainer[]>('repositories.list-owned-docker-containers');
		expect(after[0]?.evidence).toBe('label');
		expect(after[0]?.appInstanceId).toBeNull();
	});

	it('rejects with the renderer-facing error strings', async () => {
		const { invokeRaw, checkout } = boot();
		expect(await invokeRaw('repositories.claim-docker-service', { repository: checkout })).toEqual({
			ok: false,
			error: 'invalid args: `scope` must be a string',
		});
		const claim = await invokeRaw('repositories.claim-docker-service', {
			repository: checkout,
			scope: 'ws-1',
			workstreamId: 'ws-1',
			service: 'db',
			owner: 'nobody',
		});
		expect(claim).toEqual({
			ok: false,
			error: 'docker container owner must be workstream, shared, or extension, not `nobody`',
		});
		const record = await invokeRaw('repositories.record-owned-docker-containers', {
			containers: 'x',
		});
		expect(record).toEqual({ ok: false, error: 'invalid args: `containers` must be an array' });
		const list = await invokeRaw('repositories.list-owned-docker-containers');
		expect(list.ok).toBe(false);
		expect(String((list as { error: string }).error)).toContain('unscripted spawn');
	});
});

describe('provisioning command', () => {
	it('resolves the checkout, runs the install, and resolves with the terminal status', async () => {
		const runner = new ScriptedRunner().onCommand('npm', ['ci'], { kind: 'exit', code: 0 });
		const { invoke, test, checkout } = boot(runner);
		writeFileSync(join(checkout, 'package.json'), '{}');
		writeFileSync(join(checkout, 'package-lock.json'), '{}');
		const status = await invoke<string>('repositories.provision-dependencies', {
			workstreamId: 'ws-1',
		});
		expect(status).toBe('succeeded');
		expect(runner.last('npm').cwd).toBe(realpathSync(checkout));
		expect(runner.last('npm').env?.['PATH']).toBeTruthy();
		const frames = test.events.frames.filter(
			(frame) => frame.channel === REPOSITORIES_WORKSTREAM_INSTALL_STATUS_CHANNEL,
		);
		expect(frames.map((frame) => (frame.payload as { status: string }).status)).toEqual([
			'running',
			'succeeded',
		]);
		expect(frames[0]?.payload).toMatchObject({
			type: REPOSITORIES_WORKSTREAM_INSTALL_STATUS_CHANNEL,
			workstreamId: 'ws-1',
			command: 'npm ci --ignore-scripts',
		});
	});

	it('answers skipped for a checkout with no manifest and rejects an unknown workstream', async () => {
		const { invoke, invokeRaw } = boot();
		expect(await invoke('repositories.provision-dependencies', { workstreamId: 'ws-1' })).toBe(
			'skipped',
		);
		const unknown = await invokeRaw('repositories.provision-dependencies', {
			workstreamId: 'ws-nope',
		});
		expect(unknown.ok).toBe(false);
	});

	it('lets the caller abort a running install', async () => {
		const runner = new ScriptedRunner().onCommand('pnpm', ['install'], { kind: 'manual' });
		const { invoke, platform, checkout } = boot(runner);
		writeFileSync(join(checkout, 'package.json'), '{}');
		writeFileSync(join(checkout, 'pnpm-lock.yaml'), '');
		const installing = invoke<string>('repositories.provision-dependencies', {
			workstreamId: 'ws-1',
		});
		await waitFor(() => runner.spawns.length === 1);
		expect(platform.installs.has('ws-1')).toBe(true);
		await platform.abortInstall('ws-1');
		expect(await installing).toBe('aborted');
		expect(platform.installs.has('ws-1')).toBe(false);
	});
});
