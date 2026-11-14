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
	baseBranch: 'main',
	provisioning: null,
	head: { sha: 'e2eacb3f00d', subject: 'feat: dig a second exit (#45)' },
	install: null,
};

function provisioning(
	overrides: Partial<WorkstreamProvisioningRecord>,
): WorkstreamProvisioningRecord {
	return { plan, phase: 'cloning', clonePercent: 42, failure: null, startedAt: 0, ...overrides };
}

function labels(input: WorkstreamSetupInput): string[] {
	return workstreamSetupSteps(input).map(({ state, label, code, detail }) =>
		[state, label, code, detail].filter(Boolean).join(' | '),
	);
}

describe('workstream setup steps', () => {
	it('shows the one step setup is on, with the clone percent, and where it stopped', () => {
		expect(labels({ ...settled, provisioning: provisioning({}) })).toEqual([
			'busy | Cloning rabbits/hutch | 42%',
		]);
		expect(labels({ ...settled, provisioning: provisioning({ phase: 'syncing' }) })).toEqual([
			'busy | Updating main from origin',
		]);
		expect(labels({ ...settled, provisioning: provisioning({ failure: 'clone died' }) })).toEqual([
			'failed | Cloning rabbits/hutch | Did not finish',
		]);
	});

	it('tells the branch, the commit it starts at, and the install once setup settles', () => {
		const install = { workstreamId: plan.workstreamId, detail: null, noticeAt: 0 };
		expect(labels(settled)).toEqual([
			`done | Branch made from main | ${plan.branch}`,
			'done | Starts at | e2eacb3 | feat: dig a second exit (#45)',
		]);
		expect(
			labels({ ...settled, install: { ...install, status: 'running', command: 'pnpm install' } }),
		).toContain('busy | Installing dependencies | pnpm install');
		expect(
			labels({ ...settled, install: { ...install, status: 'installed', command: 'pnpm install' } }),
		).toContain('done | Dependencies installed | pnpm install');
		expect(
			labels({
				...settled,
				install: { ...install, status: 'failed', command: 'npm ci', detail: 'ENOENT' },
			}),
		).toContain('failed | Install failed | npm ci | ENOENT');
		expect(
			labels({ ...settled, install: { ...install, status: 'unavailable', command: null } }),
		).toContain('skipped | Installed nothing | No lockfile to go on');
	});

	it('says a branch it did not make was picked up, and leaves out a head it has not read', () => {
		expect(labels({ ...settled, branch: 'fix/burrow', head: null })).toEqual([
			'done | Picked up your branch | fix/burrow',
		]);
	});
});
