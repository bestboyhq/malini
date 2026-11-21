import type { CheckoutHealth } from '$contract/repositories';
import {
	CLONING_FINDINGS,
	checkoutFindingCopy,
	checkoutRestoreCopy,
	type CheckoutAction,
	type CheckoutActionKind,
} from './checkout-finding-copy';
import { workstreamBranch } from './project-identity';
import type { Project } from './repository';
import { projectFullName } from './repository-context';
import {
	provisioningFailureSentence,
	provisioningSignInRemedy,
	type WorkstreamInstallRecord,
	type WorkstreamProvisioningRecord,
} from './provisioning';

export type WorkstreamSetupStep = Readonly<{
	key: 'copy' | 'checkout' | 'install';
	state: 'done' | 'busy' | 'failed' | 'skipped';
	label: string;
	detail: string | null;
	action: 'retry-setup' | 'retry-install' | CheckoutActionKind | null;
	actionLabel?: string;
	secondaryAction?: CheckoutAction;
	clonePercent?: number;
}>;

export type WorkstreamSetupInput = Readonly<{
	workstreamId: string;
	branch: string;
	provisioning: WorkstreamProvisioningRecord | null;
	install: WorkstreamInstallRecord | null;
	repository: string;
	checkout: CheckoutHealth;
	clonePercent: number | null;
	agentFixing: boolean;
}>;

export function workstreamSetupSteps(input: WorkstreamSetupInput): readonly WorkstreamSetupStep[] {
	if (input.provisioning) return [copyStepInProgress(input.provisioning)];
	const checkout = checkoutStep(input);
	return [
		copyStep(input),
		...(checkout ? [checkout] : []),
		...(input.install ? [installStep(input.install)] : []),
	];
}

export function setupRepositoryName(projectId: string, projects: readonly Project[]): string {
	const project = projects.find(({ id }) => id === projectId);
	return (project && projectFullName(project)) ?? 'the repository';
}

function checkoutStep({
	checkout,
	repository,
	clonePercent,
	agentFixing,
}: WorkstreamSetupInput): WorkstreamSetupStep | null {
	const step = { key: 'checkout', action: null } as const;
	if (checkout.state === 'healthy') {
		return checkout.restored
			? { ...step, state: 'done', ...checkoutRestoreCopy(checkout.restored, repository) }
			: null;
	}
	const finding = checkout.finding ?? 'unknown';
	const copy = checkoutFindingCopy(finding, repository);
	if (checkout.state === 'repairing' || agentFixing) {
		const percent = CLONING_FINDINGS.has(finding) ? clonePercent : null;
		if (percent === null) return { ...step, state: 'busy', ...copy.busy };
		const detail = `${copy.busy.detail}. ${percent}%`;
		return { ...step, state: 'busy', label: copy.busy.label, detail, clonePercent: percent };
	}
	return {
		...step,
		state: 'failed',
		label: copy.broken.label,
		detail: checkout.said ?? copy.broken.detail,
		action: copy.action.kind,
		actionLabel: copy.action.label,
		...(copy.secondaryAction ? { secondaryAction: copy.secondaryAction } : {}),
	};
}

function copyStepInProgress(record: WorkstreamProvisioningRecord): WorkstreamSetupStep {
	const step = { key: 'copy', label: 'Making a fresh copy', action: null } as const;
	if (record.failure)
		return {
			...step,
			state: 'failed',
			label: 'Copy failed',
			detail: failureWithRemedy(record.failure),
			action: 'retry-setup',
		};
	const percent =
		record.phase === 'cloning' && record.clonePercent !== null ? `${record.clonePercent}%` : null;
	return { ...step, state: 'busy', detail: percent };
}

function copyStep(input: WorkstreamSetupInput): WorkstreamSetupStep {
	const step = { key: 'copy', state: 'done', action: null } as const;
	return input.branch === workstreamBranch(input.workstreamId)
		? { ...step, label: 'Made a fresh copy', detail: 'Main won’t notice' }
		: { ...step, label: 'Picked up your branch', detail: null };
}

function installStep(install: WorkstreamInstallRecord): WorkstreamSetupStep {
	const step = { key: 'install', label: 'Checked dependencies', action: null } as const;
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
			return {
				...step,
				state: 'failed',
				label: 'Install failed',
				detail: install.detail,
				action: 'retry-install',
			};
	}
}

function failureWithRemedy(failure: string): string {
	const remedy = provisioningSignInRemedy(failure);
	return remedy ? `${provisioningFailureSentence(failure)} ${remedy}` : failure;
}
