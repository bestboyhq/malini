<script lang="ts">
	import ExtensionGutter from './ExtensionGutter.svelte';
	import { EXTENSION_GUTTER_WIDTH } from '$shared/extensions/inspector-gutter-row';
	import { inspectorDrawer } from '$shared/extensions/inspector-drawer.store.svelte';
	import { inspectorGutter } from '$shared/extensions/inspector-gutter.store.svelte';

	interface Props {
		workstreamId: string;
	}

	let { workstreamId }: Props = $props();

	const drawerOpen = $derived(inspectorDrawer.isOpen(workstreamId));
	const rows = $derived(inspectorGutter.rowsFor(workstreamId));
	const workstreamName = $derived(inspectorGutter.workstreamNameFor(workstreamId));
	const disabled = $derived(!inspectorGutter.isInteractive(workstreamId));
</script>

{#if !drawerOpen}
	<div
		class="absolute top-0 right-0 z-10"
		style={`width: var(--transcript-rail-inset, ${EXTENSION_GUTTER_WIDTH});`}
		data-testid="extension-inspector-rail"
	>
		<ExtensionGutter
			{workstreamId}
			{workstreamName}
			{rows}
			{disabled}
			onopen={(panelId) => inspectorGutter.openPanel(workstreamId, panelId)}
			onshow={() => inspectorDrawer.open(workstreamId)}
		/>
	</div>
{/if}
