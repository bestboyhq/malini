<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import RouteOutlet from './RouteOutlet.svelte';
	import type { RouteComponent } from './hash-router.svelte';

	interface Props {
		components: readonly RouteComponent[];
	}

	let { components }: Props = $props();

	const Current = $derived(
		components[0] !== undefined && isSnippetHost(components[0]) ? components[0] : undefined,
	);
	const rest = $derived(components.slice(1));

	function isSnippetHost(
		component: RouteComponent,
	): component is Component<{ children?: Snippet }> {
		return typeof component === 'function';
	}
</script>

{#if Current}
	{#if rest.length > 0}
		<Current>
			<RouteOutlet components={rest} />
		</Current>
	{:else}
		<Current />
	{/if}
{/if}
