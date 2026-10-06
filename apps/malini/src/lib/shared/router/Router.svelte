<script lang="ts">
	import RouteOutlet from './RouteOutlet.svelte';
	import { router } from './hash-router.svelte';

	const view = $derived(router.view);
</script>

{#if view}
	<RouteOutlet components={view.components} />
{/if}
