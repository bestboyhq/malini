<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { ExtensionWorkstream } from '@malini/extension-api';
	import {
		globalTopBarGithubStatus,
		type GlobalTopBarGithubStatus,
		type GlobalTopBarStatusAction,
		type GlobalTopBarStatusDetailAction,
		type GlobalTopBarStatusHeadline,
	} from '$shared/shell/global-topbar-actions.svelte';
	import { refreshRepositorySurfaceCommand } from '$lib/pull-requests/application/commands/refresh-repository-surface.command';
	import { runPullRequestAbortOperationCommand } from '$lib/pull-requests/application/commands/run-pull-request-abort-operation.command';
	import { runPullRequestActionCommand } from '$lib/pull-requests/application/commands/run-pull-request-action.command';
	import { sendShipIntentCommand } from '$lib/pull-requests/application/commands/send-ship-intent.command';
	import { followPullRequestScopeHook } from '$lib/pull-requests/application/hooks/follow-pull-request-scope.hook.svelte';
	import { pullRequestBusyQuery } from '$lib/pull-requests/application/queries/pull-request-busy.query.svelte';
	import { pullRequestGithubStatusQuery } from '$lib/pull-requests/application/queries/pull-request-github-status.query.svelte';
	import { pullRequestTopBarQuery } from '$lib/pull-requests/application/queries/pull-request-top-bar.query.svelte';
	import type { AgentWork } from '$lib/pull-requests/domain/pull-request-top-bar';
	import { repositorySurfaceQuery } from '$lib/pull-requests/application/queries/repository-surface.query.svelte';
	import type {
		PullRequestMenuItem,
		PullRequestMenuItemId,
		PullRequestTopBarAction,
	} from '$lib/pull-requests/domain/pull-request-action';
	import { pullRequestActionIcon } from './pull-request-action-icon';

	interface Props {
		workstreamId: string;
		agentSessionId: string | null;
		extensionWorkstream: ExtensionWorkstream | null;
		extensionGeneration: number;
		extensionReady: boolean;
		repositoryScopeReady: boolean;
		remotePullRequestsSupported: boolean;
		repositoryExtensionRegistered: boolean;
		agentWork: AgentWork | null;
		overrideStatus: GlobalTopBarGithubStatus | null;
		ongitstatusstale: () => void;
		onarchive: () => void;
	}

	let {
		workstreamId,
		agentSessionId,
		extensionWorkstream,
		extensionGeneration,
		extensionReady,
		repositoryScopeReady,
		remotePullRequestsSupported,
		repositoryExtensionRegistered,
		agentWork,
		overrideStatus,
		ongitstatusstale,
		onarchive,
	}: Props = $props();

	const surface = $derived(repositorySurfaceQuery.data);
	const githubStatus = $derived(pullRequestGithubStatusQuery.data);
	const topBar = $derived(pullRequestTopBarQuery.data(agentWork));
	const status = $derived(topBar.status);
	const busy = $derived(pullRequestBusyQuery.data);
	const claimedBusyLabel = $derived(pullRequestBusyQuery.label);
	const reference = $derived(
		githubStatus?.reference ?? (topBar.pullRequestNumber ? `#${topBar.pullRequestNumber}` : null),
	);

	const stopFollowingScope = followPullRequestScopeHook(() => ({
		workstreamId,
		agentSessionId,
		extensionWorkstream,
		extensionGeneration,
		extensionReady,
		repositoryScopeReady,
		remotePullRequestsSupported,
		repositoryExtensionRegistered,
	}));

	$effect(() => {
		if (!workstreamId) return;
		globalTopBarGithubStatus.publish(workstreamId, publishedStatus());
	});

	onDestroy(() => {
		globalTopBarGithubStatus.clear(workstreamId);
		stopFollowingScope();
	});

	function publishedStatus(): GlobalTopBarGithubStatus {
		if (overrideStatus) return overrideStatus;
		return {
			reference,
			title: githubStatus?.title ?? null,
			branch: githubStatus?.branch ?? null,
			url: topBar.url,
			checks: githubStatus?.checks ?? [],
			checksSummary: githubStatus?.checksSummary ?? '',
			review: githubStatus?.review ?? null,
			todos: githubStatus?.todos ?? null,
			changes: githubStatus?.changes ?? null,
			headline: statusHeadline(),
			remoteFailure: topBar.remoteFailure,
			detailActions: topBar.menu.map(detailAction),
			action: statusAction(status?.action ?? null),
			secondaryAction: statusAction(status?.secondaryAction ?? null),
		};
	}

	function statusHeadline(): GlobalTopBarStatusHeadline | null {
		if (!status) return null;
		const claimed = busy ? claimedBusyLabel : null;
		return {
			tone: status.tone,
			busy: busy || status.busy,
			label: claimed ?? status.label,
			detail: claimed ? null : status.detail,
			tooltip: claimed ? null : status.tooltip,
		};
	}

	function statusAction(action: PullRequestTopBarAction | null): GlobalTopBarStatusAction | null {
		if (!action || busy) return null;
		return {
			label: action.label,
			ariaLabel: action.ariaLabel,
			tone: action.tone,
			icon: pullRequestActionIcon(action.kind),
			confirmLabel: action.confirmLabel,
			disabled: false,
			onInvoke: () =>
				runPullRequestActionCommand(action.kind, {
					onGitStatusStale: ongitstatusstale,
					onArchive: onarchive,
				}),
		};
	}

	function detailAction(item: PullRequestMenuItem): GlobalTopBarStatusDetailAction {
		return {
			id: item.id,
			label: item.label,
			confirmLabel: item.confirmLabel,
			disabled: busy || (item.id === 'abort-operation' && agentWork !== null),
			onInvoke: () => onMenuItem(item.id),
		};
	}

	function onMenuItem(id: PullRequestMenuItemId): void {
		if (id === 'refresh') {
			refreshRepositorySurfaceCommand();
			return;
		}
		if (id === 'abort-operation') {
			const operation = surface?.operationInProgress;
			if (operation) runPullRequestAbortOperationCommand(operation, ongitstatusstale);
			return;
		}
		sendShipIntentCommand(id, workstreamId);
	}
</script>
