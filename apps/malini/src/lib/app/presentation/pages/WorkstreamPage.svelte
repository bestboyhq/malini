<script lang="ts">
	import type { ExtensionWorkstream } from '@malini/extension-api';
	import { worktreePageUrl } from '$contract/browser';
	import { loadBrowserTabsCommand } from '$lib/browser/application/commands/load-browser-tabs.command';
	import { openBrowserTabCommand } from '$lib/browser/application/commands/open-browser-tab.command';
	import { openBrowserUrlCommand } from '$lib/browser/application/commands/open-browser-url.command';
	import { browserTabsQuery } from '$lib/browser/application/queries/browser-tabs.query.svelte';
	import { browserTabPanels } from '$lib/browser/browser.api';
	import { offeredVariantsQuery } from '$lib/chat/application/queries/offered-variants.query.svelte';
	import { keepContextMediaFreshHook } from '$lib/chat/application/hooks/keep-context-media-fresh.hook';
	import { contextMediaCountQuery } from '$lib/chat/application/queries/context-media-count.query.svelte';
	import { MediaGallery, WorkstreamChatBridge } from '$lib/chat/chat.api';
	import { announceWorkstreamLifecycleCommand } from '$lib/extensions/application/commands/announce-workstream-lifecycle.command';
	import { extensionActivationGenerationQuery } from '$lib/extensions/application/queries/extension-activation-generation.query.svelte';
	import { extensionRuntimeReadyQuery } from '$lib/extensions/application/queries/extension-runtime-ready.query.svelte';
	import { extensionWorkstreamQuery } from '$lib/extensions/application/queries/extension-workstream.query.svelte';
	import { inspectorPanelsQuery } from '$lib/extensions/application/queries/inspector-panels.query.svelte';
	import { WorkstreamInspector } from '$lib/extensions/extensions.api';
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

	const workstreamId = $derived(page.params.workstreamId ?? '');
	const browserTabs = $derived(browserTabsQuery.data(workstreamId));
	const builtInPanels = $derived(browserTabPanels(workstreamId, browserTabs, offeredVariantsQuery));
	let mediaOpen = $state(false);
	const panelActions = $derived([
		{
			id: 'media',
			label: 'Media',
			icon: 'media',
			count: contextMediaCountQuery.data(workstreamId),
			run: (): void => {
				mediaOpen = true;
			},
		},
		{
			id: 'new-browser-tab',
			label: 'Browser',
			icon: 'browser',
			run: (): void => openBrowserTabCommand(workstreamId),
		},
	]);

	$effect.pre(() => loadBrowserTabsCommand(workstreamId));
	const agentSessionId = $derived(page.url.searchParams.get('agent'));
	const repositoryScopeReady = $derived(workstreamsLoadedQuery.data);
	const workstream = $derived(workstreamByIdQuery.data(workstreamId));
	const project = $derived(workstreamProjectQuery.data(workstreamId));
	const repositoryContext = $derived(repositoryContextQuery.data(workstreamId));
	const worktreePending = $derived(worktreePendingQuery.data(workstreamId));
	const checkoutReady = $derived(repositoryScopeReady && !worktreePending);
	const mediaReady = $derived(checkoutReady && workstream !== null);
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

	$effect(() => (mediaReady ? keepContextMediaFreshHook(workstreamId) : undefined));

	function archiveWorkstream(): void {
		if (workstream) archiveWorkstreamCommand(workstream, announceWorkstreamLifecycleCommand);
	}

	function retryRepositoryScope(): void {
		refreshWorkstreamsCommand();
		refreshRepositoriesCommand();
	}
</script>

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
			agentWorking={chat.agentWorking}
			overrideStatus={provisioningStatus}
			ongitstatusstale={() => loadWorkstreamGitStatusCommand(workstreamId)}
			onarchive={archiveWorkstream}
		/>
	{/snippet}
</WorkstreamChatBridge>

<WorkstreamInspector
	{workstreamId}
	workstream={inspectedWorkstream}
	activationReady={checkoutReady}
	{changeTotals}
	creationContext={(id) => (creationPending(id) ? (creationContext(id) ?? {}) : null)}
	oncreationannounced={consumeWorkstreamCreationCommand}
	onruntimeretry={retryRepositoryScope}
	{builtInPanels}
	{panelActions}
/>

<WorkstreamPathContextMenu {workstreamId} />

{#if mediaOpen}
	<MediaGallery
		{workstreamId}
		onclose={() => (mediaOpen = false)}
		onopendocument={(path) =>
			openBrowserUrlCommand(workstreamId, worktreePageUrl(workstreamId, path))}
	/>
{/if}
