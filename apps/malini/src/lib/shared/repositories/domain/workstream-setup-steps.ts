import { workstreamBranch } from './project-identity';
import {
	provisioningStepLabel,
	type WorkstreamInstallRecord,
	type WorkstreamProvisioningRecord,
} from './provisioning';

export type WorkstreamSetupStep = Readonly<{
	key: 'checkout' | 'head' | 'install';
	state: 'done' | 'busy' | 'failed' | 'skipped';
	label: string;
	code: string | null;
	detail: string | null;
}>;

export type WorkstreamSetupInput = Readonly<{
	workstreamId: string;
	branch: string;
	baseBranch: string;
	provisioning: WorkstreamProvisioningRecord | null;
	head: Readonly<{ sha: string; subject: string | null }> | null;
	install: WorkstreamInstallRecord | null;
}>;

export function workstreamSetupSteps(input: WorkstreamSetupInput): readonly WorkstreamSetupStep[] {
	if (input.provisioning) return [provisioningStep(input.provisioning)];
	return [
		checkoutStep(input),
		...(input.head ? [headStep(input.head)] : []),
		...(input.install ? [installStep(input.install)] : []),
	];
}

function provisioningStep(record: WorkstreamProvisioningRecord): WorkstreamSetupStep {
	const label = provisioningStepLabel(record);
	if (record.failure) {
		return { key: 'checkout', state: 'failed', label, code: null, detail: 'Did not finish' };
	}
	const percent =
		record.phase === 'cloning' && record.clonePercent !== null ? `${record.clonePercent}%` : null;
	return { key: 'checkout', state: 'busy', label, code: null, detail: percent };
}

function checkoutStep(input: WorkstreamSetupInput): WorkstreamSetupStep {
	const made = input.branch === workstreamBranch(input.workstreamId);
	return {
		key: 'checkout',
		state: 'done',
		label: made ? `Branch made from ${input.baseBranch}` : 'Picked up your branch',
		code: input.branch,
		detail: null,
	};
}

function headStep(head: NonNullable<WorkstreamSetupInput['head']>): WorkstreamSetupStep {
	return {
		key: 'head',
		state: 'done',
		label: 'Starts at',
		code: head.sha.slice(0, 7),
		detail: head.subject,
	};
}

function installStep(install: WorkstreamInstallRecord): WorkstreamSetupStep {
	const step = { key: 'install', code: install.command, detail: null } as const;
	switch (install.status) {
		case 'running':
			return { ...step, state: 'busy', label: 'Installing dependencies' };
		case 'installed':
			return { ...step, state: 'done', label: 'Dependencies installed' };
		case 'failed':
			return { ...step, state: 'failed', label: 'Install failed', detail: install.detail };
		case 'unavailable':
			return {
				...step,
				state: 'skipped',
				label: 'Installed nothing',
				detail: 'No lockfile to go on',
			};
	}
}
