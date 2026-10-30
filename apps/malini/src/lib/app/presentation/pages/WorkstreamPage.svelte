<script lang="ts">
	import type { ExtensionWorkstream } from '@malini/extension-api';
	import { loadBrowserTabsCommand } from '$lib/browser/application/commands/load-browser-tabs.command';
	import { openBrowserTabCommand } from '$lib/browser/application/commands/open-browser-tab.command';
	import { browserTabsQuery } from '$lib/browser/application/queries/browser-tabs.query.svelte';
	import { browserTabPanels } from '$lib/browser/browser.api';
	import { activeSessionQuery } from '$lib/chat/application/queries/active-session.query.svelte';
	import { leadDecisionsQuery } from '$lib/chat/application/queries/lead-decisions.query.svelte';
	import { offeredVariantsQuery } from '$lib/chat/application/queries/offered-variants.query.svelte';
	import { LeadDecisionsList, WorkstreamChatBridge } from '$lib/chat/chat.api';
	import { announceWorkstreamLifecycleCommand } from '$lib/extensions/application/commands/announce-workstream-lifecycle.command';
	import { extensionActivationGenerationQuery } from '$lib/extensions/application/queries/extension-activation-generation.query.svelte';
	import { extensionRuntimeReadyQuery } from '$lib/extensions/application/queries/extension-runtime-ready.query.svelte';
	import { extensionWorkstreamQuery } from '$lib/extensions/application/queries/extension-workstream.query.svelte';
	import { inspectorPanelsQuery } from '$lib/extensions/application/queries/inspector-panels.query.svelte';
	import { WorkstreamInspector } from '$lib/extensions/extensions.api';
	import { leadProgressQuery } from '$lib/app/application/queries/lead-progress.query.svelte';
	import { WorkstreamTopBarStatus } from '$lib/pull-requests/pull-requests.api';
	import {
		archiveWorkstreamCommand,
		changeTotalsQuery,
		consumeWorkstreamCreationCommand,
		loadWorkstreamGitStatusCommand,
		provisioningRecordQuery,
		provisioningRetryingQuery,
		provisioningTopBarStatus,
		refreshRepositoriesCommand,
		refreshWorkstreamsCommand,
		repositoryContextQuery,
		WorkstreamPathContextMenu,
		retryProvisioningCommand,
		supportsRemotePullRequests,
		workstreamByIdQuery,
		workstreamCreationContextQuery,
		workstreamCreationPendingQuery,
		workstreamProjectQuery,
		workstreamsLoadedQuery,
		worktreePendingQuery,
	} from '$shared/repositories/repositories.api';
	import { page } from '$shared/router/state';
	import LeadTopBarStatus from '../LeadTopBarStatus.svelte';
	import StartedWorkstreams from '../StartedWorkstreams.svelte';

	const workstreamId = $derived(page.params.workstreamId ?? '');
	const browserTabs = $derived(browserTabsQuery.data(workstreamId));
	const builtInPanels = $derived(browserTabPanels(workstreamId, browserTabs, offeredVariantsQuery));
	const panelActions = $derived([
		{
			id: 'new-browser-tab',
			label: 'New browser tab',
			icon: 'browser',
			run: () => openBrowserTabCommand(workstreamId),
		},
	]);

	$effect.pre(() => loadBrowserTabsCommand(workstreamId));
	const agentSessionId = $derived(page.url.searchParams.get('agent'));
	const repositoryScopeReady = $derived(workstreamsLoadedQuery.data);
	const workstream = $derived(workstreamByIdQuery.data(workstreamId));
	const startedWorkstreamIds = $derived(
		workstream?.scope ? leadProgressQuery.startedIds(workstreamId) : [],
	);
	const leadSessionId = $derived(workstream?.scope ? activeSessionQuery.data : null);
	const leadDecisionCount = $derived(leadDecisionsQuery.data(leadSessionId).length);
	const project = $derived(workstreamProjectQuery.data(workstreamId));
	const repositoryContext = $derived(repositoryContextQuery.data(workstreamId));
	const worktreePending = $derived(worktreePendingQuery.data(workstreamId));
	const changeTotals = $derived(changeTotalsQuery.data[workstreamId] ?? null);
	const provisioning = $derived(provisioningRecordQuery.data(workstreamId));
	const provisioningRetrying = $derived(provisioningRetryingQuery.data(workstreamId));
	const creationPending = $derived(workstreamCreationPendingQuery.data);
	const creationContext = $derived(workstreamCreationContextQuery.data);
	const extensionWorkstream = $derived(extensionWorkstreamQuery.data);
	const extensionGeneration = $derived(extensionActivationGenerationQuery.data);
	const extensionReady = $derived(extensionRuntimeReadyQuery.data(workstreamId));
	const repositoryExtensionRegistered = $derived(
		inspectorPanelsQuery.data.some(({ id }) => id === 'malini.repository.files-panel'),
	);
	const remotePullRequestsSupported = $derived(
		repositoryContext !== null && supportsRemotePullRequests(repositoryContext.repo),
	);
	const provisioningStatus = $derived(
		provisioningTopBarStatus(provisioning, provisioningRetrying, () =>
			retryProvisioningCommand(workstreamId),
		),
	);
	const inspectedWorkstream = $derived<ExtensionWorkstream | null>(
		workstream
			? {
					id: workstream.id,
					path: workstream.path,
					repositoryPath: workstream.path,
					...(project?.repoPath ? { repositoryRootPath: project.repoPath } : {}),
					...(repositoryContext?.repo.fullName
						? { repositoryFullName: repositoryContext.repo.fullName }
						: {}),
					branch: workstream.branch,
					baseBranch: workstream.baseBranch,
				}
			: null,
	);

	function archiveWorkstream(): void {
		if (workstream) archiveWorkstreamCommand(workstream, announceWorkstreamLifecycleCommand);
	}

	function retryRepositoryScope(): void {
		refreshWorkstreamsCommand();
		refreshRepositoriesCommand();
	}
