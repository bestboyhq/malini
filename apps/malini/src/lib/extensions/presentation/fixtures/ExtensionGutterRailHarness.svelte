<script lang="ts">
	import type { ExtensionPanelContext, ExtensionPanelRegistration } from '@malini/extension-api';

	import ExtensionGutterRail from '../ExtensionGutterRail.svelte';
	import ExtensionInspectorShell from '../ExtensionInspectorShell.svelte';
	import type { GutterChangeTotals } from '$shared/extensions/inspector-gutter-row';
	import type { InspectorPanelRegistry } from '../../infrastructure/stores/inspector-panel-registry.store.svelte';
	import type { InspectorPreferenceStorage } from '$shared/extensions/inspector-preference-storage';

	interface Props {
		workstreamId: string;
		railWorkstreamId?: string | undefined;
		workstreamName?: string | null;
		panels?: readonly ExtensionPanelRegistration[];
		registry?: InspectorPanelRegistry | undefined;
		changeTotals?: GutterChangeTotals | null;
		storage?: InspectorPreferenceStorage | null | undefined;
	}

	let {
		workstreamId,
		railWorkstreamId,
		workstreamName = null,
		panels = [],
		registry,
		changeTotals = null,
		storage,
	}: Props = $props();

	const registeredPanels = $derived(registry ? registry.panels : panels);

	const context: ExtensionPanelContext = {
		workstream: null,
		settings: {},
		executeCommand: () => Promise.reject(new Error('No extension host in this harness')),
	};
</script>

<ExtensionGutterRail workstreamId={railWorkstreamId ?? workstreamId} />
<ExtensionInspectorShell
	{workstreamId}
	{workstreamName}
	panels={registeredPanels}
	{changeTotals}
	{storage}
	{context}
/>
