<script lang="ts">
	import { onMount } from 'svelte';
	import { loadMarketplaceCommand } from '../application/commands/load-marketplace.command';
	import { followMarketplaceHook } from '../application/hooks/follow-marketplace.hook';
	import ExtensionDetail from './ExtensionDetail.svelte';
	import ExtensionsDiscover from './ExtensionsDiscover.svelte';
	import ExtensionsInstalled from './ExtensionsInstalled.svelte';
	import ExtensionsPublished from './ExtensionsPublished.svelte';
	import type { ExtensionsView } from './extensions-view';

	interface Props {
		view: ExtensionsView;
		publisher: string | null;
		name: string | null;
	}

	let { view, publisher, name }: Props = $props();

	onMount(() => {
		loadMarketplaceCommand();
		return followMarketplaceHook();
	});
</script>

{#if view === 'detail' && publisher && name}
	{#key `${publisher}/${name}`}
		<ExtensionDetail {publisher} {name} />
	{/key}
{:else if view === 'installed'}
	<ExtensionsInstalled />
{:else if view === 'published'}
	<ExtensionsPublished />
{:else}
	<ExtensionsDiscover />
{/if}
