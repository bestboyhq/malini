import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InstallOutcomeStatus } from '$contract/system';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { gate } from '$shared/repositories/application/provisioning.testkit';
import { planWorkstreamProvisioning } from '$shared/repositories/domain/provisioning';
import type { Repository } from '$shared/repositories/domain/repository';
import {
	workstreamDependencyInstall,
	workstreamProvisioning,
} from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { provisionWorkstreamCommand } from './provision-workstream.command';
import { retryDependencyInstallCommand } from './retry-dependency-install.command';
import { seedWorkstreamDependenciesCommand } from './seed-workstream-dependencies.command';

const WORKSTREAM_ID = '01JSEEDTESTAAAAAA';
const INSTALL_STATUS = 'repositories:workstream-install-status';

const repo: Repository = {
	id: 'repo-1',
	fullName: 'rabbits/hutch',
	defaultBranch: 'main',
	localPath: null,
	remoteUrl: 'https://github.com/rabbits/hutch.git',
	createdAt: '2026-01-01T00:00:00.000Z',
};

function plan() {
	return planWorkstreamProvisioning({ repo, projects: [], workstreamId: WORKSTREAM_ID });
}

async function scope(checkout: Readonly<Record<string, string>>): Promise<FakePlatform> {
	const platform = createFakePlatform({
		projects: [],
		workstreams: [],
		createdWorkstreamFileContents: checkout,
	});
	setPlatformForTest(platform);
	await workstreamsAggregate.refresh();
	return platform;
}

function installCalls(platform: FakePlatform): number {
	return platform.calls.filter(({ command }) => command === 'repositories.provision-dependencies')
		.length;
}

function announce(platform: FakePlatform, payload: Record<string, unknown>): void {
	platform.emit(INSTALL_STATUS, { type: INSTALL_STATUS, workstreamId: WORKSTREAM_ID, ...payload });
}

afterEach(() => {
	setPlatformForTest(null);
	workstreamsAggregate.reset();
	workstreamProvisioning.reset();
	workstreamDependencyInstall.reset();
});

