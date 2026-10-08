<script lang="ts">
	import type { Snippet } from 'svelte';

	import { ResizableSplit } from '$hyper-ui/components/resizable-split';
	import { inspectorDrawer } from '$shared/extensions/inspector-drawer.store.svelte';
	import { inspectorGutter } from '$shared/extensions/inspector-gutter.store.svelte';
	import { WORKSTREAM_TRANSCRIPT_RATIO_KEY } from '$shared/storage/panel-storage-keys';

	interface Props {
		workstreamId: string;
		panelId?: string;
		storageKey?: string;
		defaultRatio?: number;
		minSize?: number;
		maxSize?: number;
		class?: string;
		primary: Snippet;
		secondary: Snippet;
	}

	let {
		workstreamId,
		panelId = 'workstream-transcript',
		storageKey = WORKSTREAM_TRANSCRIPT_RATIO_KEY,
		defaultRatio = 0.62,
		minSize = 480,
		maxSize = 1100,
		class: className = 'relative h-full min-h-0 w-full flex-1',
		primary,
		secondary,
	}: Props = $props();

	const secondaryMinSize = $derived(inspectorGutter.minWidthFor(workstreamId));
	const secondaryOpen = $derived(inspectorDrawer.isOpen(workstreamId) && !inspectorDrawer.overlay);
</script>

<ResizableSplit
	{panelId}
	{storageKey}
	{defaultRatio}
	{minSize}
	{maxSize}
	{secondaryMinSize}
	{secondaryOpen}
	class={className}
>
	{#snippet a()}
		{@render primary()}
	{/snippet}
	{#snippet b()}
		{@render secondary()}
	{/snippet}
</ResizableSplit>
