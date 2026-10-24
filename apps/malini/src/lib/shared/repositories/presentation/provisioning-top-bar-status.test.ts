import { describe, expect, it, vi } from 'vitest';
import type { WorkstreamProvisioningRecord } from '$shared/repositories/domain/provisioning';
import { provisioningTopBarStatus } from './provisioning-top-bar-status';

function record(failure: string | null): WorkstreamProvisioningRecord {
	return {
		plan: {
			workstreamId: 'ws-a',
			projectId: 'local__rabbits__hutch',
			projectRepoPath: null,
			cloneProgressId: 'rabbits__hutch',
			repoUrl: 'https://github.com/rabbits/hutch.git',
			repositoryFullName: 'rabbits/hutch',
			name: 'Signal Arc',
			branch: 'malini/ws-a',
			baseBranch: 'main',
			scope: null,
		},
		phase: 'cloning',
		clonePercent: null,
		failure,
		startedAt: 0,
	};
}

const noRetry = (): void => undefined;

describe('the provisioning top bar status', () => {
	it('stays out of the top bar once setup is done', () => {
		expect(provisioningTopBarStatus(null, false, noRetry)).toBeNull();
	});

	it('shows setup in progress as a busy status with no button', () => {
		const status = provisioningTopBarStatus({ ...record(null), phase: 'syncing' }, false, noRetry);

		expect(status).toMatchObject({
			title: 'Setting up workstream',
			branch: 'malini/ws-a',
			headline: {
				tone: 'idle',
				busy: true,
				label: 'Setting up',
				detail: 'Updating main from origin',
				tooltip: null,
			},
			action: null,
		});
		expect(status?.remoteFailure ?? null).toBeNull();
	});

	it('counts the clone up while the repository is cloning', () => {
		expect(
			provisioningTopBarStatus({ ...record(null), clonePercent: 42 }, false, noRetry)?.headline
				?.detail,
		).toBe('Cloning 42%');
	});

	it('asks for a retry of a failed setup', () => {
		const onRetry = vi.fn();
		const status = provisioningTopBarStatus(record('disk full'), false, onRetry);

		expect(status).toMatchObject({
			title: 'Workstream setup did not finish',
			remoteFailure: 'disk full',
			headline: {
				tone: 'needs-you',
				busy: false,
				label: 'Needs you',
				detail: 'Setup failed',
				tooltip: 'disk full. Continue this workstream’s setup from where it stopped',
			},
			action: {
				label: 'Retry',
				ariaLabel: 'Retry this workstream’s setup',
				icon: 'refresh',
				disabled: false,
			},
		});

		void status?.action?.onInvoke();
		expect(onRetry).toHaveBeenCalledOnce();
	});

	it('holds the retry while it runs', () => {
		expect(provisioningTopBarStatus(record('disk full'), true, noRetry)).toMatchObject({
			headline: { busy: true, detail: 'Retrying setup' },
			action: { disabled: true },
		});
	});

	it('tells the user to sign in to GitHub when git could not authenticate', () => {
		const status = provisioningTopBarStatus(
			record('Authentication failed for repo'),
			false,
			noRetry,
		);

		expect(status?.action?.ariaLabel).toBe(
			'Retry this workstream’s setup after signing in to GitHub',
		);
		expect(status?.headline?.tooltip).toBe(
			'Authentication failed for repo. Sign in to GitHub in Settings, then retry',
		);
	});

	it('does not repeat a sign-in remedy the failure already names', () => {
		const failure =
			'GitHub rejected the sign-in. Sign in to GitHub again in Settings, then try again.';
		expect(provisioningTopBarStatus(record(failure), false, noRetry)?.headline?.tooltip).toBe(
			`${failure} Then retry this workstream’s setup`,
		);
	});
});
