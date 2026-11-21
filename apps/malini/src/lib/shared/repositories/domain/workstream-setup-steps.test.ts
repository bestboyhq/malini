import { describe, expect, it } from 'vitest';
import { planWorkstreamProvisioning, type WorkstreamProvisioningRecord } from './provisioning';
import { workstreamSetupSteps, type WorkstreamSetupInput } from './workstream-setup-steps';

const plan = planWorkstreamProvisioning({
	repo: {
		fullName: 'rabbits/hutch',
		defaultBranch: 'main',
		remoteUrl: 'https://github.com/rabbits/hutch.git',
		localPath: null,
	},
	projects: [],
	workstreamId: '01JSETUPSTEPSAAAA',
});

const settled: WorkstreamSetupInput = {
	workstreamId: plan.workstreamId,
	branch: plan.branch,
	provisioning: null,
	install: null,
	repository: 'bestboyhq/platform',
	checkout: { state: 'healthy', finding: null, repairable: false, said: null, restored: null },
	clonePercent: null,
	agentFixing: false,
};

function provisioning(
	overrides: Partial<WorkstreamProvisioningRecord>,
): WorkstreamProvisioningRecord {
	return { plan, phase: 'cloning', clonePercent: 42, failure: null, startedAt: 0, ...overrides };
}

function labels(input: WorkstreamSetupInput): string[] {
	return workstreamSetupSteps(input).map(({ state, label, detail }) =>
		[state, label, detail].filter(Boolean).join(' | '),
	);
}

describe('workstream setup steps', () => {
	it('makes a fresh copy while setup runs, with the clone percent, and says why it failed', () => {
		expect(labels({ ...settled, provisioning: provisioning({}) })).toEqual([
			'busy | Making a fresh copy | 42%',
		]);
		expect(labels({ ...settled, provisioning: provisioning({ phase: 'syncing' }) })).toEqual([
			'busy | Making a fresh copy',
		]);
		expect(labels({ ...settled, provisioning: provisioning({ failure: 'clone died' }) })).toEqual([
			'failed | Copy failed | clone died',
		]);
		const unsigned = provisioning({ failure: 'Authentication failed for github.com' });
		expect(labels({ ...settled, provisioning: unsigned })).toEqual([
			'failed | Copy failed | Authentication failed for github.com. Sign in to GitHub in Settings, then retry',
		]);
	});

	it('tells the copy, then what the dependency check found, never a branch or a command', () => {
		const install = {
			workstreamId: plan.workstreamId,
			command: 'npm ci',
			detail: null,
		};
		expect(labels(settled)).toEqual(['done | Made a fresh copy | Main won’t notice']);
		expect(labels({ ...settled, install: { ...install, status: 'running' } })).toEqual([
			'done | Made a fresh copy | Main won’t notice',
			'busy | Checking dependencies',
		]);
		expect(labels({ ...settled, install: { ...install, status: 'installed' } })).toContain(
			'done | Checked dependencies | All in place',
		);
		expect(labels({ ...settled, install: { ...install, status: 'none' } })).toContain(
			'done | Checked dependencies | Nothing to install',
		);
		expect(labels({ ...settled, install: { ...install, status: 'unavailable' } })).toContain(
			'skipped | Checked dependencies | No lockfile. Installed nothing',
		);
		expect(
			labels({ ...settled, install: { ...install, status: 'failed', detail: 'ENOENT' } }),
		).toContain('failed | Install failed | ENOENT');
	});

	it('puts a broken checkout in the steps with the one action that fixes it', () => {
		const broken = {
			state: 'broken',
			finding: 'git-link-missing',
			repairable: true,
			said: null,
			restored: null,
		} as const;
		expect(workstreamSetupSteps({ ...settled, checkout: broken })[1]).toEqual({
			key: 'checkout',
			state: 'failed',
			label: 'The folder lost its git link',
			detail: 'Linking it again failed',
			action: 'repair',
			actionLabel: 'Try again',
		});
		expect(
			workstreamSetupSteps({
				...settled,
				checkout: { ...broken, finding: 'dubious-ownership', repairable: false },
			})[1],
		).toMatchObject({ label: 'Git does not trust this folder', actionLabel: 'Trust this folder' });
		expect(labels({ ...settled, checkout: { ...broken, state: 'repairing' } })).toContain(
			'busy | Linking the folder to git | Your files stay',
		);
		const cloning = { ...broken, state: 'repairing', finding: 'base-repository-missing' } as const;
		expect(labels({ ...settled, checkout: cloning })).toContain(
			'busy | Cloning bestboyhq/platform again | Its copy on this Mac is gone',
		);
		expect(workstreamSetupSteps({ ...settled, checkout: cloning, clonePercent: 38 })[1]).toEqual({
			key: 'checkout',
			state: 'busy',
			label: 'Cloning bestboyhq/platform again',
			detail: 'Its copy on this Mac is gone. 38%',
			action: null,
			clonePercent: 38,
		});
		expect(
			labels({ ...settled, checkout: { ...broken, state: 'repairing' }, clonePercent: 38 }),
		).toContain('busy | Linking the folder to git | Your files stay');
		expect(
			labels({
				...settled,
				checkout: { ...broken, state: 'healthy', finding: null, restored: 'commits-as-edits' },
			}),
		).toContain('done | Cloned bestboyhq/platform again | Your files stay. Commits are edits now');
	});

	it('offers the fix the user must run, with its second way out', () => {
		const broken = {
			state: 'broken',
			finding: 'remote-missing',
			repairable: false,
			said: null,
			restored: null,
		} as const;
		expect(workstreamSetupSteps({ ...settled, checkout: broken })[1]).toMatchObject({
			label: 'GitHub has no bestboyhq/platform',
			action: 'sign-in',
			actionLabel: 'Use another account',
			secondaryAction: { kind: 'reveal', label: 'Show in Finder' },
		});
		const unknown = { ...broken, finding: 'unknown', said: 'fatal: bad object HEAD' } as const;
		expect(workstreamSetupSteps({ ...settled, checkout: unknown })[1]).toMatchObject({
			state: 'failed',
			detail: 'fatal: bad object HEAD',
			action: 'ask-agent',
			secondaryAction: { kind: 'report', label: 'Report' },
		});
		expect(labels({ ...settled, checkout: unknown, agentFixing: true })).toContain(
			'busy | An agent is fixing the checkout | In this folder',
		);
	});

	it('says a branch it did not make was picked up', () => {
		expect(labels({ ...settled, branch: 'fix/burrow' })).toEqual(['done | Picked up your branch']);
	});
});
