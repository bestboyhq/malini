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
	it('makes a fresh copy while setup runs, with the clone percent, and says when it stopped', () => {
		expect(labels({ ...settled, provisioning: provisioning({}) })).toEqual([
			'busy | Making a fresh copy | 42%',
		]);
		expect(labels({ ...settled, provisioning: provisioning({ phase: 'syncing' }) })).toEqual([
			'busy | Making a fresh copy',
		]);
		expect(labels({ ...settled, provisioning: provisioning({ failure: 'clone died' }) })).toEqual([
			'failed | Making a fresh copy | Did not finish',
		]);
	});

	it('tells the copy, then what the dependency check found, never a branch or a command', () => {
		const install = {
			workstreamId: plan.workstreamId,
			command: 'npm ci',
			detail: null,
			noticeAt: 0,
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

	it('says a branch it did not make was picked up', () => {
		expect(labels({ ...settled, branch: 'fix/burrow' })).toEqual(['done | Picked up your branch']);
	});
});
