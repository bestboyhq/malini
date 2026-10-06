import { describe, expect, it } from 'vitest';
import {
	QUIET_INSTALL_START_MS,
	WORKSTREAM_PROVISIONING_PHASES,
	installNoticeAt,
	planWorkstreamProvisioning,
	provisioningFailureIsAuth,
	provisioningFailureMessage,
	provisioningStepLabel,
	visibleInstallStatus,
	workstreamNativeExistence,
	type WorkstreamInstallRecord,
	type WorkstreamProvisioningRecord,
} from './provisioning';

function record(failure: string | null): WorkstreamProvisioningRecord {
	return {
		plan: planWorkstreamProvisioning({
			repo: {
				fullName: 'rabbits/hutch',
				defaultBranch: 'main',
				remoteUrl: 'https://github.com/rabbits/hutch.git',
				localPath: null,
			},
			projects: [],
			workstreamId: '01JDOMAINTESTAAAA',
		}),
		phase: 'worktree',
		clonePercent: null,
		failure,
		startedAt: 0,
	};
}

describe('workstream provisioning rules', () => {
	it('keeps the install out of the setup phases', () => {
		expect(WORKSTREAM_PROVISIONING_PHASES).toEqual(['preparing', 'cloning', 'worktree', 'syncing']);
	});

	it('reduces every native install transition to a state worth a pixel, or to none', () => {
		expect(visibleInstallStatus({ status: 'running' })).toBe('running');
		expect(visibleInstallStatus({ status: 'failed' })).toBe('failed');
		expect(visibleInstallStatus({ status: 'skipped', reason: 'unrecognized-project' })).toBe(
			'unavailable',
		);
		expect(visibleInstallStatus({ status: 'skipped', reason: 'already-installed' })).toBeNull();
		expect(visibleInstallStatus({ status: 'skipped', reason: 'no-manifest' })).toBeNull();
		expect(visibleInstallStatus({ status: 'succeeded' })).toBeNull();
	});

	it('classifies a workstream by whether the control plane already owns it', () => {
		expect(workstreamNativeExistence(null)).toBe('platform');
		expect(workstreamNativeExistence(record(null))).toBe('in-flight');
		expect(workstreamNativeExistence(record('fatal: could not add worktree'))).toBe('absent');
		expect(workstreamNativeExistence({ ...record(null), phase: 'syncing' })).toBe('platform');
	});

	it('names the step setup is on', () => {
		expect(provisioningStepLabel({ ...record(null), phase: 'preparing' })).toBe(
			'Preparing workstream',
		);
		expect(provisioningStepLabel({ ...record(null), phase: 'cloning' })).toBe(
			'Cloning rabbits/hutch',
		);
		expect(provisioningStepLabel(record(null))).toBe('Creating worktree');
		expect(provisioningStepLabel({ ...record(null), phase: 'syncing' })).toBe(
			'Updating main from origin',
		);
	});

	it('announces a fresh install only once it has run for a while, and a retried one at once', () => {
		const running: WorkstreamInstallRecord = {
			workstreamId: 'ws-a',
			status: 'running',
			command: null,
			detail: null,
			noticeAt: 4_000,
		};
		expect(installNoticeAt(null, 'running', 1_000)).toBe(1_000 + QUIET_INSTALL_START_MS);
		expect(installNoticeAt(running, 'running', 2_000)).toBe(4_000);
		expect(installNoticeAt({ ...running, status: 'failed' }, 'running', 2_000)).toBe(2_000);
		expect(installNoticeAt(running, 'failed', 2_000)).toBe(2_000);
		expect(installNoticeAt(null, 'unavailable', 2_000)).toBe(2_000);
	});

	it('recognizes a failure that waits on a GitHub credential', () => {
		expect(provisioningFailureIsAuth('git auth failed for https://github.com/a/b')).toBe(true);
		expect(provisioningFailureIsAuth('Authentication failed for repo')).toBe(true);
		expect(provisioningFailureIsAuth('fatal: could not read Username for github')).toBe(true);
		expect(
			provisioningFailureIsAuth('GitHub needs you to sign in. Run `gh auth login` and try again.'),
		).toBe(true);
		expect(provisioningFailureIsAuth('base branch main is missing')).toBe(false);
	});

	it('states the real failure, falling back to a generic line', () => {
		expect(provisioningFailureMessage(new Error('fatal: could not add worktree'))).toBe(
			'fatal: could not add worktree',
		);
		expect(provisioningFailureMessage('clone interrupted')).toBe('clone interrupted');
		expect(provisioningFailureMessage(new Error('  '))).toBe('Workstream setup failed');
		expect(provisioningFailureMessage(undefined)).toBe('Workstream setup failed');
	});
});
