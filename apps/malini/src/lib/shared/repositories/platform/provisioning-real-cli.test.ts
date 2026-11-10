import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canSandbox } from '@malini/agent-bridge/sandbox';
import { REPOSITORIES_WORKSTREAM_INSTALL_STATUS_CHANNEL } from '$contract/events';
import { openMigratedDatabase } from '$main/db/open';
import { resolveToolPath } from '$main/process/environment';
import { labeledContainerIds } from '$main/docker/cli';
import { composeProjectName, ownershipLabels } from '$main/docker/labels';
import { DockerOwnership, writeComposeLabelOverlay } from '$main/docker/ownership';
import { DockerCliReaper, reclaimContainers } from '$main/docker/reclaim';
import { InstallRegistry, installDependencies, installWithArgv } from './provisioning.service';
import { createNodeProcessRunner } from '$main/process/runner';
import { SHUTDOWN_BUDGET_MS } from '$lib/app/app.platform';
import { removeAll } from '$main/fs/test-support';
import { recordingEventBus } from './test-support';

const dirs: string[] = [];
const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	removeAll(dirs);
});

function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

function binary(name: string): string | null {
	return resolveToolPath(name);
}

describe.each(['pnpm', 'npm', 'yarn', 'bun'] as const)('real %s install', (manager) => {
	const lockfile = {
		pnpm: 'pnpm-lock.yaml',
		npm: 'package-lock.json',
		yarn: 'yarn.lock',
		bun: 'bun.lock',
	}[manager];

	it(`installs an empty manifest with --ignore-scripts, or skips without ${manager}`, async (context) => {
		if (!binary(manager)) {
			context.skip(`${manager} is not installed`);
			return;
		}
		const checkout = tempDir(`malini-real-${manager}-`);
		writeFileSync(
			join(checkout, 'package.json'),
			JSON.stringify({
				name: 'fixture',
				private: true,
				...(manager === 'bun' ? { packageManager: 'bun@1.0.0' } : {}),
			}),
		);
		if (manager === 'npm') {
			writeFileSync(
				join(checkout, lockfile),
				JSON.stringify({
					name: 'fixture',
					lockfileVersion: 3,
					packages: { '': { name: 'fixture' } },
				}),
			);
		} else if (manager === 'pnpm') {
			writeFileSync(
				join(checkout, lockfile),
				"lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n",
			);
		} else if (manager === 'yarn') {
			writeFileSync(join(checkout, lockfile), '');
		}
		const events = recordingEventBus();
		const runner = createNodeProcessRunner();
		const outcome = await installDependencies(
			{
				runner,
				events,
				registry: new InstallRegistry(runner),
				timeoutMs: 120_000,
				...(canSandbox() ? { sandbox: { hidden: [] } } : {}),
			},
			`ws-${manager}`,
			checkout,
		);
		const payloads = events.frames
			.filter((frame) => frame.channel === REPOSITORIES_WORKSTREAM_INSTALL_STATUS_CHANNEL)
			.map((frame) => frame.payload as { status: string; command?: string; detail?: string });
		expect(payloads[0]?.status).toBe('running');
		expect(payloads[0]?.command).toContain('--ignore-scripts');
		expect(outcome.status, JSON.stringify(payloads.at(-1))).toBe('succeeded');
	}, 180_000);
});

describe.runIf(canSandbox())('a sandboxed install', () => {
	it('writes the checkout and cannot read what Malini hides', async () => {
		const checkout = tempDir('malini-sandboxed-install-');
		const hidden = tempDir('malini-hidden-');
		writeFileSync(join(hidden, 'token'), 'hidden-token');
		const runner = createNodeProcessRunner();
		const deps = {
			runner,
			events: recordingEventBus(),
			registry: new InstallRegistry(runner),
			sandbox: { hidden: [hidden] },
		};
		const install = (workstreamId: string, script: string) => {
			const slot = deps.registry.claim(workstreamId);
			if (!slot) throw new Error(`${workstreamId} is already installing`);
			return installWithArgv(deps, slot, workstreamId, checkout, ['/bin/sh', '-c', script]);
		};

		expect(await install('ws-writes', 'touch installed')).toEqual({ status: 'succeeded' });
		expect(existsSync(join(checkout, 'installed'))).toBe(true);
		expect(await install('ws-reads', `cat ${join(hidden, 'token')}`)).toMatchObject({
			status: 'failed',
			detail: expect.stringContaining('Operation not permitted'),
		});
	});
});

