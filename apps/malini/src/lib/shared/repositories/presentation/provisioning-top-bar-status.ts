import type { WorkstreamProvisioningRecord } from '$shared/repositories/domain/provisioning';
import {
	provisioningFailureIsAuth,
	provisioningStepLabel,
} from '$shared/repositories/domain/provisioning';
import type { GlobalTopBarGithubStatus } from '$shared/shell/global-topbar-actions.svelte';

export type ProvisioningTopBarActions = Readonly<{
	onRetry(): void;
	onRemove(): void;
}>;

export function provisioningTopBarStatus(
	record: WorkstreamProvisioningRecord | null,
	retrying: boolean,
	actions: ProvisioningTopBarActions,
): GlobalTopBarGithubStatus | null {
	if (!record) return null;
	if (record.failure) return failedSetupStatus(record, record.failure, retrying, actions);
	return settingUpStatus(record);
}

function settingUpStatus(record: WorkstreamProvisioningRecord): GlobalTopBarGithubStatus {
	const step = provisioningStepLabel(record);
	return {
		reference: null,
		title: 'Setting up workstream',
		branch: record.plan.branch,
		checks: [],
		checksSummary: '',
		review: null,
		todos: null,
		action: {
			label:
				record.phase === 'cloning' && record.clonePercent !== null
					? `Cloning ${record.clonePercent}%`
					: 'Setting up…',
			ariaLabel: `Setting up this workstream: ${step}`,
			tooltip: `${step}. A prompt sent now runs once setup finishes`,
			tone: 'secondary',
			disabled: true,
			busy: true,
			onInvoke: () => undefined,
		},
	};
}

function failedSetupStatus(
	record: WorkstreamProvisioningRecord,
	failure: string,
	retrying: boolean,
	actions: ProvisioningTopBarActions,
): GlobalTopBarGithubStatus {
	const reconnect = provisioningFailureIsAuth(failure);
	return {
		reference: null,
		title: 'Workstream setup did not finish',
		branch: record.plan.branch,
		checks: [],
		checksSummary: '',
		review: null,
		todos: null,
		remoteFailure: failure,
		action: {
			label: 'Retry setup',
			ariaLabel: reconnect
				? 'Retry this workstream’s setup after signing in to GitHub'
				: 'Retry this workstream’s setup',
			tooltip: `${asSentence(failure)} ${failedSetupRemedy(failure, reconnect)}`,
			tone: 'primary',
			disabled: false,
			busy: retrying,
			onInvoke: actions.onRetry,
		},
		detailActions: [
			{
				id: 'discard',
				label: 'Remove workstream',
				onInvoke: actions.onRemove,
			},
			...(reconnect
				? [
						{
							id: 'retry-setup',
							label: 'Retry setup',
							disabled: retrying,
							onInvoke: actions.onRetry,
						},
					]
				: []),
		],
	};
}

function asSentence(text: string): string {
	return /[.!?]$/u.test(text) ? text : `${text}.`;
}

function failedSetupRemedy(failure: string, reconnect: boolean): string {
	if (!reconnect) return 'Continue this workstream’s setup from where it stopped';
	return failure.includes('gh auth login')
		? 'Then retry this workstream’s setup'
		: 'Sign in with `gh auth login` in a terminal, then retry';
}
