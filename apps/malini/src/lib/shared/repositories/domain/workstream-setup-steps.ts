import type { CheckoutHealth } from '$contract/repositories';
import { CHECKOUT_FINDING_COPY } from './checkout-finding-copy';
import { workstreamBranch } from './project-identity';
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
	action: 'retry-setup' | 'repair' | 'retry-install' | null;
}>;

export type WorkstreamSetupInput = Readonly<{
	workstreamId: string;
	branch: string;
	provisioning: WorkstreamProvisioningRecord | null;
	install: WorkstreamInstallRecord | null;
	checkout: CheckoutHealth;
	checkoutIssue: string | null;
}>;

export function workstreamSetupSteps(input: WorkstreamSetupInput): readonly WorkstreamSetupStep[] {
	if (input.provisioning) return [copyStepInProgress(input.provisioning)];
	const checkout = checkoutStep(input.checkout, input.checkoutIssue);
	return [
		copyStep(input),
		...(checkout ? [checkout] : []),
		...(input.install ? [installStep(input.install)] : []),
	];
}

export function checkoutStep(
	health: CheckoutHealth,
	issue: string | null,
): WorkstreamSetupStep | null {
	const step = { key: 'checkout', action: null } as const;
	if (health.state === 'repairing')
		return { ...step, state: 'busy', label: 'Repairing the checkout', detail: null };
	if (health.state === 'broken') {
		const copy = CHECKOUT_FINDING_COPY[health.finding ?? 'unknown'];
		return {
			...step,
			state: 'failed',
			label: copy.headline,
			detail: health.repairable ? (copy.repair ?? copy.instruction) : copy.instruction,
			action: health.repairable ? 'repair' : null,
		};
	}
	return issue ? { ...step, state: 'failed', label: 'No usable checkout', detail: issue } : null;
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