describe('real docker', () => {
	const FIXTURE_IMAGE = 'alpine:3.20';
	const FIXTURE_COMPOSE = `services:\n  svc:\n    image: ${FIXTURE_IMAGE}\n    command: ['sleep', '600']\n`;

	function composeReady(): string | null {
		const docker = binary('docker');
		const ready =
			docker !== null &&
			[
				['version', '--format', '{{.Server.Version}}'],
				['compose', 'version'],
				['image', 'inspect', FIXTURE_IMAGE],
			].every((args) => spawnSync(docker, args).status === 0);
		return ready ? docker : null;
	}

	it('enumerates and reclaims exactly the containers this app started, or skips without a daemon', async (context) => {
		const docker = composeReady();
		if (!docker) {
			expect(
				process.env['MALINI_DOCKER_E2E'],
				`MALINI_DOCKER_E2E=1 but no Docker daemon with compose and ${FIXTURE_IMAGE}`,
			).not.toBe('1');
			context.skip(`no Docker daemon with compose and ${FIXTURE_IMAGE}`);
			return;
		}
		const runner = createNodeProcessRunner();
		const suffix = `${process.pid.toString(16)}${Date.now().toString(36)}`;
		const bundleIdentifier = `app.malini.desktop.e2e.${suffix}`;
		const appDataRoot = tempDir('malini-docker-e2e-data-');
		const checkouts = tempDir('malini-docker-e2e-checkouts-');
		const db = openMigratedDatabase(':memory:');
		cleanups.push(() => db.close());
		const projects: string[] = [];
		cleanups.push(() => {
			for (const project of projects) {
				const ids = spawnSync(docker, [
					'ps',
					'--all',
					'--quiet',
					'--filter',
					`label=com.docker.compose.project=${project}`,
				])
					.stdout.toString()
					.split('\n')
					.filter(Boolean);
				for (const id of ids) spawnSync(docker, ['rm', '--force', id]);
				spawnSync(docker, ['network', 'rm', `${project}_default`]);
			}
		});
		const composeUp = (cwd: string, project: string, overlay: string | null): void => {
			const args = [
				'compose',
				'--project-name',
				project,
				'--file',
				join(cwd, 'docker-compose.yml'),
			];
			if (overlay) args.push('--file', overlay);
			args.push('up', '--detach', 'svc');
			const result = spawnSync(docker, args, { cwd });
			expect(result.status, result.stderr.toString()).toBe(0);
		};
		const containerIds = (project: string): string[] =>
			spawnSync(docker, [
				'ps',
				'--all',
				'--no-trunc',
				'--quiet',
				'--filter',
				`label=com.docker.compose.project=${project}`,
			])
				.stdout.toString()
				.split('\n')
				.map((line) => line.trim())
				.filter(Boolean);

		const foreignProject = `maliniforeign-${suffix}`;
		projects.push(foreignProject);
		const foreignCwd = join(checkouts, 'foreign');
		spawnSync('mkdir', ['-p', foreignCwd]);
		writeFileSync(join(foreignCwd, 'docker-compose.yml'), FIXTURE_COMPOSE);
		composeUp(foreignCwd, foreignProject, null);
		const foreignId = containerIds(foreignProject)[0];
		expect(foreignId).toBeTruthy();

		const ownership = new DockerOwnership({ db, runner, appDataRoot, bundleIdentifier });
		const expected = new Set<string>();
		for (const workstreamId of [`ws-a-${suffix}`, `ws-b-${suffix}`]) {
			const project = composeProjectName(`malinifixture${suffix}`, workstreamId);
			projects.push(project);
			const overlay = writeComposeLabelOverlay(
				appDataRoot,
				ownershipLabels({
					bundleIdentifier,
					appInstanceId: ownership.appInstanceId,
					workstreamId,
					composeProject: project,
					service: 'svc',
					owner: 'workstream',
				}),
			);
			const cwd = join(checkouts, workstreamId);
			spawnSync('mkdir', ['-p', cwd]);
			writeFileSync(join(cwd, 'docker-compose.yml'), FIXTURE_COMPOSE);
			composeUp(cwd, project, overlay.path);
			const ids = containerIds(project);
			expect(ids).toHaveLength(1);
			ownership.recordContainers([
				{
					containerId: ids[0]!,
					containerName: `${project}-svc-1`,
					workstreamId,
					composeProject: project,
					service: 'svc',
					owner: 'workstream',
					cwd,
				},
			]);
			expected.add(ids[0]!);
		}

		const owned = await ownership.reconcile();
		expect(new Set(owned.map((container) => container.containerId))).toEqual(expected);
		for (const container of owned) {
			expect(container.evidence).toBe('label-and-record');
			expect(container.state).toBe('running');
			expect(container.startedByThisInstance).toBe(true);
		}
		expect(new Set(await labeledContainerIds(runner, bundleIdentifier))).toEqual(expected);

		const reclaim = await reclaimContainers(
			db,
			ownership,
			'started-by-this-run',
			new DockerCliReaper(runner),
			Date.now() + SHUTDOWN_BUDGET_MS,
			() => true,
		);
		expect(reclaim.unfinished).toEqual([]);
		expect(reclaim.timedOut).toBe(false);
		expect(new Set(reclaim.removed)).toEqual(expected);
		expect(reclaim.networksRemoved.length).toBeGreaterThanOrEqual(1);
		for (const id of expected) {
			expect(spawnSync(docker, ['inspect', '--format', '{{.Id}}', id]).status).not.toBe(0);
		}
		expect(spawnSync(docker, ['inspect', '--format', '{{.Id}}', foreignId!]).status).toBe(0);
		expect(await ownership.reconcile()).toEqual([]);
	}, 180_000);
});
