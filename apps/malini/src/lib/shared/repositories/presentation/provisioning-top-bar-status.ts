import type { WorkstreamProvisioningRecord } from '$shared/repositories/domain/provisioning';
import type { WorkstreamSetupStep } from '$shared/repositories/domain/workstream-setup-steps';
import {
	provisioningFailureIsAuth,
	provisioningFailureSentence,
	provisioningSignInRemedy,
	provisioningStepLabel,
} from '$shared/repositories/domain/provisioning';
import type { GlobalTopBarGithubStatus } from '$shared/shell/global-topbar-actions.svelte';

export function provisioningTopBarStatus(
	record: WorkstreamProvisioningRecord | null,
	retrying: boolean,
	onRetry: () => void,
): GlobalTopBarGithubStatus | null {
	if (!record) return null;
	if (record.failure) return failedSetupStatus(record, record.failure, retrying, onRetry);
	return settingUpStatus(record);
}

function settingUpStatus(record: WorkstreamProvisioningRecord): GlobalTopBarGithubStatus {
	const step = provisioningStepLabel(record);
	return {
		...detailless(record),
		title: 'Setting up workstream',
		headline: {
			tone: 'idle',
			busy: true,
			label: 'Setting up',
			detail:
				record.phase === 'cloning' && record.clonePercent !== null
					? `Cloning ${record.clonePercent}%`
					: step,
			tooltip: null,
		},
		action: null,
	};
}

function failedSetupStatus(
	record: WorkstreamProvisioningRecord,
	failure: string,
	retrying: boolean,
	onRetry: () => void,
): GlobalTopBarGithubStatus {
	const reconnect = provisioningFailureIsAuth(failure);
	const explanation = `${provisioningFailureSentence(failure)} ${failedSetupRemedy(failure, reconnect)}`;
	return {
		...detailless(record),
		title: 'Workstream setup did not finish',
		remoteFailure: failure,
		headline: {
			tone: 'needs-you',
			busy: retrying,
			label: 'Needs you',
			detail: retrying ? 'Retrying setup' : 'Setup failed',
			tooltip: explanation,
		},
		action: {
			label: 'Retry',
			ariaLabel: reconnect
				? 'Retry this workstream’s setup after signing in to GitHub'
				: 'Retry this workstream’s setup',
			tone: 'primary',
			disabled: retrying,
			onInvoke: onRetry,
		},
	};
}

function detailless(record: WorkstreamProvisioningRecord) {
	return {
		reference: null,
		branch: record.plan.branch,
		checks: [],
		checksSummary: '',
		review: null,
		todos: null,
	} as const;
}

function failedSetupRemedy(failure: string, reconnect: boolean): string {
	if (!reconnect) return 'Continue this workstream’s setup from where it stopped';
	return provisioningSignInRemedy(failure) ?? 'Then retry this workstream’s setup';
}

export type SetupStepHandlers = Readonly<{
	onRepair: () => void;
	onRetryInstall: () => void;
	onDismissInstall: () => void;
}>;

export function setupStepTopBarStatus(
	steps: readonly WorkstreamSetupStep[],
	branch: string | null,
	handlers: SetupStepHandlers,
): GlobalTopBarGithubStatus | null {
	const step = steps.find(
		({ key, state }) => state === 'failed' || (key === 'checkout' && state === 'busy'),
	);
	if (!step) return null;
	const action = (label: string, ariaLabel: string, onInvoke: () => void) =>
		({ label, ariaLabel, tone: 'primary', disabled: false, onInvoke }) as const;
	return {
		reference: null,
		branch,
		checks: [],
		checksSummary: '',
		review: null,
		todos: null,
		title: step.label,
		headline: {
			tone: 'needs-you',
			busy: step.state === 'busy',
			label: 'Needs you',
			detail:
				step.action === 'retry-install' || step.state === 'busy' ? step.label : 'Checkout broken',
			tooltip: [step.label, step.detail].filter(Boolean).join('. '),
		},
		action:
			step.action === 'repair'
				? action('Repair', 'Repair this workstream’s checkout', handlers.onRepair)
				: step.action === 'retry-install'
					? action('Retry', 'Retry the dependency install', handlers.onRetryInstall)
					: null,
		...(step.action === 'retry-install'
			? {
					secondaryAction: {
						...action('Dismiss', 'Dismiss the failed install', handlers.onDismissInstall),
						tone: 'secondary',
					},
				}
			: {}),
	};
}
