<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { ExtensionWorkstream } from '@malini/extension-api';
	import type { PullRequestActionInput } from '@malini-extension/repository';
	import {
		globalTopBarGithubStatus,
		type GlobalTopBarGithubStatus,
	} from '$shared/shell/global-topbar-actions.svelte';
	import {
		mergeConfirmationDetail,
		mergeConfirmationKey,
	} from '$lib/pull-requests/domain/merge-confirmation';
	import { refreshRepositorySurfaceCommand } from '$lib/pull-requests/application/commands/refresh-repository-surface.command';
	import { runPullRequestAbortOperationCommand } from '$lib/pull-requests/application/commands/run-pull-request-abort-operation.command';
	import { runPullRequestUpdateBranchCommand } from '$lib/pull-requests/application/commands/run-pull-request-update-branch.command';
	import { runPullRequestActionCommand } from '$lib/pull-requests/application/commands/run-pull-request-action.command';
	import { runPullRequestContinueCommand } from '$lib/pull-requests/application/commands/run-pull-request-continue.command';
	import { followPullRequestScopeHook } from '$lib/pull-requests/application/hooks/follow-pull-request-scope.hook.svelte';
	import { mergeConfirmationQuery } from '$lib/pull-requests/application/queries/merge-confirmation.query.svelte';
	import { pullRequestGithubStatusQuery } from '$lib/pull-requests/application/queries/pull-request-github-status.query.svelte';
	import { pullRequestTopBarQuery } from '$lib/pull-requests/application/queries/pull-request-top-bar.query.svelte';
	import { pullRequestBusyQuery } from '$lib/pull-requests/application/queries/pull-request-busy.query.svelte';
	import { pullRequestStatesQuery } from '$lib/pull-requests/application/queries/pull-request-states.query.svelte';
	import { repositorySurfaceQuery } from '$lib/pull-requests/application/queries/repository-surface.query.svelte';
	import { repositorySurfaceReadStateQuery } from '$lib/pull-requests/application/queries/repository-surface-read-state.query.svelte';
	import { pullRequestHeadline } from '$lib/pull-requests/domain/pull-request-headline';
	import { pullRequestPlaceholderLabel } from '$lib/pull-requests/domain/pull-request-placeholder';
	import { changeTotalsQuery } from '$shared/repositories/repositories.api';

	interface Props {
		workstreamId: string;
		agentSessionId: string | null;
		extensionWorkstream: ExtensionWorkstream | null;
		extensionGeneration: number;
		extensionReady: boolean;
		extensionError: string | null;
		repositoryScopeReady: boolean;
		remotePullRequestsSupported: boolean;
		repositoryExtensionRegistered: boolean;
		agentRunning: boolean;
		overrideStatus: GlobalTopBarGithubStatus | null;
		submitPrompt: (prompt: string) => Promise<void>;
		chatEvidence: () => PullRequestActionInput;
		onpanelrequested: (panelId: string) => void;
		ongitstatusstale: () => void;
		onarchive: () => void;
	}

	let {
		workstreamId,
		agentSessionId,
		extensionWorkstream,
		extensionGeneration,
		extensionReady,
		extensionError,
		repositoryScopeReady,
		remotePullRequestsSupported,
		repositoryExtensionRegistered,
		agentRunning,
		overrideStatus,
		submitPrompt,
		chatEvidence,
		onpanelrequested,
		ongitstatusstale,
		onarchive,
	}: Props = $props();

	const surface = $derived(repositorySurfaceQuery.data);
	const githubStatus = $derived(pullRequestGithubStatusQuery.data);
	const presentation = $derived(pullRequestTopBarQuery.data);
	const confirmation = $derived(mergeConfirmationQuery.data);
	const busy = $derived(pullRequestBusyQuery.data);
	const claimedBusyLabel = $derived(pullRequestBusyQuery.label);
	const pullRequestStates = $derived(pullRequestStatesQuery.data);
	const changeTotals = $derived(changeTotalsQuery.data);
	const surfaceReadState = $derived(repositorySurfaceReadStateQuery.data);
	const headline = $derived(pullRequestHeadline(surface));
	const merged = $derived(presentation?.kind === 'merged');
	const headlineCarriesAction = $derived(
		(presentation?.kind === 'open' || presentation?.kind === 'checking') &&
			Boolean(githubStatus?.url) &&
			headline !== null,
	);
	const statusPending = $derived(
		extensionError === null &&
			surfaceReadState !== 'failed' &&
			!(repositoryScopeReady && !remotePullRequestsSupported) &&
			(!extensionReady || surfaceReadState === 'reading'),
	);

	const stopFollowingScope = followPullRequestScopeHook(() => ({
		workstreamId,
		agentSessionId,
		extensionWorkstream,
		extensionGeneration,
		extensionReady,
		extensionFailed: extensionError !== null,
		repositoryScopeReady,
		remotePullRequestsSupported,
		repositoryExtensionRegistered,
		agentRunning,
	}));

	function onAction(): void {
		runPullRequestActionCommand({
			submitPrompt,
			chatEvidence,
			onPanelRequested: onpanelrequested,
			onGitStatusStale: ongitstatusstale,
		});
	}

	function onArm(): void {
		if (confirmation) return;
		onAction();
	}

	function onContinue(): void {
		runPullRequestContinueCommand(ongitstatusstale);
	}

	function pullRequestStatus(): GlobalTopBarGithubStatus | null {
		if (!githubStatus) return null;
		const operation = surface?.operationInProgress ?? null;
		const busyLabel =
			claimedBusyLabel ??
			(confirmation ? presentation?.confirmBusyLabel : null) ??
			presentation?.busyLabel ??
			'';
		return {
			...githubStatus,
			headline: headline
				? {
						...headline,
						detail: headlineCarriesAction
							? (presentation?.tooltip ?? null)
							: githubStatus.checksSummary || null,
					}
				: null,
			secondaryAction: merged
				? {
						label: busy ? busyLabel : 'Continue',
						ariaLabel: busy ? busyLabel : `Continue on the latest ${surface?.baseBranch ?? 'base'}`,
						tooltip: `Move this workstream onto the latest ${surface?.baseBranch ?? 'base'}, keeping the edits made since the merge, so the next push opens a new pull request`,
						tone: 'secondary',
						disabled: busy || agentRunning,
						busy,
						onInvoke: onContinue,
					}
				: null,
			remoteFailure: presentation?.remoteFailure ?? null,
			mergeConfirmation: confirmation
				? {
						pullRequestNumber: confirmation.pullRequestNumber,
						headSha: confirmation.headSha,
						detail: mergeConfirmationDetail(confirmation),
					}
				: null,
			detailActions: [
				...(presentation?.kind !== 'update' &&
				!surface?.mergeInProgress &&
				surface?.pullRequest?.mergeable !== false &&
				(surface?.pullRequest?.behindBase ?? 0) > 0
					? [
							{
								id: 'update-branch',
								label: 'Update branch',
								disabled: busy,
								onInvoke: () => runPullRequestUpdateBranchCommand(ongitstatusstale),
							},
						]
					: []),
				...(operation
					? [
							{
								id: 'abort-operation',
								label: `Abort ${operation}`,
								confirmLabel: 'Confirm abort',
								disabled: busy || agentRunning,
								onInvoke: () => runPullRequestAbortOperationCommand(operation, ongitstatusstale),
							},
						]
					: []),
				{
					id: 'refresh',
					label: 'Refresh',
					disabled: busy,
					onInvoke: refreshRepositorySurfaceCommand,
				},
			],
			action: merged
				? {
						label: presentation?.label ?? 'Archive',
						ariaLabel: presentation?.ariaLabel ?? 'Archive this workstream',
						tooltip: presentation?.tooltip ?? '',
						tone: 'primary',
						disabled: busy,
						busy: false,
						onInvoke: onarchive,
					}
				: presentation && !headlineCarriesAction
					? {
							label: busy ? busyLabel : presentation.label,
							ariaLabel: busy ? busyLabel : presentation.ariaLabel,
							tooltip: confirmation
								? mergeConfirmationDetail(confirmation)
								: busy
									? 'Repository action in progress'
									: presentation.tooltip,
							tone: presentation.tone,
							disabled: presentation.disabled || busy,
							busy: busy || presentation.kind === 'agent-running',
							confirmLabel: presentation.confirmLabel,
							confirmKey:
								presentation.kind === 'merge' ? mergeConfirmationKey(surface?.pullRequest) : null,
							onArm,
							onInvoke: onAction,
						}
					: null,
		};
	}

	function publishedStatus(): GlobalTopBarGithubStatus | null {
		if (overrideStatus) return overrideStatus;
		if (presentation?.kind === 'no-changes') return null;
		if (presentation || !statusPending) return pullRequestStatus();
		return placeholderStatus();
	}

	function placeholderStatus(): GlobalTopBarGithubStatus | null {
		const totals = changeTotals[workstreamId];
		const hasBranchChanges = (totals?.additions ?? 0) + (totals?.deletions ?? 0) > 0;
		const placeholder = pullRequestPlaceholderLabel(
			pullRequestStates[workstreamId] ?? 'unknown',
			hasBranchChanges,
		);
		if (!placeholder) return null;
		return {
			reference: null,
			title: null,
			branch: null,
			checks: [],
			checksSummary: '',
			review: null,
			todos: null,
			action: null,
			placeholder,
		};
	}

	$effect(() => {
		if (!workstreamId) return;
		globalTopBarGithubStatus.publish(workstreamId, publishedStatus());
	});

	onDestroy(() => {
		globalTopBarGithubStatus.clear(workstreamId);
		stopFollowingScope();
	});
</script>
