<script lang="ts">
	import { openingWorkstreamId } from '$shared/router/navigation-target';
	import { followWorkstreamsRouteHook } from '$lib/app/application/hooks/follow-workstreams-route.hook.svelte';
	import { navigating, page } from '$shared/router/state';
	import { onDestroy, onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import {
		activeWorkstreamFreshnessPhaseQuery,
		activeWorkstreamsQuery,
		archiveWorkstreamCommand,
		bindExtensionNavigationHook,
		bindExtensionRepositoryHook,
		changeTotalsQuery,
		connectedRepositoriesQuery,
		createWorkstreamForRepositoryCommand,
		followActiveWorkstreamHook,
		followOwnPullRequestsHook,
		keepActiveWorkstreamFreshHook,
		refreshRepositoriesCommand,
		refreshWorkstreamAfterChangeCommand,
		refreshWorkstreamsCommand,
		removeRepositoryCommand,
		repositoriesScopeErrorQuery,
		repositoriesScopeLoadedQuery,
		resumeProvisioningOnGithubCredentialHook,
		retryRepositoriesScopeCommand,
		syncWorkstreamsHook,
		trackWorkstreamChangeTotalsHook,
		watchWorkstreamFilesChangedHook,
		workstreamCheckedOutQuery,
	} from '$shared/repositories/repositories.api';
	import { WorkstreamChatsPreloader } from '$lib/chat/chat.api';
	import { watchAgentChangeTriggersHook } from '$lib/chat/application/hooks/watch-agent-change-triggers.hook';
	import { syncChatNamesHook } from '$lib/chat/application/hooks/sync-chat-names.hook';
	import { pollPullRequestStatesHook } from '$lib/pull-requests/application/hooks/poll-pull-request-states.hook';
	import { pullRequestBadgesQuery } from '$lib/pull-requests/application/queries/pull-request-badges.query.svelte';
	import { pullRequestRefreshActivityQuery } from '$lib/pull-requests/application/queries/pull-request-refresh-activity.query.svelte';
	import { announceWorkstreamLifecycleCommand } from '$lib/extensions/application/commands/announce-workstream-lifecycle.command';
	import { loadProviderCapabilitiesCommand } from '$shared/providers/providers.api';
	import { onboardingQuery } from '$lib/app/application/queries/onboarding.query.svelte';
	import JobsSidebar from '../JobsSidebar.svelte';
	import Sidebar from '../Sidebar.svelte';
	import { JOBS_HREF, REPOSITORIES_HREF, workstreamHref } from '$shared/router/routes-hrefs';
	import { globalTopBarBandSlot } from '$shared/shell/global-topbar-actions.svelte';
	import { scheduleAfterSettledNavigationPaint } from '$shared/performance/navigation-paint-scheduler';
	import {
		PERFORMANCE_BUDGETS,
		runtimeDiagnostics,
	} from '$shared/performance/runtime-diagnostics.svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
	const releaseChangeTotals = trackWorkstreamChangeTotalsHook();
	bindExtensionRepositoryHook();
	bindExtensionNavigationHook();

	const activeWorkstreamId = $derived(page.params.workstreamId ?? '');
	const openingWorkstream = $derived(openingWorkstreamId(navigating.to, activeWorkstreamId));
	const workstreams = $derived(activeWorkstreamsQuery.data);
	const activeWorkstreamCheckedOut = $derived(workstreamCheckedOutQuery.data(activeWorkstreamId));
	const workstreamIds = $derived(workstreams.map((workstream) => workstream.id));
	const connectedRepositories = $derived(connectedRepositoriesQuery.data);
	const scopeLoading = $derived(!repositoriesScopeLoadedQuery.data);
	const scopeError = $derived(repositoriesScopeErrorQuery.data);
	const changeTotalsByWorkstream = $derived(changeTotalsQuery.data);
	const pullRequestBadge = pullRequestBadgesQuery.data;
	const pullRequestActivity = pullRequestRefreshActivityQuery.data;
	const activeWorkstreamFreshnessPhase = $derived(activeWorkstreamFreshnessPhaseQuery.data);
	const onboardingShown = $derived(onboardingQuery.data.shown);
	const inJobs = $derived(page.route.id?.startsWith(JOBS_HREF) ?? false);
	let lastWorkstreamId = $state<string | null>(null);
	const jobsBackHref = $derived(
		lastWorkstreamId ? workstreamHref(lastWorkstreamId) : REPOSITORIES_HREF,
	);
	const releases: (() => void)[] = [];

	onMount(() => {
		refreshWorkstreamsCommand();
		refreshRepositoriesCommand();
		releases.push(
			resumeProvisioningOnGithubCredentialHook(),
			followWorkstreamsRouteHook(),
			pollPullRequestStatesHook(),
			followOwnPullRequestsHook(),
			keepActiveWorkstreamFreshHook(pullRequestActivity),
			scheduleAfterSettledNavigationPaint(() => {
				void runtimeDiagnostics
					.measure(
						{
							category: 'runtime',
							label: 'Preparing agent runtime',
							budgetMs: PERFORMANCE_BUDGETS.agentSessionStartMs,
							target: activeWorkstreamId,
						},
						async () => loadProviderCapabilitiesCommand(),
					)
					.catch(() => {});
			}),
			syncWorkstreamsHook(),
			syncChatNamesHook(),
			watchAgentChangeTriggersHook(refreshWorkstreamAfterChangeCommand),
			watchWorkstreamFilesChangedHook(),
		);
	});

	$effect(() => followActiveWorkstreamHook(activeWorkstreamId, activeWorkstreamCheckedOut));

	$effect(() => {
		if (activeWorkstreamId) lastWorkstreamId = activeWorkstreamId;
	});

	onDestroy(() => {
		for (const release of releases.splice(0).reverse()) release();
		releaseChangeTotals();
	});
</script>

<WorkstreamChatsPreloader {workstreamIds} />

<div
	class="relative flex h-full min-h-0 w-full"
	data-testid="workstreams-layout"
	data-navigation-error={scopeError ? 'true' : undefined}
	data-navigation-error-message={scopeError ?? undefined}
	data-navigation-freshness-phase={activeWorkstreamFreshnessPhase}
>
	{#if !onboardingShown && inJobs}
		<JobsSidebar backHref={jobsBackHref} backLabel="Workstreams" />
	{:else if !onboardingShown}
		<Sidebar
			repositories={connectedRepositories}
			{workstreams}
			{activeWorkstreamId}
			{scopeLoading}
			{scopeError}
			onRetryScope={retryRepositoriesScopeCommand}
			{changeTotalsByWorkstream}
			{pullRequestBadge}
			onNewWorkstream={createWorkstreamForRepositoryCommand}
			onArchiveWorkstream={(workstream) =>
				archiveWorkstreamCommand(workstream, announceWorkstreamLifecycleCommand)}
			onSaveWorkstreamForLater={(workstream) =>
				archiveWorkstreamCommand(workstream, announceWorkstreamLifecycleCommand, 'saved-for-later')}
			onRemoveRepository={removeRepositoryCommand}
		/>
	{/if}

	<div
		class="relative flex h-full min-h-0 min-w-0 flex-1 flex-col"
		class:native-band-row-reserve={globalTopBarBandSlot.adopted}
		aria-busy={openingWorkstream !== null}
	>
		<div class="contents">
			{@render children()}
		</div>
	</div>
</div>
