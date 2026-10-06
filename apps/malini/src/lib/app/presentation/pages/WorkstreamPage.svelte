<script lang="ts">
	import type { ExtensionWorkstream } from '@malini/extension-api';
	import { WorkstreamChatBridge } from '$lib/chat/chat.api';
	import { openInspectorPanelCommand } from '$lib/extensions/application/commands/open-inspector-panel.command';
	import { extensionActivationGenerationQuery } from '$lib/extensions/application/queries/extension-activation-generation.query.svelte';
	import { extensionRuntimeErrorQuery } from '$lib/extensions/application/queries/extension-runtime-error.query.svelte';
	import { extensionRuntimeReadyQuery } from '$lib/extensions/application/queries/extension-runtime-ready.query.svelte';
	import { extensionWorkstreamQuery } from '$lib/extensions/application/queries/extension-workstream.query.svelte';
	import { inspectorPanelsQuery } from '$lib/extensions/application/queries/inspector-panels.query.svelte';
	import { WorkstreamInspector } from '$lib/extensions/extensions.api';
	import { WorkstreamTopBarStatus } from '$lib/pull-requests/pull-requests.api';
	import {
		WorkstreamActionsMenu,
		changeTotalsQuery,
		consumeWorkstreamCreationCommand,
		loadWorkstreamGitStatusCommand,
		provisioningRecordQuery,
		provisioningRetryingQuery,
		provisioningTopBarStatus,
		refreshRepositoriesCommand,
		refreshWorkstreamsCommand,
		removeFailedWorkstreamCommand,
		repositoryContextQuery,
		retryProvisioningCommand,
		supportsRemotePullRequests,
		workstreamByIdQuery,
		workstreamCreationContextQuery,
		workstreamCreationPendingQuery,
		workstreamHasChangesQuery,
		workstreamProjectQuery,
		workstreamsLoadedQuery,
		worktreePendingQuery,
	} from '$shared/repositories/repositories.api';
	import { goto } from '$shared/router/navigation';
	import { REPOSITORIES_HREF } from '$shared/router/routes-hrefs';
	import { page } from '$shared/router/state';

	const workstreamId = $derived(page.params.workstreamId ?? '');
	const agentSessionId = $derived(page.url.searchParams.get('agent'));
	const repositoryScopeReady = $derived(workstreamsLoadedQuery.data);
	const workstream = $derived(workstreamByIdQuery.data(workstreamId));
	const project = $derived(workstreamProjectQuery.data(workstreamId));
	const repositoryContext = $derived(repositoryContextQuery.data(workstreamId));
	const worktreePending = $derived(worktreePendingQuery.data(workstreamId));
	const hasChanges = $derived(workstreamHasChangesQuery.data);
	const changeTotals = $derived(changeTotalsQuery.data[workstreamId] ?? null);
	const provisioning = $derived(provisioningRecordQuery.data(workstreamId));
	const provisioningRetrying = $derived(provisioningRetryingQuery.data(workstreamId));
	const creationPending = $derived(workstreamCreationPendingQuery.data);
	const creationContext = $derived(workstreamCreationContextQuery.data);
	const extensionWorkstream = $derived(extensionWorkstreamQuery.data);
	const extensionGeneration = $derived(extensionActivationGenerationQuery.data);
	const extensionReady = $derived(extensionRuntimeReadyQuery.data(workstreamId));
	const extensionError = $derived(extensionRuntimeErrorQuery.data);
	const repositoryExtensionRegistered = $derived(
		inspectorPanelsQuery.data.some(({ id }) => id === 'malini.repository.files-panel'),
	);
	const remotePullRequestsSupported = $derived(
		repositoryContext !== null && supportsRemotePullRequests(repositoryContext.repo),
	);
	const provisioningStatus = $derived(
		provisioningTopBarStatus(provisioning, provisioningRetrying, {
			onRetry: () => retryProvisioningCommand(workstreamId),
			onRemove: () => removeFailedWorkstreamCommand(workstreamId),
		}),
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
			{extensionError}
			{repositoryScopeReady}
			{remotePullRequestsSupported}
			{repositoryExtensionRegistered}
			agentRunning={chat.agentRunning}
			overrideStatus={provisioningStatus}
			submitPrompt={chat.submitAutomatedPrompt}
			chatEvidence={chat.chatEvidence}
			onpanelrequested={(panelId) => openInspectorPanelCommand(workstreamId, panelId)}
			ongitstatusstale={() => loadWorkstreamGitStatusCommand(workstreamId)}
		/>
	{/snippet}
</WorkstreamChatBridge>

{#snippet toolbarEnd()}
	{#if workstreamId}
		<WorkstreamActionsMenu
			{workstreamId}
			{hasChanges}
			removedNavigationTarget={REPOSITORIES_HREF}
			onRemoved={() => void goto(REPOSITORIES_HREF)}
		/>
	{/if}
{/snippet}

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
	{toolbarEnd}
/>
