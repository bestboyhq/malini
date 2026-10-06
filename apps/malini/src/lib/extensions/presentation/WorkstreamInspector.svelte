<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import type { ExtensionWorkstream } from '@malini/extension-api';
	import type { WorkstreamChangeTotals } from '$shared/repositories/repositories.api';
	import { goto } from '$shared/router/navigation';
	import { page } from '$shared/router/state';
	import { retryExtensionRuntimeCommand } from '../application/commands/retry-extension-runtime.command';
	import { activateExtensionsHook } from '../application/hooks/activate-extensions.hook';
	import { extensionActivationRetryQuery } from '../application/queries/extension-activation-retry.query.svelte';
	import { extensionPanelContextQuery } from '../application/queries/extension-panel-context.query.svelte';
	import { extensionRuntimeErrorQuery } from '../application/queries/extension-runtime-error.query.svelte';
	import { extensionRuntimeReadyQuery } from '../application/queries/extension-runtime-ready.query.svelte';
	import { inspectorPanelsQuery } from '../application/queries/inspector-panels.query.svelte';
	import { extensionWorkstreamFingerprint } from '../domain/extension-workstream-fingerprint';
	import type { WorkstreamCreatedAutomationContext } from '../domain/workstream-created-automation-context';
	import ExtensionDirectoryDetailPage from './ExtensionDirectoryDetailPage.svelte';
	import ExtensionDirectoryPage from './ExtensionDirectoryPage.svelte';
	import ExtensionInspectorShell from './ExtensionInspectorShell.svelte';
	import { extensionDirectoryHref, extensionInspectorHref } from './extension-directory-navigation';

	interface Props {
		workstreamId: string;
		workstream: ExtensionWorkstream | null;
		activationReady: boolean;
		workstreamName: string | null;
		repositoryLabel: string | null;
		changeTotals: WorkstreamChangeTotals | null;
		creationContext: (workstreamId: string) => WorkstreamCreatedAutomationContext | null;
		oncreationannounced: (workstreamId: string) => void;
		onruntimeretry: () => void;
		toolbarEnd: Snippet;
	}

	let {
		workstreamId,
		workstream,
		activationReady,
		workstreamName,
		repositoryLabel,
		changeTotals,
		creationContext,
		oncreationannounced,
		onruntimeretry,
		toolbarEnd,
	}: Props = $props();

	const agentSessionId = $derived(page.url.searchParams.get('agent'));
	const shallowExtensionDirectory = $derived.by(() => {
		const state = page.state.extensionDirectory;
		if (state?.workstreamId !== workstreamId || typeof globalThis.location === 'undefined') {
			return null;
		}
		const actual = new URL(globalThis.location.href);
		if (
			actual.pathname !== page.url.pathname ||
			actual.searchParams.get('inspector') !== 'extensions' ||
			actual.searchParams.get('extension') !== state.extensionId
		) {
			return null;
		}
		return state;
	});
	const directoryOpen = $derived(
		shallowExtensionDirectory !== null || page.url.searchParams.get('inspector') === 'extensions',
	);
	const routePanelId = $derived.by(() => {
		const panelId = page.url.searchParams.get('inspector');
		return panelId && panelId !== 'extensions' ? panelId : null;
	});
	const directoryExtensionId = $derived(
		shallowExtensionDirectory
			? shallowExtensionDirectory.extensionId
			: page.url.searchParams.get('extension'),
	);
	const panels = $derived(inspectorPanelsQuery.data);
	const ready = $derived(extensionRuntimeReadyQuery.data(workstreamId));
	const runtimeError = $derived(extensionRuntimeErrorQuery.data);
	const activationRetry = $derived(extensionActivationRetryQuery.data);
	const panelContext = $derived(extensionPanelContextQuery.data(workstream));
	const activationWorkstream = $derived(activationReady ? workstream : null);
	const activationKey = $derived(
		activationWorkstream ? extensionWorkstreamFingerprint(activationWorkstream) : null,
	);

	const activateExtensions = activateExtensionsHook();

	$effect(() => {
		void activationRetry;
		if (!activationKey) return;
		const nextWorkstream = untrack(() => activationWorkstream);
		if (!nextWorkstream) return;
		return activateExtensions({
			workstream: nextWorkstream,
			currentWorkstreamId: () => workstreamId,
			creationContext: untrack(() => creationContext(nextWorkstream.id)),
			onCreationAnnounced: oncreationannounced,
		});
	});

	function onRuntimeRetry(): void {
		retryExtensionRuntimeCommand(workstreamId);
		onruntimeretry();
	}

	function closeDirectory(): void {
		if (!directoryOpen) return;
		void goto(extensionInspectorHref({ workstreamId, agentSessionId }), {
			noScroll: true,
			keepFocus: true,
		});
	}
</script>

{#snippet directoryContent()}
	{#if directoryExtensionId}
		<ExtensionDirectoryDetailPage
			{workstreamId}
			extensionId={directoryExtensionId}
			{agentSessionId}
			extensionWorkstream={workstream}
			{repositoryLabel}
		/>
	{:else}
		<ExtensionDirectoryPage {workstreamId} {agentSessionId} />
	{/if}
{/snippet}

<ExtensionInspectorShell
	{workstreamId}
	{workstreamName}
	{changeTotals}
	{agentSessionId}
	{panels}
	context={panelContext}
	{ready}
	{runtimeError}
	onruntimeretry={onRuntimeRetry}
	addExtensionsHref={extensionDirectoryHref({ workstreamId, agentSessionId })}
	closeDirectoryNavigationTarget={extensionInspectorHref({ workstreamId, agentSessionId })}
	addExtensionsActive={directoryOpen}
	addExtensionsContent={directoryContent}
	{toolbarEnd}
	onpanelselect={closeDirectory}
	requestedPanelId={routePanelId}
/>
