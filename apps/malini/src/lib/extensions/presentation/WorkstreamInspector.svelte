<script lang="ts">
	import { untrack } from 'svelte';
	import type { ExtensionPanelRegistration, ExtensionWorkstream } from '@malini/extension-api';
	import type { WorkstreamChangeTotals } from '$shared/repositories/repositories.api';
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
	import ExtensionInspectorShell from './ExtensionInspectorShell.svelte';
	import type { InspectorPanelAction } from './inspector-panel-action';

	interface Props {
		workstreamId: string;
		workstream: ExtensionWorkstream | null;
		activationReady: boolean;
		workstreamName: string | null;
		changeTotals: WorkstreamChangeTotals | null;
		creationContext: (workstreamId: string) => WorkstreamCreatedAutomationContext | null;
		oncreationannounced: (workstreamId: string) => void;
		onruntimeretry: () => void;
		builtInPanels?: readonly ExtensionPanelRegistration[];
		panelActions?: readonly InspectorPanelAction[];
	}

	let {
		workstreamId,
		workstream,
		activationReady,
		workstreamName,
		changeTotals,
		creationContext,
		oncreationannounced,
		onruntimeretry,
		builtInPanels = [],
		panelActions = [],
	}: Props = $props();

	const agentSessionId = $derived(page.url.searchParams.get('agent'));
	const routePanelId = $derived(page.url.searchParams.get('inspector'));
	const extensionPanels = $derived(inspectorPanelsQuery.data);
	const ready = $derived(extensionRuntimeReadyQuery.data(workstreamId));
	const panels = $derived(
		extensionPanels.length > 0 || ready ? [...extensionPanels, ...builtInPanels] : extensionPanels,
	);
	const workstreamPanelIds = $derived(new Set(builtInPanels.map(({ id }) => id)));
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
</script>

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
	{panelActions}
	{workstreamPanelIds}
	requestedPanelId={routePanelId}
/>