</script>

{#if workstream?.scope}
	<LeadTopBarStatus leadId={workstreamId} />
{:else}
	<WorkstreamChatBridge {workstreamId}>
		{#snippet children(chat)}
			<WorkstreamTopBarStatus
				{workstreamId}
				{agentSessionId}
				{extensionWorkstream}
				{extensionGeneration}
				{extensionReady}
				{repositoryScopeReady}
				{remotePullRequestsSupported}
				{repositoryExtensionRegistered}
				agentWork={chat.agentWork}
				overrideStatus={provisioningStatus}
				ongitstatusstale={() => loadWorkstreamGitStatusCommand(workstreamId)}
				onarchive={archiveWorkstream}
			/>
		{/snippet}
	</WorkstreamChatBridge>
{/if}

<WorkstreamInspector
	{workstreamId}
	workstream={inspectedWorkstream}
	activationReady={repositoryScopeReady && !worktreePending}
	workstreamName={workstream?.name ?? null}
	repositoryLabel={repositoryContext?.repo.fullName ?? project?.name ?? null}
	{changeTotals}
	creationContext={(id) => (creationPending(id) ? (creationContext(id) ?? {}) : null)}
	oncreationannounced={consumeWorkstreamCreationCommand}
	onruntimeretry={retryRepositoryScope}
	browserOnly={Boolean(workstream?.scope)}
	dock={startedWorkstreamIds.length > 0 || leadDecisionCount > 0
		? startedWorkstreamsDock
		: undefined}
	{builtInPanels}
	{panelActions}
/>

{#snippet startedWorkstreamsDock()}
	<StartedWorkstreams workstreamIds={startedWorkstreamIds} framed={false} />
	{#if leadSessionId && leadDecisionCount > 0}
		{#if startedWorkstreamIds.length > 0}
			<div class="bg-surface-150 mx-2 my-1.5 h-px" aria-hidden="true"></div>
		{/if}
		<LeadDecisionsList sessionId={leadSessionId} />
	{/if}
{/snippet}

<WorkstreamPathContextMenu {workstreamId} />
