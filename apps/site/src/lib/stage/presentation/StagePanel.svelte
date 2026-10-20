<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = { lit?: boolean; element?: HTMLElement | undefined; children: Snippet };

	let { lit = false, element = $bindable(), children }: Props = $props();
</script>

<div class={['panel', { lit }]} bind:this={element} data-nosnippet>
	{@render children()}
</div>

<style>
	.panel {
		position: relative;
		overflow: hidden;
		border-radius: 14px;
		background: var(--app-root);
		box-shadow:
			0 0 0 1px var(--line),
			var(--app-shadow);
	}

	.panel.lit {
		box-shadow: 0 0 0 1px var(--line);
	}
</style>
