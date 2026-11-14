import { workstreamBranch } from './project-identity';
import type { WorkstreamInstallRecord, WorkstreamProvisioningRecord } from './provisioning';

export type WorkstreamSetupStep = Readonly<{
	key: 'copy' | 'install';
	state: 'done' | 'busy' | 'failed' | 'skipped';
	label: string;
	detail: string | null;
}>;

export type WorkstreamSetupInput = Readonly<{
	workstreamId: string;
	branch: string;
	provisioning: WorkstreamProvisioningRecord | null;
	install: WorkstreamInstallRecord | null;
}>;

export function workstreamSetupSteps(input: WorkstreamSetupInput): readonly WorkstreamSetupStep[] {
	if (input.provisioning) return [copyStepInProgress(input.provisioning)];
	return [copyStep(input), ...(input.install ? [installStep(input.install)] : [])];
}

function copyStepInProgress(record: WorkstreamProvisioningRecord): WorkstreamSetupStep {
	const step = { key: 'copy', label: 'Making a fresh copy' } as const;
	if (record.failure) return { ...step, state: 'failed', detail: 'Did not finish' };
	const percent =
		record.phase === 'cloning' && record.clonePercent !== null ? `${record.clonePercent}%` : null;
	return { ...step, state: 'busy', detail: percent };
}

function copyStep(input: WorkstreamSetupInput): WorkstreamSetupStep {
	return input.branch === workstreamBranch(input.workstreamId)
		? { key: 'copy', state: 'done', label: 'Made a fresh copy', detail: 'Main won’t notice' }
		: { key: 'copy', state: 'done', label: 'Picked up your branch', detail: null };
}

function installStep(install: WorkstreamInstallRecord): WorkstreamSetupStep {
	const step = { key: 'install', label: 'Checked dependencies' } as const;
	switch (install.status) {
		case 'running':
			return { ...step, state: 'busy', label: 'Checking dependencies', detail: null };
		case 'installed':
			return { ...step, state: 'done', detail: 'All in place' };
		case 'none':
			return { ...step, state: 'done', detail: 'Nothing to install' };
		case 'unavailable':
			return { ...step, state: 'skipped', detail: 'No lockfile. Installed nothing' };
		case 'failed':
			return { ...step, state: 'failed', label: 'Install failed', detail: install.detail };
	}
}
