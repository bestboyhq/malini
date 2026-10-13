import type { WorkstreamProvisioningRecord } from '$shared/repositories/domain/provisioning';
import {
	provisioningFailureIsAuth,
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
			tooltip: `${step}. A prompt sent now runs once setup finishes`,
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
	const explanation = `${asSentence(failure)} ${failedSetupRemedy(failure, reconnect)}`;
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
			tooltip: explanation,
			tone: 'primary',
			icon: 'refresh',
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

function asSentence(text: string): string {
	return /[.!?]$/u.test(text) ? text : `${text}.`;
}

function failedSetupRemedy(failure: string, reconnect: boolean): string {
	if (!reconnect) return 'Continue this workstream’s setup from where it stopped';
	return failure.includes('gh auth login')
		? 'Then retry this workstream’s setup'
		: 'Sign in with `gh auth login` in a terminal, then retry';
}