describe('seeding workstream dependencies', () => {
	it('seeds dependencies as part of creating a workstream', async () => {
		const platform = await scope({ 'package.json': '{}', 'pnpm-lock.yaml': '' });

		provisionWorkstreamCommand(plan());

		await vi.waitFor(() =>
			expect(platform.calls).toContainEqual({
				command: 'repositories.provision-dependencies',
				args: { workstreamId: WORKSTREAM_ID },
			}),
		);
	});

	it('never holds the worktree gate open for the install', async () => {
		const platform = await scope({ 'package.json': '{}', 'pnpm-lock.yaml': '' });
		const install = gate<InstallOutcomeStatus>();
		platform.define('repositories.provision-dependencies', () => {
			announce(platform, { status: 'running', command: 'pnpm install --frozen-lockfile' });
			return install.promise;
		});

		provisionWorkstreamCommand(plan());

		await vi.waitFor(() =>
			expect(workstreamDependencyInstall.get(WORKSTREAM_ID)?.status).toBe('running'),
		);
		expect(workstreamProvisioning.hasPendingWorktree(WORKSTREAM_ID)).toBe(false);
		expect(workstreamProvisioning.get(WORKSTREAM_ID)).toBeNull();
		install.resolve('succeeded');
		await vi.waitFor(() => expect(workstreamDependencyInstall.get(WORKSTREAM_ID)).toBeNull());
	});

	it('says so instead of guessing when nothing names an install command', async () => {
		await scope({ 'package.json': '{}' });

		provisionWorkstreamCommand(plan());

		await vi.waitFor(() =>
			expect(workstreamDependencyInstall.get(WORKSTREAM_ID)).toMatchObject({
				status: 'unavailable',
				command: null,
			}),
		);
	});

	it('stays silent about a checkout that had nothing to install', async () => {
		const platform = await scope({ 'Cargo.toml': '[package]' });

		provisionWorkstreamCommand(plan());

		await vi.waitFor(() => expect(installCalls(platform)).toBe(1));
		expect(workstreamDependencyInstall.get(WORKSTREAM_ID)).toBeNull();
	});

	it('listens only while its own install call is open', async () => {
		const platform = await scope({ 'package.json': '{}', 'pnpm-lock.yaml': '' });
		const install = gate<InstallOutcomeStatus>();
		platform.define('repositories.provision-dependencies', () => install.promise);

		seedWorkstreamDependenciesCommand(WORKSTREAM_ID);
		expect(platform.listenerCount(INSTALL_STATUS)).toBe(1);
		platform.emit(INSTALL_STATUS, {
			type: INSTALL_STATUS,
			workstreamId: 'someone-else',
			status: 'failed',
		});
		expect(workstreamDependencyInstall.get(WORKSTREAM_ID)).toBeNull();

		install.resolve('succeeded');
		await vi.waitFor(() => expect(platform.listenerCount(INSTALL_STATUS)).toBe(0));
	});

	it('settles from the call’s own answer when the terminal event arrives too late', async () => {
		const platform = await scope({ 'package.json': '{}', 'pnpm-lock.yaml': '' });
		platform.define('repositories.provision-dependencies', () => {
			announce(platform, { status: 'running', command: 'pnpm install --frozen-lockfile' });
			return 'succeeded';
		});

		seedWorkstreamDependenciesCommand(WORKSTREAM_ID);
		await vi.waitFor(() => expect(platform.listenerCount(INSTALL_STATUS)).toBe(0));

		expect(workstreamDependencyInstall.get(WORKSTREAM_ID)).toBeNull();
		announce(platform, { status: 'succeeded', command: 'pnpm install --frozen-lockfile' });
		expect(workstreamDependencyInstall.get(WORKSTREAM_ID)).toBeNull();
	});

	it('reports a failure whose event arrived too late as the failure it was', async () => {
		const platform = await scope({ 'package.json': '{}', 'pnpm-lock.yaml': '' });
		platform.define('repositories.provision-dependencies', () => {
			announce(platform, { status: 'running', command: 'npm ci' });
			return 'failed';
		});

		seedWorkstreamDependenciesCommand(WORKSTREAM_ID);

		await vi.waitFor(() =>
			expect(workstreamDependencyInstall.get(WORKSTREAM_ID)).toMatchObject({
				status: 'failed',
				command: 'npm ci',
			}),
		);
	});

	it('keeps the detailed transition when the event did arrive in time', async () => {
		const platform = await scope({ 'package.json': '{}', 'pnpm-lock.yaml': '' });
		platform.define('repositories.provision-dependencies', () => {
			announce(platform, {
				status: 'failed',
				command: 'pnpm install --frozen-lockfile',
				detail: 'ERR_PNPM_NO_LOCKFILE',
			});
			return 'failed';
		});

		seedWorkstreamDependenciesCommand(WORKSTREAM_ID);

		await vi.waitFor(() =>
			expect(workstreamDependencyInstall.get(WORKSTREAM_ID)).toMatchObject({
				status: 'failed',
				detail: 'ERR_PNPM_NO_LOCKFILE',
			}),
		);
	});

	it('keeps a failed install a degraded workstream, never a failed creation', async () => {
		const platform = await scope({ 'package.json': '{}', 'pnpm-lock.yaml': '' });
		platform.define('repositories.provision-dependencies', () => {
			throw new Error('pnpm not found');
		});

		provisionWorkstreamCommand(plan());

		await vi.waitFor(() =>
			expect(workstreamDependencyInstall.get(WORKSTREAM_ID)).toMatchObject({
				status: 'failed',
				detail: 'pnpm not found',
			}),
		);
		expect(workstreamProvisioning.get(WORKSTREAM_ID)).toBeNull();
		expect(workstreamsAggregate.workstreams.map((entry) => entry.id)).toContain(WORKSTREAM_ID);
	});

	it('recovers a failed install by rerunning it, not by recreating the workstream', async () => {
		const platform = await scope({ 'package.json': '{}', 'pnpm-lock.yaml': '' });
		platform.define('repositories.provision-dependencies', () => {
			throw new Error('network is unreachable');
		});
		provisionWorkstreamCommand(plan());
		await vi.waitFor(() =>
			expect(workstreamDependencyInstall.get(WORKSTREAM_ID)?.status).toBe('failed'),
		);

		platform.define('repositories.provision-dependencies', () => {
			announce(platform, { status: 'succeeded', command: 'pnpm install --frozen-lockfile' });
			return 'succeeded';
		});
		retryDependencyInstallCommand(WORKSTREAM_ID);

		await vi.waitFor(() => expect(workstreamDependencyInstall.get(WORKSTREAM_ID)).toBeNull());
		expect(
			platform.calls.filter(({ command }) => command === 'repositories.create-workstream'),
		).toHaveLength(1);
	});

	it('runs one install per checkout, however many callers ask for one', async () => {
		const platform = await scope({ 'package.json': '{}', 'pnpm-lock.yaml': '' });
		let release = (): void => undefined;
		platform.define(
			'repositories.provision-dependencies',
			() =>
				new Promise<InstallOutcomeStatus>((resolve) => {
					release = () => resolve('succeeded');
				}),
		);

		seedWorkstreamDependenciesCommand(WORKSTREAM_ID);
		seedWorkstreamDependenciesCommand(WORKSTREAM_ID);
		seedWorkstreamDependenciesCommand(WORKSTREAM_ID);
		await vi.waitFor(() => expect(installCalls(platform)).toBe(1));

		release();
		await vi.waitFor(() => expect(platform.listenerCount(INSTALL_STATUS)).toBe(0));

		seedWorkstreamDependenciesCommand(WORKSTREAM_ID);
		await vi.waitFor(() => expect(installCalls(platform)).toBe(2));
		release();
	});
});
